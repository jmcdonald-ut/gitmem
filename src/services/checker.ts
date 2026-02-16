import type {
  IGitService,
  IJudgeService,
  CheckProgress,
  EvalResult,
  EvalSummary,
  CommitRow,
} from "@/types"
import { CommitRepository } from "@db/commits"

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

    const verdicts = await this.judge.evaluateCommit(
      commitInfo,
      diff,
      commit.classification,
      commit.summary,
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
    const sample = this.commits.getRandomEnrichedCommits(sampleSize)
    const total = sample.length
    const results: EvalResult[] = []
    let evaluated = 0

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

    // Pre-fetch all diffs in one batch
    const hashes = sample.map((c) => c.hash)
    const diffMap = await this.git.getDiffBatch(hashes)

    for (let i = 0; i < sample.length; i += this.concurrency) {
      const window = sample.slice(i, i + this.concurrency)
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
        }
      }
    }

    const summary: EvalSummary = {
      total: results.length,
      classificationCorrect: results.filter((r) => r.classificationVerdict.pass)
        .length,
      summaryAccurate: results.filter((r) => r.accuracyVerdict.pass).length,
      summaryComplete: results.filter((r) => r.completenessVerdict.pass).length,
    }

    onProgress({ phase: "done", current: evaluated, total })

    return { results, summary }
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

  private async evaluateOne(
    commit: CommitRow,
    diffMap: Map<string, string>,
  ): Promise<EvalResult> {
    const diff = diffMap.get(commit.hash) ?? ""
    const commitInfo = await this.git.getCommitInfo(commit.hash)

    const verdicts = await this.judge.evaluateCommit(
      commitInfo,
      diff,
      commit.classification!,
      commit.summary!,
    )

    return {
      hash: commit.hash,
      classification: commit.classification!,
      summary: commit.summary!,
      ...verdicts,
    }
  }
}
