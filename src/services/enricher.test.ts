import type { Database } from "bun:sqlite"
import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

import type { CommitInfo } from "@/types"
import { AggregateRepository } from "@db/aggregates"
import { BatchJobRepository } from "@db/batch-jobs"
import { CommitRepository } from "@db/commits"
import { createDatabase } from "@db/database"
import { SearchService } from "@db/search"
import type { BatchLLMService } from "@services/batch-llm"
import { EnricherService } from "@services/enricher"
import type { IGitService, ILLMService, IndexProgress } from "@services/types"

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
              changeType: "M" as const,
              additions: 10,
              deletions: 5,
            },
          ],
        }),
      ),
      getCommitInfoBatch: mock((hashes: string[]) =>
        Promise.resolve(
          hashes.map((hash) => ({
            hash,
            authorName: "Test",
            authorEmail: "test@example.com",
            committedAt: "2024-01-01T00:00:00Z",
            message: `commit ${hash}`,
            files: [
              {
                filePath: "src/main.ts",
                changeType: "M" as const,
                additions: 10,
                deletions: 5,
              },
            ],
          })),
        ),
      ),
      getDiff: mock(() => Promise.resolve("diff content")),
      getDiffBatch: mock((hashes: string[]) => {
        const map = new Map<string, string>()
        for (const h of hashes) map.set(h, "diff content")
        return Promise.resolve(map)
      }),
      getTotalCommitCount: mock(() => Promise.resolve(3)),
      getFileContentsBatch: mock(() => Promise.resolve(new Map())),
      getTrackedFiles: mock(() => Promise.resolve([])),
      getRepoRoot: mock(() => Promise.resolve("/repo")),
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
    const enricher = new EnricherService({
      git: mockGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })

    const progress: IndexProgress[] = []
    const result = await enricher.run((p) => progress.push(p))

    expect(result.discoveredThisRun).toBe(3)
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

    const enricher = new EnricherService({
      git: mockGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })
    const result = await enricher.run(() => {})

    // Should only enrich bbb and ccc
    expect(result.discoveredThisRun).toBe(2)
    expect(result.enrichedThisRun).toBe(2)
    expect(result.totalEnriched).toBe(3)
  })

  test("run handles LLM errors gracefully", async () => {
    const failingLLM: ILLMService = {
      enrichCommit: mock(() => Promise.reject(new Error("API error"))),
    }

    const enricher = new EnricherService({
      git: mockGit,
      llm: failingLLM,
      commits,
      aggregates,
      search,
    })

    // Suppress console.error for this test
    const consoleSpy = spyOn(console, "error").mockImplementation(() => {})

    const result = await enricher.run(() => {})

    expect(result.discoveredThisRun).toBe(3)
    expect(result.enrichedThisRun).toBe(0)
    expect(result.totalCommits).toBe(3)
    consoleSpy.mockRestore()
  })

  test("run reports progress phases", async () => {
    const enricher = new EnricherService({
      git: mockGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })

    const phases: string[] = []
    await enricher.run((p) => phases.push(p.phase))

    expect(phases).toContain("discovering")
    expect(phases).toContain("enriching")
    expect(phases).toContain("aggregating")
    expect(phases).toContain("indexing")
    expect(phases).toContain("done")
  })

  test("run respects abort signal between windows", async () => {
    // Use 6 commits with concurrency=2, abort after first window
    const sixHashGit: IGitService = {
      ...mockGit,
      getCommitHashes: mock(() =>
        Promise.resolve(["aaa", "bbb", "ccc", "ddd", "eee", "fff"]),
      ),
      getCommitInfoBatch: mock((hashes: string[]) =>
        Promise.resolve(
          hashes.map((hash) => ({
            hash,
            authorName: "Test",
            authorEmail: "test@example.com",
            committedAt: "2024-01-01T00:00:00Z",
            message: `commit ${hash}`,
            files: [
              {
                filePath: "src/main.ts",
                changeType: "M" as const,
                additions: 10,
                deletions: 5,
              },
            ],
          })),
        ),
      ),
      getDiffBatch: mock((hashes: string[]) => {
        const map = new Map<string, string>()
        for (const h of hashes) map.set(h, "diff content")
        return Promise.resolve(map)
      }),
      getTotalCommitCount: mock(() => Promise.resolve(6)),
    }

    const controller = new AbortController()
    let enrichCount = 0
    const trackingLLM: ILLMService = {
      enrichCommit: mock(async () => {
        enrichCount++
        // Abort after the first window completes (2 calls)
        if (enrichCount >= 2) controller.abort()
        return { classification: "feature" as const, summary: "summary" }
      }),
    }

    const enricher = new EnricherService({
      git: sixHashGit,
      llm: trackingLLM,
      commits,
      aggregates,
      search,
      concurrency: 2,
    })
    const result = await enricher.run(() => {}, controller.signal)

    // First window of 2 processed, then abort stops further windows
    expect(result.enrichedThisRun).toBe(2)
  })

  test("run uses incremental aggregates and search index", async () => {
    const incrStatsSpy = spyOn(aggregates, "rebuildFileStatsIncremental")
    const incrContribSpy = spyOn(
      aggregates,
      "rebuildFileContributorsIncremental",
    )
    const incrCouplingSpy = spyOn(aggregates, "rebuildFileCouplingIncremental")
    const incrSearchSpy = spyOn(search, "indexNewCommits")

    const enricher = new EnricherService({
      git: mockGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })
    await enricher.run(() => {})

    expect(incrStatsSpy).toHaveBeenCalledTimes(1)
    expect(incrContribSpy).toHaveBeenCalledTimes(1)
    expect(incrCouplingSpy).toHaveBeenCalledTimes(1)
    expect(incrSearchSpy).toHaveBeenCalledTimes(1)
  })

  test("run with no new commits skips aggregation and indexing", async () => {
    const emptyGit: IGitService = {
      ...mockGit,
      getCommitHashes: mock(() => Promise.resolve([])),
    }

    const incrStatsSpy = spyOn(aggregates, "rebuildFileStatsIncremental")
    const incrSearchSpy = spyOn(search, "indexNewCommits")

    const enricher = new EnricherService({
      git: emptyGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })
    const result = await enricher.run(() => {})

    expect(result.discoveredThisRun).toBe(0)
    expect(result.enrichedThisRun).toBe(0)
    expect(result.totalCommits).toBe(0)
    expect(incrStatsSpy).not.toHaveBeenCalled()
    expect(incrSearchSpy).not.toHaveBeenCalled()
  })

  test("run uses getDiffBatch for pre-fetching diffs", async () => {
    const enricher = new EnricherService({
      git: mockGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })
    await enricher.run(() => {})

    // getDiffBatch should have been called once with all unenriched hashes
    expect(mockGit.getDiffBatch).toHaveBeenCalledTimes(1)
  })

  test("run processes commits concurrently within windows", async () => {
    const callOrder: string[] = []
    const concurrentLLM: ILLMService = {
      enrichCommit: mock(async (commit: CommitInfo) => {
        callOrder.push(`start-${commit.hash}`)
        // Small delay to verify concurrent execution
        await new Promise((r) => setTimeout(r, 10))
        callOrder.push(`end-${commit.hash}`)
        return {
          classification: "feature" as const,
          summary: `Summary for ${commit.hash}`,
        }
      }),
    }

    // With concurrency 8 and 3 commits, all should be in one window
    const enricher = new EnricherService({
      git: mockGit,
      llm: concurrentLLM,
      commits,
      aggregates,
      search,
    })
    const result = await enricher.run(() => {})

    expect(result.enrichedThisRun).toBe(3)
    // All three starts should happen before any end (concurrent execution)
    const startIndices = callOrder
      .map((e, i) => (e.startsWith("start-") ? i : -1))
      .filter((i) => i >= 0)
    const endIndices = callOrder
      .map((e, i) => (e.startsWith("end-") ? i : -1))
      .filter((i) => i >= 0)
    // All starts should appear before the first end
    expect(Math.max(...startIndices)).toBeLessThan(Math.min(...endIndices))
  })

  test("run handles partial window failures", async () => {
    let callCount = 0
    const partialFailLLM: ILLMService = {
      enrichCommit: mock(async (commit: CommitInfo) => {
        callCount++
        // Fail the second call
        if (callCount === 2) {
          throw new Error("Partial failure")
        }
        return {
          classification: "feature" as const,
          summary: `Summary for ${commit.hash}`,
        }
      }),
    }

    const enricher = new EnricherService({
      git: mockGit,
      llm: partialFailLLM,
      commits,
      aggregates,
      search,
    })

    const consoleSpy = spyOn(console, "error").mockImplementation(() => {})
    const result = await enricher.run(() => {})
    consoleSpy.mockRestore()

    // 2 of 3 should succeed, the failed one stays unenriched
    expect(result.enrichedThisRun).toBe(2)
    expect(result.totalCommits).toBe(3)
  })

  test("run respects custom concurrency parameter", async () => {
    const fiveHashGit: IGitService = {
      ...mockGit,
      getCommitHashes: mock(() =>
        Promise.resolve(["aaa", "bbb", "ccc", "ddd", "eee"]),
      ),
      getCommitInfoBatch: mock((hashes: string[]) =>
        Promise.resolve(
          hashes.map((hash) => ({
            hash,
            authorName: "Test",
            authorEmail: "test@example.com",
            committedAt: "2024-01-01T00:00:00Z",
            message: `commit ${hash}`,
            files: [
              {
                filePath: "src/main.ts",
                changeType: "M" as const,
                additions: 10,
                deletions: 5,
              },
            ],
          })),
        ),
      ),
      getDiffBatch: mock((hashes: string[]) => {
        const map = new Map<string, string>()
        for (const h of hashes) map.set(h, "diff content")
        return Promise.resolve(map)
      }),
      getTotalCommitCount: mock(() => Promise.resolve(5)),
    }

    let maxConcurrentCalls = 0
    let activeCalls = 0
    const trackingLLM: ILLMService = {
      enrichCommit: mock(async (commit: CommitInfo) => {
        activeCalls++
        maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls)
        await new Promise((r) => setTimeout(r, 20))
        activeCalls--
        return {
          classification: "feature" as const,
          summary: `Summary for ${commit.hash}`,
        }
      }),
    }

    // Set concurrency to 2
    const enricher = new EnricherService({
      git: fiveHashGit,
      llm: trackingLLM,
      commits,
      aggregates,
      search,
      concurrency: 2,
    })
    const result = await enricher.run(() => {})

    expect(result.enrichedThisRun).toBe(5)
    // Max concurrent calls should not exceed concurrency
    expect(maxConcurrentCalls).toBeLessThanOrEqual(2)
  })

  // --- merge commit tests ---

  test("run auto-classifies merge commits with empty diffs without calling LLM", async () => {
    const mergeGit: IGitService = {
      ...mockGit,
      getCommitHashes: mock(() =>
        Promise.resolve(["merge1", "normal1", "merge2"]),
      ),
      getCommitInfoBatch: mock((hashes: string[]) =>
        Promise.resolve(
          hashes.map((hash) => ({
            hash,
            authorName: "Test",
            authorEmail: "test@example.com",
            committedAt: "2024-01-01T00:00:00Z",
            message: hash.startsWith("merge")
              ? "Merge pull request #42 from feature-branch"
              : `commit ${hash}`,
            files: [
              {
                filePath: "src/main.ts",
                changeType: "M" as const,
                additions: 10,
                deletions: 5,
              },
            ],
          })),
        ),
      ),
      getDiffBatch: mock((hashes: string[]) => {
        const map = new Map<string, string>()
        for (const h of hashes) {
          // Merge commits have empty diffs
          map.set(h, h.startsWith("merge") ? "" : "diff content")
        }
        return Promise.resolve(map)
      }),
      getTotalCommitCount: mock(() => Promise.resolve(3)),
    }

    const enricher = new EnricherService({
      git: mergeGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })
    const result = await enricher.run(() => {})

    expect(result.enrichedThisRun).toBe(3)

    // LLM should only be called for the non-merge commit
    expect(mockLLM.enrichCommit).toHaveBeenCalledTimes(1)

    // Verify merge commits got the template classification and summary
    const merge1 = commits.getCommit("merge1")
    expect(merge1!.classification).toBe("chore")
    expect(merge1!.summary).toBe(
      "Merge commit: Merge pull request #42 from feature-branch",
    )

    const merge2 = commits.getCommit("merge2")
    expect(merge2!.classification).toBe("chore")
  })

  test("run sends merge commits with non-empty diffs to LLM", async () => {
    const mergeWithDiffGit: IGitService = {
      ...mockGit,
      getCommitHashes: mock(() => Promise.resolve(["merge1"])),
      getCommitInfoBatch: mock((hashes: string[]) =>
        Promise.resolve(
          hashes.map((hash) => ({
            hash,
            authorName: "Test",
            authorEmail: "test@example.com",
            committedAt: "2024-01-01T00:00:00Z",
            message: "Merge branch 'feature' with conflicts",
            files: [
              {
                filePath: "src/main.ts",
                changeType: "M" as const,
                additions: 10,
                deletions: 5,
              },
            ],
          })),
        ),
      ),
      getDiffBatch: mock((hashes: string[]) => {
        const map = new Map<string, string>()
        for (const h of hashes) map.set(h, "actual conflict resolution diff")
        return Promise.resolve(map)
      }),
      getTotalCommitCount: mock(() => Promise.resolve(1)),
    }

    const enricher = new EnricherService({
      git: mergeWithDiffGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })
    const result = await enricher.run(() => {})

    // Merge commit with a diff should still go to LLM
    expect(mockLLM.enrichCommit).toHaveBeenCalledTimes(1)
    expect(result.enrichedThisRun).toBe(1)
  })

  // --- runBatch tests ---

  test("runBatch submits batch when unenriched commits exist", async () => {
    const batchJobs = new BatchJobRepository(db)
    const mockBatchLLM = {
      submitBatch: mock(() =>
        Promise.resolve({ batchId: "msgbatch_001", requestCount: 3 }),
      ),
      getBatchStatus: mock(() => Promise.resolve({})),
      getBatchResults: mock(() => Promise.resolve([])),
    } as unknown as BatchLLMService

    const enricher = new EnricherService({
      git: mockGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })

    const progress: IndexProgress[] = []
    const result = await enricher.runBatch(
      batchLLM(mockBatchLLM),
      batchJobs,
      (p) => progress.push(p),
    )

    expect(result.batchId).toBe("msgbatch_001")
    expect(result.batchStatus).toBe("submitted")
    expect(result.discoveredThisRun).toBe(3)
    expect(result.enrichedThisRun).toBe(0)

    // Verify batch was persisted
    const job = batchJobs.get("msgbatch_001")
    expect(job).not.toBeNull()
    expect(job!.request_count).toBe(3)
  })

  test("runBatch ignores pending check batches (type isolation)", async () => {
    const batchJobs = new BatchJobRepository(db)
    // Pre-insert a pending CHECK batch — enricher should ignore it
    batchJobs.insert(
      "msgbatch_check_pending",
      5,
      "claude-sonnet-4-5-20250929",
      "check",
    )

    const mockBatchLLM = {
      submitBatch: mock(() =>
        Promise.resolve({ batchId: "msgbatch_index_new", requestCount: 3 }),
      ),
      getBatchStatus: mock(() => Promise.resolve({})),
      getBatchResults: mock(() => Promise.resolve([])),
    } as unknown as BatchLLMService

    const enricher = new EnricherService({
      git: mockGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })

    const result = await enricher.runBatch(
      batchLLM(mockBatchLLM),
      batchJobs,
      () => {},
    )

    // Should submit a NEW index batch, not pick up the check batch
    expect(result.batchId).toBe("msgbatch_index_new")
    expect(result.batchStatus).toBe("submitted")
    expect(mockBatchLLM.getBatchStatus).not.toHaveBeenCalled()

    // Both batches should exist
    const all = batchJobs.getAll()
    expect(all).toHaveLength(2)
  })

  test("runBatch polls in-progress batch", async () => {
    const batchJobs = new BatchJobRepository(db)
    // Pre-insert commits and a pending batch
    commits.insertRawCommits([
      {
        hash: "aaa",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "commit aaa",
        files: [],
      },
    ])
    batchJobs.insert("msgbatch_pending", 1, "claude-haiku-4-5-20251001")

    const mockBatchLLM = {
      submitBatch: mock(() => Promise.resolve({})),
      getBatchStatus: mock(() =>
        Promise.resolve({
          processingStatus: "in_progress",
          requestCounts: {
            succeeded: 0,
            errored: 0,
            canceled: 0,
            expired: 0,
            processing: 1,
          },
        }),
      ),
      getBatchResults: mock(() => Promise.resolve([])),
    } as unknown as BatchLLMService

    const emptyGit: IGitService = {
      ...mockGit,
      getCommitHashes: mock(() => Promise.resolve(["aaa"])),
    }

    const enricher = new EnricherService({
      git: emptyGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })

    const result = await enricher.runBatch(
      batchLLM(mockBatchLLM),
      batchJobs,
      () => {},
    )

    expect(result.batchStatus).toBe("in_progress")
    expect(result.discoveredThisRun).toBe(0)
    expect(result.enrichedThisRun).toBe(0)
  })

  test("runBatch imports results from ended batch", async () => {
    const batchJobs = new BatchJobRepository(db)
    // Pre-insert commits and a pending batch
    commits.insertRawCommits([
      {
        hash: "aaa",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "commit aaa",
        files: [],
      },
    ])
    batchJobs.insert("msgbatch_done", 1, "claude-haiku-4-5-20251001")

    const mockBatchLLM = {
      submitBatch: mock(() => Promise.resolve({})),
      getBatchStatus: mock(() =>
        Promise.resolve({
          processingStatus: "ended",
          requestCounts: {
            succeeded: 1,
            errored: 0,
            canceled: 0,
            expired: 0,
            processing: 0,
          },
        }),
      ),
      getBatchResults: mock(() =>
        Promise.resolve([
          {
            hash: "aaa",
            result: { classification: "feature", summary: "Added feature" },
          },
        ]),
      ),
    } as unknown as BatchLLMService

    const singleGit: IGitService = {
      ...mockGit,
      getCommitHashes: mock(() => Promise.resolve(["aaa"])),
      getCommitInfoBatch: mock((hashes: string[]) =>
        Promise.resolve(
          hashes.map((hash) => ({
            hash,
            authorName: "Test",
            authorEmail: "test@example.com",
            committedAt: "2024-01-01T00:00:00Z",
            message: `commit ${hash}`,
            files: [],
          })),
        ),
      ),
      getTotalCommitCount: mock(() => Promise.resolve(1)),
    }

    const enricher = new EnricherService({
      git: singleGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })

    const result = await enricher.runBatch(
      batchLLM(mockBatchLLM),
      batchJobs,
      () => {},
    )

    expect(result.enrichedThisRun).toBe(1)
    expect(commits.getEnrichedCommitCount()).toBe(1)
  })

  test("runBatch handles partial failures in results", async () => {
    const batchJobs = new BatchJobRepository(db)
    commits.insertRawCommits([
      {
        hash: "aaa",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "commit aaa",
        files: [],
      },
      {
        hash: "bbb",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "commit bbb",
        files: [],
      },
    ])
    batchJobs.insert("msgbatch_partial", 2, "claude-haiku-4-5-20251001")

    const mockBatchLLM = {
      submitBatch: mock(() => Promise.resolve({})),
      getBatchStatus: mock(() =>
        Promise.resolve({
          processingStatus: "ended",
          requestCounts: {
            succeeded: 1,
            errored: 1,
            canceled: 0,
            expired: 0,
            processing: 0,
          },
        }),
      ),
      getBatchResults: mock(() =>
        Promise.resolve([
          {
            hash: "aaa",
            result: { classification: "feature", summary: "Added feature" },
          },
          { hash: "bbb", error: "Batch item errored" },
        ]),
      ),
    } as unknown as BatchLLMService

    const twoGit: IGitService = {
      ...mockGit,
      getCommitHashes: mock(() => Promise.resolve(["aaa", "bbb"])),
      getTotalCommitCount: mock(() => Promise.resolve(2)),
    }

    const enricher = new EnricherService({
      git: twoGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })

    const result = await enricher.runBatch(
      batchLLM(mockBatchLLM),
      batchJobs,
      () => {},
    )

    // Only aaa should be enriched, bbb stays unenriched
    expect(result.enrichedThisRun).toBe(1)
    expect(commits.getEnrichedCommitCount()).toBe(1)
  })

  test("runBatch handles merge commits locally and excludes them from batch submission", async () => {
    const batchJobs = new BatchJobRepository(db)

    const mergeGit: IGitService = {
      ...mockGit,
      getCommitHashes: mock(() =>
        Promise.resolve(["merge1", "normal1", "merge2"]),
      ),
      getCommitInfoBatch: mock((hashes: string[]) =>
        Promise.resolve(
          hashes.map((hash) => ({
            hash,
            authorName: "Test",
            authorEmail: "test@example.com",
            committedAt: "2024-01-01T00:00:00Z",
            message: hash.startsWith("merge")
              ? "Merge pull request #99 from dev"
              : `commit ${hash}`,
            files: [
              {
                filePath: "src/main.ts",
                changeType: "M" as const,
                additions: 10,
                deletions: 5,
              },
            ],
          })),
        ),
      ),
      getDiffBatch: mock((hashes: string[]) => {
        const map = new Map<string, string>()
        for (const h of hashes) {
          map.set(h, h.startsWith("merge") ? "" : "diff content")
        }
        return Promise.resolve(map)
      }),
      getTotalCommitCount: mock(() => Promise.resolve(3)),
    }

    const mockBatchLLM = {
      submitBatch: mock(() =>
        Promise.resolve({ batchId: "msgbatch_merge", requestCount: 1 }),
      ),
      getBatchStatus: mock(() => Promise.resolve({})),
      getBatchResults: mock(() => Promise.resolve([])),
    } as unknown as BatchLLMService

    const enricher = new EnricherService({
      git: mergeGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })

    await enricher.runBatch(batchLLM(mockBatchLLM), batchJobs, () => {})

    // 2 merge commits enriched locally
    expect(commits.getCommit("merge1")!.classification).toBe("chore")
    expect(commits.getCommit("merge2")!.classification).toBe("chore")

    // Batch should only contain the 1 non-merge commit
    expect(mockBatchLLM.submitBatch).toHaveBeenCalledTimes(1)
    const submittedRequests = (
      mockBatchLLM.submitBatch as ReturnType<typeof mock>
    ).mock.calls[0][0]
    expect(submittedRequests).toHaveLength(1)
    expect(submittedRequests[0].hash).toBe("normal1")
  })

  test("runBatch skips batch submission when all commits are merge commits", async () => {
    const batchJobs = new BatchJobRepository(db)

    const allMergeGit: IGitService = {
      ...mockGit,
      getCommitHashes: mock(() => Promise.resolve(["merge1", "merge2"])),
      getCommitInfoBatch: mock((hashes: string[]) =>
        Promise.resolve(
          hashes.map((hash) => ({
            hash,
            authorName: "Test",
            authorEmail: "test@example.com",
            committedAt: "2024-01-01T00:00:00Z",
            message: "Merge branch 'dev'",
            files: [],
          })),
        ),
      ),
      getDiffBatch: mock((hashes: string[]) => {
        const map = new Map<string, string>()
        for (const h of hashes) map.set(h, "")
        return Promise.resolve(map)
      }),
      getTotalCommitCount: mock(() => Promise.resolve(2)),
    }

    const mockBatchLLM = {
      submitBatch: mock(() => Promise.resolve({})),
      getBatchStatus: mock(() => Promise.resolve({})),
      getBatchResults: mock(() => Promise.resolve([])),
    } as unknown as BatchLLMService

    const enricher = new EnricherService({
      git: allMergeGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })

    const phases: string[] = []
    const result = await enricher.runBatch(
      batchLLM(mockBatchLLM),
      batchJobs,
      (p) => phases.push(p.phase),
    )

    // Both enriched locally, no batch submitted
    expect(result.enrichedThisRun).toBe(2)
    expect(mockBatchLLM.submitBatch).not.toHaveBeenCalled()
    // Should proceed to aggregation
    expect(phases).toContain("aggregating")
    expect(phases).toContain("done")
  })

  test("runBatch skips aggregation when no unenriched commits and no pending batch", async () => {
    const batchJobs = new BatchJobRepository(db)
    // Pre-insert all commits as already enriched
    commits.insertRawCommits([
      {
        hash: "aaa",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "commit aaa",
        files: [],
      },
    ])
    commits.updateEnrichment("aaa", "feature", "Already done", "haiku")

    const singleGit: IGitService = {
      ...mockGit,
      getCommitHashes: mock(() => Promise.resolve(["aaa"])),
      getTotalCommitCount: mock(() => Promise.resolve(1)),
    }

    const mockBatchLLM = {
      submitBatch: mock(() => Promise.resolve({})),
      getBatchStatus: mock(() => Promise.resolve({})),
      getBatchResults: mock(() => Promise.resolve([])),
    } as unknown as BatchLLMService

    const enricher = new EnricherService({
      git: singleGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })

    const phases: string[] = []
    const result = await enricher.runBatch(
      batchLLM(mockBatchLLM),
      batchJobs,
      (p) => phases.push(p.phase),
    )

    expect(result.enrichedThisRun).toBe(0)
    expect(phases).not.toContain("aggregating")
    expect(phases).not.toContain("indexing")
    expect(phases).toContain("done")
  })

  // --- chunkBatchRequests tests ---

  test("chunkBatchRequests splits by request count", () => {
    const enricher = new EnricherService({
      git: mockGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })

    const requests = Array.from({ length: 5 }, (_, i) => ({
      hash: `hash${i}`,
      commit: {
        hash: `hash${i}`,
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01",
        message: "commit",
        files: [],
      },
      diff: "small diff",
    }))

    // With small requests, they should all fit in one chunk
    const chunks = enricher.chunkBatchRequests(requests)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toHaveLength(5)
  })

  test("chunkBatchRequests splits by byte size", () => {
    const enricher = new EnricherService({
      git: mockGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })

    // MAX_BATCH_BYTES is 200MB. Use many requests at ~500k each to exceed the limit.
    // buildUserMessage truncates individual diffs, but the total across all
    // requests still accumulates toward the batch byte limit.
    const mediumDiff = "x".repeat(500_000) // ~500KB per diff (under per-message truncation limit)
    const requestCount = 500 // 500 * ~500KB ≈ 250MB, should exceed 200MB
    const requests = Array.from({ length: requestCount }, (_, i) => ({
      hash: `hash${i}`,
      commit: {
        hash: `hash${i}`,
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01",
        message: "commit",
        files: [],
      },
      diff: mediumDiff,
    }))

    const chunks = enricher.chunkBatchRequests(requests)
    expect(chunks.length).toBeGreaterThan(1)
    // Total requests across all chunks should equal original count
    const totalRequests = chunks.reduce((sum, c) => sum + c.length, 0)
    expect(totalRequests).toBe(requestCount)
  })

  test("chunkBatchRequests handles empty input", () => {
    const enricher = new EnricherService({
      git: mockGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
    })

    const chunks = enricher.chunkBatchRequests([])
    expect(chunks).toHaveLength(0)
  })

  // --- null LLM tests ---

  test("run with null LLM skips enrichment but still discovers and aggregates", async () => {
    const enricher = new EnricherService({
      git: mockGit,
      llm: null,
      commits,
      aggregates,
      search,
    })

    const phases: string[] = []
    const result = await enricher.run((p) => phases.push(p.phase))

    expect(result.discoveredThisRun).toBe(3)
    expect(result.enrichedThisRun).toBe(0)
    expect(result.totalEnriched).toBe(0)
    expect(result.totalCommits).toBe(3)
    // Should still aggregate and index (FTS works for unenriched commits)
    expect(phases).toContain("discovering")
    expect(phases).toContain("aggregating")
    expect(phases).toContain("indexing")
    expect(phases).toContain("done")
    expect(phases).not.toContain("enriching")
  })

  test("run with null LLM makes unenriched commits searchable by message", async () => {
    const enricher = new EnricherService({
      git: mockGit,
      llm: null,
      commits,
      aggregates,
      search,
    })

    await enricher.run(() => {})

    // Unenriched commits should be in FTS and searchable by message
    const results = search.search("commit aaa")
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].hash).toBe("aaa")
    expect(results[0].classification).toBe("")
  })

  test("runBatch with null LLM skips batch submission", async () => {
    const batchJobs = new BatchJobRepository(db)
    const mockBatchLLM = {
      submitBatch: mock(() => Promise.resolve({})),
      getBatchStatus: mock(() => Promise.resolve({})),
      getBatchResults: mock(() => Promise.resolve([])),
    } as unknown as BatchLLMService

    const enricher = new EnricherService({
      git: mockGit,
      llm: null,
      commits,
      aggregates,
      search,
    })

    const phases: string[] = []
    const result = await enricher.runBatch(
      batchLLM(mockBatchLLM),
      batchJobs,
      (p) => phases.push(p.phase),
    )

    expect(result.discoveredThisRun).toBe(3)
    expect(result.enrichedThisRun).toBe(0)
    expect(mockBatchLLM.submitBatch).not.toHaveBeenCalled()
    expect(phases).toContain("aggregating")
    expect(phases).toContain("done")
  })

  // --- date filtering tests ---

  test("run with aiStartDate only enriches commits after the date", async () => {
    const datedGit: IGitService = {
      ...mockGit,
      getCommitHashes: mock(() => Promise.resolve(["old1", "new1", "new2"])),
      getCommitInfoBatch: mock((hashes: string[]) =>
        Promise.resolve(
          hashes.map((hash) => ({
            hash,
            authorName: "Test",
            authorEmail: "test@example.com",
            committedAt: hash.startsWith("old")
              ? "2023-06-01T00:00:00Z"
              : "2024-06-01T00:00:00Z",
            message: `commit ${hash}`,
            files: [
              {
                filePath: "src/main.ts",
                changeType: "M" as const,
                additions: 10,
                deletions: 5,
              },
            ],
          })),
        ),
      ),
      getDiffBatch: mock((hashes: string[]) => {
        const map = new Map<string, string>()
        for (const h of hashes) map.set(h, "diff content")
        return Promise.resolve(map)
      }),
      getTotalCommitCount: mock(() => Promise.resolve(3)),
    }

    const enricher = new EnricherService({
      git: datedGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
      aiStartDate: "2024-01-01",
    })

    const result = await enricher.run(() => {})

    // All 3 discovered, but only 2 enriched (the ones after 2024-01-01)
    expect(result.discoveredThisRun).toBe(3)
    expect(result.enrichedThisRun).toBe(2)
    expect(result.totalCommits).toBe(3)

    // old1 should still be in FTS (searchable by message)
    const oldResults = search.search("commit old1")
    expect(oldResults.length).toBeGreaterThanOrEqual(1)
    expect(oldResults[0].classification).toBe("")
  })

  test("run with indexStartDate passes it to git.getCommitHashes", async () => {
    const enricher = new EnricherService({
      git: mockGit,
      llm: mockLLM,
      commits,
      aggregates,
      search,
      indexStartDate: "2024-01-01",
    })

    await enricher.run(() => {})

    expect(mockGit.getCommitHashes).toHaveBeenCalledWith("main", "2024-01-01")
  })
})

/** Helper to cast mock as BatchLLMService */
function batchLLM(m: unknown): BatchLLMService {
  return m as BatchLLMService
}
