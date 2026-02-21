import type { BatchJobRepository } from "@db/batch-jobs"
import type { CommitRepository } from "@db/commits"
import type { CommitRow } from "@db/types"
import { reconcileClassificationVerdict } from "@services/judge-shared"
import type {
  CheckBatchRequest,
  CheckBatchResult,
  CheckProgress,
  EvalResult,
  EvalSummary,
  IBatchJudgeService,
  IGitService,
  IJudgeService,
} from "@services/types"

/**
 * Orchestrates the quality check workflow: fetches enriched commits,
 * evaluates them via a judge model, and computes aggregate results.
 */
export class CheckerService {
  private git: IGitService
  private judge: IJudgeService
  private commits: CommitRepository
  private concurrency: number

  /**
   * @param git - Git repository service.
   * @param judge - Judge evaluation service.
   * @param commits - Commit database repository.
   * @param concurrency - Number of parallel judge requests per window.
   */
  constructor(
    git: IGitService,
    judge: IJudgeService,
    commits: CommitRepository,
    concurrency: number = 4,
  ) {
    this.git = git
    this.judge = judge
    this.commits = commits
    this.concurrency = concurrency
  }

  /**
   * Evaluates a single commit by full or partial hash.
   * @param hash - The full or partial commit hash to evaluate.
   * @param onProgress - Callback invoked with progress updates.
   * @returns The evaluation result, or null if the commit is not found/enriched.
   * @throws If the partial hash matches multiple commits.
   */
  async checkOne(
    hash: string,
    onProgress: (progress: CheckProgress) => void,
  ): Promise<EvalResult | null> {
    const commit = this.resolveCommit(hash)
    if (!commit || !commit.classification || !commit.summary) {
      return null
    }

    const resolvedHash = commit.hash
    onProgress({
      phase: "evaluating",
      current: 0,
      total: 1,
      currentHash: resolvedHash,
    })

    const commitInfo = await this.git.getCommitInfo(resolvedHash)
    const diff = await this.git.getDiff(resolvedHash)

    if (this.isMergeCommitWithEmptyDiff(commit.message, diff)) {
      onProgress({ phase: "done", current: 1, total: 1 })
      const reasoning =
        "Merge commit with empty diff — template-enriched during indexing, skipped evaluation."
      return {
        hash: resolvedHash,
        classification: commit.classification,
        summary: commit.summary,
        classificationVerdict: { pass: true, reasoning },
        accuracyVerdict: { pass: true, reasoning },
        completenessVerdict: { pass: true, reasoning },
      }
    }

    const verdicts = await this.judge.evaluateCommit(
      commitInfo,
      diff,
      commit.classification,
      commit.summary,
    )

    verdicts.classificationVerdict = reconcileClassificationVerdict(
      commit.classification,
      verdicts.classificationVerdict,
    )

    onProgress({ phase: "done", current: 1, total: 1 })

    return {
      hash: resolvedHash,
      classification: commit.classification,
      summary: commit.summary,
      ...verdicts,
    }
  }

  /**
   * Evaluates a random sample of enriched commits.
   * @param sampleSize - Number of random enriched commits to evaluate.
   * @param onProgress - Callback invoked with progress updates.
   * @returns The individual results and aggregate summary.
   */
  async checkSample(
    sampleSize: number,
    onProgress: (progress: CheckProgress) => void,
  ): Promise<{ results: EvalResult[]; summary: EvalSummary }> {
    const { commits: evaluatable, diffMap } =
      await this.sampleEvaluatableCommits(sampleSize)

    const results: EvalResult[] = []
    let evaluated = 0
    const total = evaluatable.length

    if (total === 0) {
      onProgress({ phase: "done", current: 0, total: 0 })
      return {
        results: [],
        summary: {
          total: 0,
          classificationCorrect: 0,
          summaryAccurate: 0,
          summaryComplete: 0,
        },
      }
    }

    for (let i = 0; i < evaluatable.length; i += this.concurrency) {
      const window = evaluatable.slice(i, i + this.concurrency)
      onProgress({
        phase: "evaluating",
        current: evaluated + 1,
        total,
        currentHash: window[0].hash,
      })

      const settled = await Promise.allSettled(
        window.map((commit) => this.evaluateOne(commit, diffMap)),
      )

      for (const outcome of settled) {
        if (outcome.status === "fulfilled") {
          results.push(outcome.value)
          evaluated++
        } else {
          console.error(`Failed to evaluate commit: ${outcome.reason}`)
        }
      }
    }

    const summary = this.computeSummary(results)

    onProgress({ phase: "done", current: evaluated, total })

    return { results, summary }
  }

