import type { IGitService, ILLMService, IndexProgress } from "@/types"
import type { CommitRow, EnrichmentResult } from "@/types"
import { CommitRepository } from "@db/commits"
import { AggregateRepository } from "@db/aggregates"
import { SearchService } from "@db/search"
import { BatchJobRepository } from "@db/batch-jobs"
import type { BatchLLMService, BatchRequest } from "@services/batch-llm"
import type { MeasurerService } from "@services/measurer"
import { SYSTEM_PROMPT, buildUserMessage } from "@services/llm-shared"

const MAX_BATCH_REQUESTS = 100_000
const MAX_BATCH_BYTES = 200 * 1024 * 1024 // 200 MB, leaving margin from the 256 MB limit

/**
 * Orchestrates the full indexing pipeline: discovers new commits, enriches them
 * via LLM, rebuilds aggregates, and rebuilds the FTS search index.
 */
export class EnricherService {
  private git: IGitService
  private llm: ILLMService | null
  private commits: CommitRepository
  private aggregates: AggregateRepository
  private search: SearchService
  private measurer: MeasurerService | null
  private model: string
  private concurrency: number
  private indexStartDate?: string
  private aiStartDate?: string

  /**
   * @param git - Git repository service.
   * @param llm - LLM enrichment service (null to skip enrichment).
   * @param commits - Commit database repository.
   * @param aggregates - Aggregate statistics repository.
   * @param search - Full-text search service.
   * @param measurer - Complexity measurement service.
   * @param model - Model identifier stored with enrichment results.
   * @param concurrency - Number of parallel LLM requests per window.
   * @param indexStartDate - Only discover commits on or after this date.
   * @param aiStartDate - Only enrich commits on or after this date.
   */
  constructor(
    git: IGitService,
    llm: ILLMService | null,
    commits: CommitRepository,
    aggregates: AggregateRepository,
    search: SearchService,
    measurer: MeasurerService | null = null,
    model: string = "claude-haiku-4-5-20251001",
    concurrency: number = 8,
    indexStartDate?: string,
    aiStartDate?: string,
  ) {
    this.git = git
    this.llm = llm
    this.commits = commits
    this.aggregates = aggregates
    this.search = search
    this.measurer = measurer
    this.model = model
    this.concurrency = concurrency
    this.indexStartDate = indexStartDate
    this.aiStartDate = aiStartDate
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
    discoveredThisRun: number
    enrichedThisRun: number
    totalEnriched: number
    totalCommits: number
  }> {
    const { newHashes } = await this.discoverAndInsert(onProgress)

    let enrichedThisRun = 0
    const enrichedHashes: string[] = []

    // Phase 2: Enrich unenriched commits with parallel sliding window (skip when LLM is null)
    if (this.llm) {
      const unenriched = this.aiStartDate
        ? this.commits.getUnenrichedCommitsSince(this.aiStartDate)
        : this.commits.getUnenrichedCommits()
      const total = unenriched.length

      if (total > 0) {
        // Pre-fetch all diffs and file lists in one batch call
        const unenrichedHashes = unenriched.map((c) => c.hash)
        const diffMap = await this.git.getDiffBatch(unenrichedHashes)
        const filesMap = this.commits.getCommitFilesByHashes(unenrichedHashes)

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
              const mergeResult = this.tryMergeCommitEnrichment(
                commit.message,
                diff,
              )
              if (mergeResult) {
                return { commit, result: mergeResult }
              }
              return {
                commit,
                result: await this.llm!.enrichCommit(
                  {
                    hash: commit.hash,
                    authorName: commit.author_name,
                    authorEmail: commit.author_email,
                    committedAt: commit.committed_at,
                    message: commit.message,
                    files: filesMap.get(commit.hash) ?? [],
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
              enrichedThisRun++
              enrichedHashes.push(commit.hash)
            } else {
              console.error(`Failed to enrich commit: ${outcome.reason}`)
            }
          }
        }
      }
    }

    this.rebuildAggregatesAndIndex(
      [...new Set([...enrichedHashes, ...newHashes])],
      enrichedHashes,
      newHashes,
      onProgress,
    )

    const totalEnriched = this.commits.getEnrichedCommitCount()
    const totalCommits = this.commits.getTotalCommitCount()

    onProgress({ phase: "done", current: totalEnriched, total: totalCommits })

    return {
      discoveredThisRun: newHashes.length,
      enrichedThisRun,
      totalEnriched,
      totalCommits,
    }
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
    discoveredThisRun: number
    enrichedThisRun: number
    totalEnriched: number
    totalCommits: number
    batchId?: string
    batchStatus?: string
  }> {
    const { newHashes } = await this.discoverAndInsert(onProgress)

    let enrichedThisRun: number = 0
    const enrichedHashes: string[] = []

    if (this.llm) {
      const pendingBatch = batchJobs.getPendingBatchByType("index")

      if (pendingBatch) {
        const result = await this.handlePendingBatch(
          pendingBatch,
          batchLLM,
          batchJobs,
          onProgress,
          newHashes,
        )
        if (result.earlyReturn) return result.earlyReturn
        enrichedThisRun = result.enrichedThisRun
        enrichedHashes.push(...result.enrichedHashes)
      } else {
        const result = await this.submitNewBatch(
          batchLLM,
          batchJobs,
          onProgress,
          newHashes,
        )
        if (result.earlyReturn) return result.earlyReturn
        enrichedThisRun = result.enrichedThisRun
        enrichedHashes.push(...result.enrichedHashes)
      }
    }

    this.rebuildAggregatesAndIndex(
      [...new Set([...enrichedHashes, ...newHashes])],
      enrichedHashes,
      newHashes,
      onProgress,
    )

    const totalEnriched = this.commits.getEnrichedCommitCount()
    const totalCommits = this.commits.getTotalCommitCount()

    onProgress({ phase: "done", current: totalEnriched, total: totalCommits })

    return {
      discoveredThisRun: newHashes.length,
      enrichedThisRun,
      totalEnriched,
      totalCommits,
    }
  }

