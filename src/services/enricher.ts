import type { IGitService, ILLMService, IndexProgress } from "@/types"
import type { CommitRow } from "@/types"
import { CommitRepository } from "@db/commits"
import { AggregateRepository } from "@db/aggregates"
import { SearchService } from "@db/search"
import { BatchJobRepository } from "@db/batch-jobs"
import type { BatchLLMService } from "@services/batch-llm"

/**
 * Orchestrates the full indexing pipeline: discovers new commits, enriches them
 * via LLM, rebuilds aggregates, and rebuilds the FTS search index.
 */
export class EnricherService {
  private git: IGitService
  private llm: ILLMService
  private commits: CommitRepository
  private aggregates: AggregateRepository
  private search: SearchService
  private model: string
  private concurrency: number

  /**
   * @param git - Git repository service.
   * @param llm - LLM enrichment service.
   * @param commits - Commit database repository.
   * @param aggregates - Aggregate statistics repository.
   * @param search - Full-text search service.
   * @param model - Model identifier stored with enrichment results.
   * @param concurrency - Number of parallel LLM requests per window.
   */
  constructor(
    git: IGitService,
    llm: ILLMService,
    commits: CommitRepository,
    aggregates: AggregateRepository,
    search: SearchService,
    model: string = "claude-haiku-4-5-20251001",
    concurrency: number = 8,
  ) {
    this.git = git
    this.llm = llm
    this.commits = commits
    this.aggregates = aggregates
    this.search = search
    this.model = model
    this.concurrency = concurrency
  }

  /**
   * Runs the full indexing pipeline: discover, enrich, aggregate, and index.
   * @param onProgress - Callback invoked with progress updates for each phase.
   * @param signal - Optional AbortSignal to cancel enrichment mid-run.
   * @returns Counts of enriched commits for this run and overall totals.
   */
  async run(
    onProgress: (progress: IndexProgress) => void,
    signal?: AbortSignal,
  ): Promise<{
    enrichedThisRun: number
    totalEnriched: number
    totalCommits: number
  }> {
    // Phase 1: Discover commits
    onProgress({ phase: "discovering", current: 0, total: 0 })
    const branch = await this.git.getDefaultBranch()
    const allHashes = await this.git.getCommitHashes(branch)
    const indexedHashes = this.commits.getIndexedHashes()

    // Insert raw commit data for unindexed commits
    const newHashes = allHashes.filter((h) => !indexedHashes.has(h))
    if (newHashes.length > 0) {
      const newCommits = await this.git.getCommitInfoBatch(newHashes)
      this.commits.insertRawCommits(newCommits)
    }

    // Phase 2: Enrich unenriched commits with parallel sliding window
    const unenriched = this.commits.getUnenrichedCommits()
    const total = unenriched.length
    let enrichedThisRun = 0

    if (total > 0) {
      // Pre-fetch all diffs in one batch call
      const unenrichedHashes = unenriched.map((c) => c.hash)
      const diffMap = await this.git.getDiffBatch(unenrichedHashes)

      for (let i = 0; i < unenriched.length; i += this.concurrency) {
        if (signal?.aborted) break

        const window = unenriched.slice(i, i + this.concurrency)
        onProgress({
          phase: "enriching",
          current: i + 1,
          total,
          currentHash: window[0].hash,
        })

        const settled = await Promise.allSettled(
          window.map(async (commit) => {
            const diff = diffMap.get(commit.hash) ?? ""
            return {
              commit,
              result: await this.llm.enrichCommit(
                {
                  hash: commit.hash,
                  authorName: commit.author_name,
                  authorEmail: commit.author_email,
                  committedAt: commit.committed_at,
                  message: commit.message,
                  files: [],
                },
                diff,
              ),
            }
          }),
        )

        // Sequential DB writes for fulfilled results
        for (const outcome of settled) {
          if (outcome.status === "fulfilled") {
            const { commit, result } = outcome.value
            this.commits.updateEnrichment(
              commit.hash,
              result.classification,
              result.summary,
              this.model,
            )
            this.search.indexCommit(
              commit.hash,
              commit.message,
              result.classification,
              result.summary,
            )
            enrichedThisRun++
          } else {
            console.error(`Failed to enrich commit: ${outcome.reason}`)
          }
        }
      }
    }

    // Phase 3: Rebuild aggregates
    onProgress({ phase: "aggregating", current: 0, total: 0 })
    this.aggregates.rebuildFileStats()
    this.aggregates.rebuildFileContributors()
    this.aggregates.rebuildFileCoupling()

    // Phase 4: Rebuild FTS index
    onProgress({ phase: "indexing", current: 0, total: 0 })
    this.search.rebuildIndex()

    const totalEnriched = this.commits.getEnrichedCommitCount()
    const totalCommits = this.commits.getTotalCommitCount()

    onProgress({ phase: "done", current: totalEnriched, total: totalCommits })

    return { enrichedThisRun, totalEnriched, totalCommits }
  }