  /**
   * Evaluates a random sample of enriched commits using the Anthropic Batches API.
   * Auto-detects state: submits a new batch, polls a pending one, or imports results.
   * @param batchJudge - The batch judge service for API calls.
   * @param batchJobs - The batch jobs repository for persistence.
   * @param sampleSize - Number of random enriched commits to evaluate.
   * @param outputPath - Path to write detailed results JSON.
   * @param onProgress - Callback invoked with progress updates.
   * @returns The batch result with optional results/summary or batch status.
   */
  async checkSampleBatch(
    batchJudge: IBatchJudgeService,
    batchJobs: BatchJobRepository,
    sampleSize: number,
    outputPath: string,
    onProgress: (progress: CheckProgress) => void,
  ): Promise<CheckBatchResult> {
    const pendingBatch = batchJobs.getPendingBatchByType("check")

    if (pendingBatch) {
      const status = await batchJudge.getBatchStatus(pendingBatch.batch_id)
      batchJobs.updateStatus(
        pendingBatch.batch_id,
        status.processingStatus,
        status.requestCounts.succeeded,
        status.requestCounts.errored +
          status.requestCounts.canceled +
          status.requestCounts.expired,
      )

      if (status.processingStatus === "ended") {
        const batchResults = await batchJudge.getBatchResults(
          pendingBatch.batch_id,
        )
        onProgress({
          phase: "importing",
          current: 0,
          total: batchResults.length,
          batchId: pendingBatch.batch_id,
          batchStatus: "importing",
        })

        const items = batchJobs.getCheckBatchItems(pendingBatch.batch_id)
        const itemMap = new Map(items.map((i) => [i.hash, i]))

        const results: EvalResult[] = []
        for (const item of batchResults) {
          if (item.result) {
            const checkItem = itemMap.get(item.hash)
            if (!checkItem) continue

            item.result.classificationVerdict = reconcileClassificationVerdict(
              checkItem.classification,
              item.result.classificationVerdict,
            )

            results.push({
              hash: item.hash,
              classification: checkItem.classification,
              summary: checkItem.summary,
              ...item.result,
            })
          }
        }

        const summary = this.computeSummary(results)
        await Bun.write(outputPath, JSON.stringify(results, null, 2))
        batchJobs.deleteCheckBatchItems(pendingBatch.batch_id)

        onProgress({
          phase: "done",
          current: results.length,
          total: results.length,
        })

        return { kind: "complete", results, summary, outputPath }
      }

      // Still in progress
      onProgress({
        phase: "evaluating",
        current: status.requestCounts.succeeded,
        total: pendingBatch.request_count,
        batchId: pendingBatch.batch_id,
        batchStatus: status.processingStatus,
      })

      return {
        kind: "in_progress",
        batchId: pendingBatch.batch_id,
        batchStatus: status.processingStatus,
      }
    }

    // No pending batch — submit a new one
    const { commits: evaluatable, diffMap } =
      await this.sampleEvaluatableCommits(sampleSize)

    if (evaluatable.length === 0) {
      onProgress({ phase: "done", current: 0, total: 0 })
      return {
        kind: "empty",
        results: [],
        summary: {
          total: 0,
          classificationCorrect: 0,
          summaryAccurate: 0,
          summaryComplete: 0,
        },
      }
    }

    const evalHashes = evaluatable.map((c) => c.hash)
    const filesMap = this.commits.getCommitFilesByHashes(evalHashes)

    onProgress({
      phase: "submitting",
      current: 0,
      total: evaluatable.length,
      batchStatus: "submitting",
    })

    const requests: CheckBatchRequest[] = evaluatable.map((commit) => ({
      hash: commit.hash,
      commit: {
        hash: commit.hash,
        authorName: commit.author_name,
        authorEmail: commit.author_email,
        committedAt: commit.committed_at,
        message: commit.message,
        files: filesMap.get(commit.hash) ?? [],
      },
      diff: diffMap.get(commit.hash) ?? "",
      classification: commit.classification!,
      summary: commit.summary!,
    }))

    const { batchId, requestCount } = await batchJudge.submitBatch(requests)
    batchJobs.insert(batchId, requestCount, batchJudge.model, "check")
    batchJobs.insertCheckBatchItems(
      evaluatable.map((c) => ({
        batchId,
        hash: c.hash,
        classification: c.classification!,
        summary: c.summary!,
      })),
    )

    onProgress({
      phase: "evaluating",
      current: 0,
      total: requestCount,
      batchId,
      batchStatus: "submitted",
    })

    return { kind: "submitted", batchId }
  }