  /** Discovers new commits from git and inserts them into the database. */
  private async discoverAndInsert(
    onProgress: (progress: IndexProgress) => void,
  ): Promise<{ newHashes: string[] }> {
    onProgress({ phase: "discovering", current: 0, total: 0 })
    const branch = await this.git.getDefaultBranch()
    const allHashes = await this.git.getCommitHashes(
      branch,
      this.indexStartDate ?? undefined,
    )
    const indexedHashes = this.commits.getIndexedHashes()

    const newHashes = allHashes.filter((h) => !indexedHashes.has(h))
    if (newHashes.length > 0) {
      const newCommits = await this.git.getCommitInfoBatch(newHashes)
      this.commits.insertRawCommits(newCommits)
    }

    if (this.measurer) {
      await this.measurer.measure(onProgress)
    }

    return { newHashes }
  }

  /** Polls a pending batch, imports results if ended, or returns early if still in progress. */
  private async handlePendingBatch(
    pendingBatch: { batch_id: string; request_count: number },
    batchLLM: BatchLLMService,
    batchJobs: BatchJobRepository,
    onProgress: (progress: IndexProgress) => void,
    newHashes: string[],
  ): Promise<{
    enrichedThisRun: number
    enrichedHashes: string[]
    earlyReturn?: {
      discoveredThisRun: number
      enrichedThisRun: number
      totalEnriched: number
      totalCommits: number
      batchId: string
      batchStatus: string
    }
  }> {
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
      const results = await batchLLM.getBatchResults(pendingBatch.batch_id)
      onProgress({
        phase: "enriching",
        current: 0,
        total: results.length,
        batchId: pendingBatch.batch_id,
        batchStatus: "importing",
      })

      const updates: Array<{
        hash: string
        classification: string
        summary: string
      }> = []
      for (const item of results) {
        if (item.result) {
          updates.push({
            hash: item.hash,
            classification: item.result.classification,
            summary: item.result.summary,
          })
        }
      }
      if (updates.length > 0) {
        this.commits.updateEnrichmentBatch(updates, this.model)
      }
      return {
        enrichedThisRun: updates.length,
        enrichedHashes: updates.map((u) => u.hash),
      }
    }