  /**
   * Runs the indexing pipeline using the Anthropic Message Batches API.
   * Auto-detects state: submits a new batch if unenriched commits exist,
   * polls/imports results if a batch is pending, or skips if nothing to do.
   * @param batchLLM - The batch LLM service for API calls.
   * @param batchJobs - The batch jobs repository for persistence.
   * @param onProgress - Callback invoked with progress updates.
   * @returns Summary of what happened.
   */
  async runBatch(
    batchLLM: BatchLLMService,
    batchJobs: BatchJobRepository,
    onProgress: (progress: IndexProgress) => void,
  ): Promise<{
    enrichedThisRun: number
    totalEnriched: number
    totalCommits: number
    batchId?: string
    batchStatus?: string
  }> {
    // Phase 1: Discover commits
    onProgress({ phase: "discovering", current: 0, total: 0 })
    const branch = await this.git.getDefaultBranch()
    const allHashes = await this.git.getCommitHashes(branch)
    const indexedHashes = this.commits.getIndexedHashes()

    const newHashes = allHashes.filter((h) => !indexedHashes.has(h))
    if (newHashes.length > 0) {
      const newCommits = await this.git.getCommitInfoBatch(newHashes)
      this.commits.insertRawCommits(newCommits)
    }

    let enrichedThisRun = 0

    // Check for pending batch
    const pendingBatch = batchJobs.getPendingBatch()

    if (pendingBatch) {
      // Poll status
      const status = await batchLLM.getBatchStatus(pendingBatch.batch_id)
      batchJobs.updateStatus(
        pendingBatch.batch_id,
        status.processingStatus,
        status.requestCounts.succeeded,
        status.requestCounts.errored +
          status.requestCounts.canceled +
          status.requestCounts.expired,
      )

      if (status.processingStatus === "ended") {
        // Import results
        const results = await batchLLM.getBatchResults(pendingBatch.batch_id)
        onProgress({
          phase: "enriching",
          current: 0,
          total: results.length,
          batchId: pendingBatch.batch_id,
          batchStatus: "importing",
        })

        for (const item of results) {
          if (item.result) {
            this.commits.updateEnrichment(
              item.hash,
              item.result.classification,
              item.result.summary,
              this.model,
            )
            enrichedThisRun++
          }
        }
      } else {
        // Still in progress — report and return
        const totalEnriched = this.commits.getEnrichedCommitCount()
        const totalCommits = this.commits.getTotalCommitCount()
        onProgress({
          phase: "enriching",
          current: status.requestCounts.succeeded,
          total: pendingBatch.request_count,
          batchId: pendingBatch.batch_id,
          batchStatus: status.processingStatus,
        })
        return {
          enrichedThisRun: 0,
          totalEnriched,
          totalCommits,
          batchId: pendingBatch.batch_id,
          batchStatus: status.processingStatus,
        }
      }
    } else {
      // No pending batch — submit if unenriched commits exist
      const unenriched = this.commits.getUnenrichedCommits()
      if (unenriched.length > 0) {
        const MAX_BATCH_SIZE = 10000
        const batches = this.chunkCommits(unenriched, MAX_BATCH_SIZE)
        const diffMap = await this.git.getDiffBatch(
          unenriched.map((c) => c.hash),
        )

        for (const batch of batches) {
          const requests = batch.map((commit) => ({
            hash: commit.hash,
            commit: {
              hash: commit.hash,
              authorName: commit.author_name,
              authorEmail: commit.author_email,
              committedAt: commit.committed_at,
              message: commit.message,
              files: [],
            },
            diff: diffMap.get(commit.hash) ?? "",
          }))

          onProgress({
            phase: "enriching",
            current: 0,
            total: requests.length,
            batchStatus: "submitting",
          })

          const { batchId, requestCount } =
            await batchLLM.submitBatch(requests)
          batchJobs.insert(batchId, requestCount, this.model)

          const totalEnriched = this.commits.getEnrichedCommitCount()
          const totalCommits = this.commits.getTotalCommitCount()
          onProgress({
            phase: "enriching",
            current: 0,
            total: requestCount,
            batchId,
            batchStatus: "submitted",
          })

          return {
            enrichedThisRun: 0,
            totalEnriched,
            totalCommits,
            batchId,
            batchStatus: "submitted",
          }
        }
      }
    }

    // Phase 3: Rebuild aggregates
    onProgress({ phase: "aggregating", current: 0, total: 0 })
    this.aggregates.rebuildFileStats()
    this.aggregates.rebuildFileContributors()
    this.aggregates.rebuildFileCoupling()

    // Phase 4: Rebuild FTS index
    onProgress({ phase: "indexing", current: 0, total: 0 })
    this.search.rebuildIndex()

    const totalEnriched = this.commits.getEnrichedCommitCount()
    const totalCommits = this.commits.getTotalCommitCount()

    onProgress({ phase: "done", current: totalEnriched, total: totalCommits })

    return { enrichedThisRun, totalEnriched, totalCommits }
  }

  private chunkCommits(
    commits: CommitRow[],
    size: number,
  ): CommitRow[][] {
    const chunks: CommitRow[][] = []
    for (let i = 0; i < commits.length; i += size) {
      chunks.push(commits.slice(i, i + size))
    }
    return chunks
  }
}