  /**
   * Resolves a full or partial hash to a single commit.
   * @throws If the prefix matches multiple commits.
   */
  private resolveCommit(hash: string): CommitRow | null {
    // Try exact match first
    const exact = this.commits.getCommit(hash)
    if (exact) return exact

    // Try prefix match
    const matches = this.commits.getCommitsByHashPrefix(hash)
    if (matches.length === 0) return null
    if (matches.length === 1) return matches[0]

    const matchList = matches.map((m) => m.hash.slice(0, 12)).join(", ")
    throw new Error(
      `Ambiguous hash prefix "${hash}" matches ${matches.length} commits: ${matchList}. Please provide more characters.`,
    )
  }

  /** Computes aggregate summary statistics from evaluation results. */
  private computeSummary(results: EvalResult[]): EvalSummary {
    return {
      total: results.length,
      classificationCorrect: results.filter((r) => r.classificationVerdict.pass)
        .length,
      summaryAccurate: results.filter((r) => r.accuracyVerdict.pass).length,
      summaryComplete: results.filter((r) => r.completenessVerdict.pass).length,
    }
  }

  /**
   * Samples evaluatable commits by iteratively fetching random enriched commits,
   * filtering out merge commits with empty diffs, and backfilling until the
   * requested sample size is met (or the database is exhausted).
   */
  private async sampleEvaluatableCommits(
    sampleSize: number,
  ): Promise<{ commits: CommitRow[]; diffMap: Map<string, string> }> {
    const evaluatable: CommitRow[] = []
    const diffMap = new Map<string, string>()
    const seen = new Set<string>()

    while (evaluatable.length < sampleSize) {
      const remaining = sampleSize - evaluatable.length
      const batch = this.commits.getRandomEnrichedCommits(remaining, seen, true)

      if (batch.length === 0) break // DB exhausted

      for (const c of batch) seen.add(c.hash)

      const batchHashes = batch.map((c) => c.hash)
      const batchDiffs = await this.git.getDiffBatch(batchHashes)

      for (const c of batch) {
        const diff = batchDiffs.get(c.hash) ?? ""
        diffMap.set(c.hash, diff)
        if (!this.isMergeCommitWithEmptyDiff(c.message, diff)) {
          evaluatable.push(c)
        }
      }
    }

    return { commits: evaluatable.slice(0, sampleSize), diffMap }
  }

  /**
   * Detects merge commits with empty diffs that were template-enriched
   * during indexing (not evaluated by LLM).
   */
  private isMergeCommitWithEmptyDiff(message: string, diff: string): boolean {
    return message.startsWith("Merge") && diff.trim() === ""
  }

  private async evaluateOne(
    commit: CommitRow,
    diffMap: Map<string, string>,
  ): Promise<EvalResult> {
    if (!commit.classification || !commit.summary) {
      throw new Error(`Commit ${commit.hash} missing classification/summary`)
    }

    const diff = diffMap.get(commit.hash) ?? ""
    const commitInfo = await this.git.getCommitInfo(commit.hash)

    const verdicts = await this.judge.evaluateCommit(
      commitInfo,
      diff,
      commit.classification,
      commit.summary,
    )

    verdicts.classificationVerdict = reconcileClassificationVerdict(
      commit.classification,
      verdicts.classificationVerdict,
    )

    return {
      hash: commit.hash,
      classification: commit.classification,
      summary: commit.summary,
      ...verdicts,
    }
  }
}