    // Still in progress — report and return early
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
      enrichedHashes: [],
      earlyReturn: {
        discoveredThisRun: newHashes.length,
        enrichedThisRun: 0,
        totalEnriched,
        totalCommits,
        batchId: pendingBatch.batch_id,
        batchStatus: status.processingStatus,
      },
    }
  }

  /** Submits a new batch if unenriched commits exist, handling merge commits locally. */
  private async submitNewBatch(
    batchLLM: BatchLLMService,
    batchJobs: BatchJobRepository,
    onProgress: (progress: IndexProgress) => void,
    newHashes: string[],
  ): Promise<{
    enrichedThisRun: number
    enrichedHashes: string[]
    earlyReturn?: {
      discoveredThisRun: number
      enrichedThisRun: number
      totalEnriched: number
      totalCommits: number
      batchId: string
      batchStatus: string
    }
  }> {
    let enrichedThisRun = 0
    const enrichedHashes: string[] = []

    const unenriched = this.aiStartDate
      ? this.commits.getUnenrichedCommitsSince(this.aiStartDate)
      : this.commits.getUnenrichedCommits()
    if (unenriched.length > 0) {
      const unenrichedHashes = unenriched.map((c) => c.hash)
      const diffMap = await this.git.getDiffBatch(unenrichedHashes)
      const filesMap = this.commits.getCommitFilesByHashes(unenrichedHashes)

      // Handle merge commits locally without LLM
      const needsLLM: CommitRow[] = []
      for (const commit of unenriched) {
        const diff = diffMap.get(commit.hash) ?? ""
        const mergeResult = this.tryMergeCommitEnrichment(commit.message, diff)
        if (mergeResult) {
          this.commits.updateEnrichment(
            commit.hash,
            mergeResult.classification,
            mergeResult.summary,
            this.model,
          )
          enrichedThisRun++
          enrichedHashes.push(commit.hash)
        } else {
          needsLLM.push(commit)
        }
      }

      const allRequests: BatchRequest[] = needsLLM.map((commit) => ({
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
      }))

      const batches = this.chunkBatchRequests(allRequests)

      for (const requests of batches) {
        onProgress({
          phase: "enriching",
          current: 0,
          total: requests.length,
          batchStatus: "submitting",
        })

        const { batchId, requestCount } = await batchLLM.submitBatch(requests)
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
          enrichedHashes,
          earlyReturn: {
            discoveredThisRun: newHashes.length,
            enrichedThisRun: 0,
            totalEnriched,
            totalCommits,
            batchId,
            batchStatus: "submitted",
          },
        }
      }
    }

    return { enrichedThisRun, enrichedHashes }
  }

  /** Rebuilds aggregates and the FTS index for affected commit hashes. */
  private rebuildAggregatesAndIndex(
    affectedHashes: string[],
    enrichedHashes: string[],
    newHashes: string[],
    onProgress: (progress: IndexProgress) => void,
  ): void {
    if (affectedHashes.length > 0) {
      onProgress({ phase: "aggregating", current: 0, total: 0 })
      this.aggregates.rebuildFileStatsIncremental(affectedHashes)
      this.aggregates.rebuildFileContributorsIncremental(affectedHashes)
      this.aggregates.rebuildFileCouplingIncremental(affectedHashes)

      onProgress({ phase: "indexing", current: 0, total: 0 })
      // Index enriched commits, plus new unenriched commits (message search still works)
      const ftsHashes = [...new Set([...enrichedHashes, ...newHashes])]
      this.search.indexNewCommits(ftsHashes)
    }
  }

  /**
   * Detects merge commits with empty diffs and returns a template enrichment
   * result, skipping the LLM call entirely.
   */
  private tryMergeCommitEnrichment(
    message: string,
    diff: string,
  ): EnrichmentResult | null {
    if (message.startsWith("Merge") && diff.trim() === "") {
      const firstLine = message.split("\n")[0]
      return {
        classification: "chore",
        summary: `Merge commit: ${firstLine}`,
      }
    }
    return null
  }

  /**
   * Chunks batch requests respecting both the request count limit and
   * the estimated serialized size limit.
   */
  chunkBatchRequests(requests: BatchRequest[]): BatchRequest[][] {
    const chunks: BatchRequest[][] = []
    let currentChunk: BatchRequest[] = []
    let currentBytes = 0

    for (const req of requests) {
      const userMessage = buildUserMessage(req.commit, req.diff)
      // Estimate serialized size: system prompt + user message + JSON overhead per request
      const requestBytes = SYSTEM_PROMPT.length + userMessage.length + 256 // JSON envelope overhead

      if (
        currentChunk.length > 0 &&
        (currentChunk.length >= MAX_BATCH_REQUESTS ||
          currentBytes + requestBytes > MAX_BATCH_BYTES)
      ) {
        chunks.push(currentChunk)
        currentChunk = []
        currentBytes = 0
      }

      currentChunk.push(req)
      currentBytes += requestBytes
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk)
    }

    return chunks
  }
}
