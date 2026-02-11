import type { IGitService, ILLMService, IndexProgress } from "@/types"
import { CommitRepository } from "@db/commits"
import { AggregateRepository } from "@db/aggregates"
import { SearchService } from "@db/search"

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

  /**
   * @param git - Git repository service.
   * @param llm - LLM enrichment service.
   * @param commits - Commit database repository.
   * @param aggregates - Aggregate statistics repository.
   * @param search - Full-text search service.
   * @param model - Model identifier stored with enrichment results.
   */
  constructor(
    git: IGitService,
    llm: ILLMService,
    commits: CommitRepository,
    aggregates: AggregateRepository,
    search: SearchService,
    model: string = "claude-haiku-4-5-20251001",
  ) {
    this.git = git
    this.llm = llm
    this.commits = commits
    this.aggregates = aggregates
    this.search = search
    this.model = model
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
      const newCommits = []
      for (const hash of newHashes) {
        const info = await this.git.getCommitInfo(hash)
        newCommits.push(info)
      }
      this.commits.insertRawCommits(newCommits)
    }

    // Phase 2: Enrich unenriched commits
    const unenriched = this.commits.getUnenrichedCommits()
    const total = unenriched.length
    let enrichedThisRun = 0

    for (let i = 0; i < unenriched.length; i++) {
      if (signal?.aborted) break

      const commit = unenriched[i]
      onProgress({
        phase: "enriching",
        current: i + 1,
        total,
        currentHash: commit.hash,
      })

      try {
        const diff = await this.git.getDiff(commit.hash)
        const result = await this.llm.enrichCommit(
          {
            hash: commit.hash,
            authorName: commit.author_name,
            authorEmail: commit.author_email,
            committedAt: commit.committed_at,
            message: commit.message,
            files: [],
          },
          diff,
        )

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
      } catch (error) {
        // Log but continue — commit remains unenriched for next run
        console.error(`Failed to enrich ${commit.hash}: ${error}`)
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
}
