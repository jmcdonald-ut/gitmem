import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test"
import { createDatabase } from "@db/database"
import { CommitRepository } from "@db/commits"
import { AggregateRepository } from "@db/aggregates"
import { SearchService } from "@db/search"
import { EnricherService } from "@services/enricher"
import type {
  IGitService,
  ILLMService,
  IndexProgress,
  CommitInfo,
} from "@/types"
import { Database } from "bun:sqlite"

describe("EnricherService", () => {
  let db: Database
  let commits: CommitRepository
  let aggregates: AggregateRepository
  let search: SearchService
  let mockGit: IGitService
  let mockLLM: ILLMService

  beforeEach(() => {
    db = createDatabase(":memory:")
    commits = new CommitRepository(db)
    aggregates = new AggregateRepository(db)
    search = new SearchService(db)

    mockGit = {
      isGitRepo: mock(() => Promise.resolve(true)),
      getDefaultBranch: mock(() => Promise.resolve("main")),
      getCommitHashes: mock(() => Promise.resolve(["aaa", "bbb", "ccc"])),
      getCommitInfo: mock((hash: string) =>
        Promise.resolve({
          hash,
          authorName: "Test",
          authorEmail: "test@example.com",
          committedAt: "2024-01-01T00:00:00Z",
          message: `commit ${hash}`,
          files: [
            {
              filePath: "src/main.ts",
              changeType: "M",
              additions: 10,
              deletions: 5,
            },
          ],
        }),
      ),
      getDiff: mock(() => Promise.resolve("diff content")),
      getTotalCommitCount: mock(() => Promise.resolve(3)),
    }

    mockLLM = {
      enrichCommit: mock((commit: CommitInfo) =>
        Promise.resolve({
          classification: "feature" as const,
          summary: `Summary for ${commit.hash}`,
        }),
      ),
    }
  })

  test("run processes all new commits", async () => {
    const enricher = new EnricherService(
      mockGit,
      mockLLM,
      commits,
      aggregates,
      search,
    )

    const progress: IndexProgress[] = []
    const result = await enricher.run((p) => progress.push(p))

    expect(result.enrichedThisRun).toBe(3)
    expect(result.totalEnriched).toBe(3)
    expect(result.totalCommits).toBe(3)
    expect(commits.getEnrichedCommitCount()).toBe(3)
  })

  test("run skips already indexed commits", async () => {
    // Pre-insert one commit
    commits.insertRawCommits([
      {
        hash: "aaa",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "already here",
        files: [],
      },
    ])
    commits.updateEnrichment("aaa", "feature", "Already enriched", "haiku-4.5")

    const enricher = new EnricherService(
      mockGit,
      mockLLM,
      commits,
      aggregates,
      search,
    )
    const result = await enricher.run(() => {})

    // Should only enrich bbb and ccc
    expect(result.enrichedThisRun).toBe(2)
    expect(result.totalEnriched).toBe(3)
  })

  test("run handles LLM errors gracefully", async () => {
    const failingLLM: ILLMService = {
      enrichCommit: mock(() => Promise.reject(new Error("API error"))),
    }

    const enricher = new EnricherService(
      mockGit,
      failingLLM,
      commits,
      aggregates,
      search,
    )

    // Suppress console.error for this test
    const consoleSpy = spyOn(console, "error").mockImplementation(() => {})

    const result = await enricher.run(() => {})

    expect(result.enrichedThisRun).toBe(0)
    expect(result.totalCommits).toBe(3)
    consoleSpy.mockRestore()
  })

  test("run reports progress phases", async () => {
    const enricher = new EnricherService(
      mockGit,
      mockLLM,
      commits,
      aggregates,
      search,
    )

    const phases: string[] = []
    await enricher.run((p) => phases.push(p.phase))

    expect(phases).toContain("discovering")
    expect(phases).toContain("enriching")
    expect(phases).toContain("aggregating")
    expect(phases).toContain("indexing")
    expect(phases).toContain("done")
  })

  test("run respects abort signal", async () => {
    const controller = new AbortController()
    // Abort after first enrichment
    let enrichCount = 0
    const slowLLM: ILLMService = {
      enrichCommit: mock(async () => {
        enrichCount++
        if (enrichCount >= 1) controller.abort()
        return { classification: "feature" as const, summary: "summary" }
      }),
    }

    const enricher = new EnricherService(
      mockGit,
      slowLLM,
      commits,
      aggregates,
      search,
    )
    const result = await enricher.run(() => {}, controller.signal)

    // Should have stopped after 1 enrichment
    expect(result.enrichedThisRun).toBe(1)
  })

  test("run rebuilds aggregates and search index", async () => {
    const rebuildStatsSpy = spyOn(aggregates, "rebuildFileStats")
    const rebuildContribSpy = spyOn(aggregates, "rebuildFileContributors")
    const rebuildCouplingSpy = spyOn(aggregates, "rebuildFileCoupling")
    const rebuildSearchSpy = spyOn(search, "rebuildIndex")

    const enricher = new EnricherService(
      mockGit,
      mockLLM,
      commits,
      aggregates,
      search,
    )
    await enricher.run(() => {})

    expect(rebuildStatsSpy).toHaveBeenCalledTimes(1)
    expect(rebuildContribSpy).toHaveBeenCalledTimes(1)
    expect(rebuildCouplingSpy).toHaveBeenCalledTimes(1)
    expect(rebuildSearchSpy).toHaveBeenCalledTimes(1)
  })

  test("run with no new commits", async () => {
    const emptyGit: IGitService = {
      ...mockGit,
      getCommitHashes: mock(() => Promise.resolve([])),
    }

    const enricher = new EnricherService(
      emptyGit,
      mockLLM,
      commits,
      aggregates,
      search,
    )
    const result = await enricher.run(() => {})

    expect(result.enrichedThisRun).toBe(0)
    expect(result.totalCommits).toBe(0)
  })
})
