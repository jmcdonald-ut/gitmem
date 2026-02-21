import { Database } from "bun:sqlite"
import { beforeEach, describe, expect, mock, test } from "bun:test"

import type {
  CheckProgress,
  IBatchJudgeService,
  IGitService,
  IJudgeService,
} from "@/types"
import { BatchJobRepository } from "@db/batch-jobs"
import { CommitRepository } from "@db/commits"
import { createDatabase } from "@db/database"
import { CheckerService } from "@services/checker"

describe("CheckerService", () => {
  let db: Database
  let commits: CommitRepository
  let mockGit: IGitService
  let mockJudge: IJudgeService

  beforeEach(() => {
    db = createDatabase(":memory:")
    commits = new CommitRepository(db)

    mockGit = {
      isGitRepo: mock(() => Promise.resolve(true)),
      getDefaultBranch: mock(() => Promise.resolve("main")),
      getCommitHashes: mock(() => Promise.resolve([])),
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
      getDiff: mock(() => Promise.resolve("diff content")),
      getDiffBatch: mock((hashes: string[]) => {
        const map = new Map<string, string>()
        for (const h of hashes) map.set(h, "diff content")
        return Promise.resolve(map)
      }),
      getTotalCommitCount: mock(() => Promise.resolve(0)),
      getFileContentsBatch: mock(() => Promise.resolve(new Map())),
      getTrackedFiles: mock(() => Promise.resolve([])),
      getRepoRoot: mock(() => Promise.resolve("/repo")),
    }

    mockJudge = {
      evaluateCommit: mock(() =>
        Promise.resolve({
          classificationVerdict: { pass: true, reasoning: "Correct" },
          accuracyVerdict: { pass: true, reasoning: "Accurate" },
          completenessVerdict: { pass: true, reasoning: "Complete" },
        }),
      ),
    }
  })

  test("checkOne evaluates a single enriched commit", async () => {
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
    commits.updateEnrichment("aaa", "feature", "Added feature", "haiku")

    const checker = new CheckerService(mockGit, mockJudge, commits)
    const progress: CheckProgress[] = []
    const result = await checker.checkOne("aaa", (p) => progress.push(p))

    expect(result).not.toBeNull()
    expect(result!.hash).toBe("aaa")
    expect(result!.classification).toBe("feature")
    expect(result!.summary).toBe("Added feature")
    expect(result!.classificationVerdict.pass).toBe(true)
    expect(progress.some((p) => p.phase === "evaluating")).toBe(true)
    expect(progress.some((p) => p.phase === "done")).toBe(true)
  })

  test("checkOne returns null for missing commit", async () => {
    const checker = new CheckerService(mockGit, mockJudge, commits)
    const result = await checker.checkOne("nonexistent", () => {})
    expect(result).toBeNull()
  })

  test("checkOne resolves partial hash", async () => {
    commits.insertRawCommits([
      {
        hash: "abc1234def5678",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "commit abc",
        files: [],
      },
    ])
    commits.updateEnrichment(
      "abc1234def5678",
      "feature",
      "Added feature",
      "haiku",
    )

    const checker = new CheckerService(mockGit, mockJudge, commits)
    const result = await checker.checkOne("abc1234", () => {})

    expect(result).not.toBeNull()
    expect(result!.hash).toBe("abc1234def5678")
  })

  test("checkOne throws on ambiguous partial hash", async () => {
    commits.insertRawCommits([
      {
        hash: "abc1234aaa",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "commit 1",
        files: [],
      },
      {
        hash: "abc1234bbb",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "commit 2",
        files: [],
      },
    ])
    commits.updateEnrichment("abc1234aaa", "feature", "summary a", "haiku")
    commits.updateEnrichment("abc1234bbb", "bug-fix", "summary b", "haiku")

    const checker = new CheckerService(mockGit, mockJudge, commits)
    await expect(checker.checkOne("abc1234", () => {})).rejects.toThrow(
      "Ambiguous hash prefix",
    )
  })

  test("checkOne returns null for partial hash with no matches", async () => {
    const checker = new CheckerService(mockGit, mockJudge, commits)
    const result = await checker.checkOne("zzz", () => {})
    expect(result).toBeNull()
  })

  test("checkOne returns null for unenriched commit", async () => {
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

    const checker = new CheckerService(mockGit, mockJudge, commits)
    const result = await checker.checkOne("aaa", () => {})
    expect(result).toBeNull()
  })

  test("checkSample evaluates random enriched commits", async () => {
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
      {
        hash: "ccc",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "commit ccc",
        files: [],
      },
    ])
    commits.updateEnrichment("aaa", "feature", "summary a", "haiku")
    commits.updateEnrichment("bbb", "bug-fix", "summary b", "haiku")
    commits.updateEnrichment("ccc", "refactor", "summary c", "haiku")

    const checker = new CheckerService(mockGit, mockJudge, commits)
    const progress: CheckProgress[] = []
    const { results, summary } = await checker.checkSample(3, (p) =>
      progress.push(p),
    )

    expect(results).toHaveLength(3)
    expect(summary.total).toBe(3)
    expect(summary.classificationCorrect).toBe(3)
    expect(summary.summaryAccurate).toBe(3)
    expect(summary.summaryComplete).toBe(3)
  })

  test("checkSample handles empty database", async () => {
    const checker = new CheckerService(mockGit, mockJudge, commits)
    const { results, summary } = await checker.checkSample(5, () => {})

    expect(results).toHaveLength(0)
    expect(summary.total).toBe(0)
  })

  test("checkSample uses getDiffBatch for pre-fetching", async () => {
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
    commits.updateEnrichment("aaa", "feature", "summary a", "haiku")
    commits.updateEnrichment("bbb", "bug-fix", "summary b", "haiku")

    const checker = new CheckerService(mockGit, mockJudge, commits)
    await checker.checkSample(2, () => {})

    expect(mockGit.getDiffBatch).toHaveBeenCalledTimes(1)
  })

  test("checkSample handles judge failures gracefully", async () => {
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
    commits.updateEnrichment("aaa", "feature", "summary a", "haiku")
    commits.updateEnrichment("bbb", "bug-fix", "summary b", "haiku")

    let callCount = 0
    const failingJudge: IJudgeService = {
      evaluateCommit: mock(async () => {
        callCount++
        if (callCount === 1) throw new Error("Judge error")
        return {
          classificationVerdict: { pass: true, reasoning: "OK" },
          accuracyVerdict: { pass: true, reasoning: "OK" },
          completenessVerdict: { pass: true, reasoning: "OK" },
        }
      }),
    }

    const checker = new CheckerService(mockGit, failingJudge, commits)
    const { results, summary } = await checker.checkSample(2, () => {})

    // One succeeded, one failed
    expect(results).toHaveLength(1)
    expect(summary.total).toBe(1)
  })

  test("checkSample respects concurrency", async () => {
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
      {
        hash: "ccc",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "commit ccc",
        files: [],
      },
      {
        hash: "ddd",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "commit ddd",
        files: [],
      },
    ])
    commits.updateEnrichment("aaa", "feature", "summary a", "haiku")
    commits.updateEnrichment("bbb", "bug-fix", "summary b", "haiku")
    commits.updateEnrichment("ccc", "refactor", "summary c", "haiku")
    commits.updateEnrichment("ddd", "chore", "summary d", "haiku")

    let maxConcurrent = 0
    let active = 0
    const trackingJudge: IJudgeService = {
      evaluateCommit: mock(async () => {
        active++
        maxConcurrent = Math.max(maxConcurrent, active)
        await new Promise((r) => setTimeout(r, 20))
        active--
        return {
          classificationVerdict: { pass: true, reasoning: "OK" },
          accuracyVerdict: { pass: true, reasoning: "OK" },
          completenessVerdict: { pass: true, reasoning: "OK" },
        }
      }),
    }

    const checker = new CheckerService(mockGit, trackingJudge, commits, 2)
    const { results } = await checker.checkSample(4, () => {})

    expect(results).toHaveLength(4)
    expect(maxConcurrent).toBeLessThanOrEqual(2)
  })

  test("checkSample counts failures correctly in summary", async () => {
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
    commits.updateEnrichment("aaa", "feature", "summary a", "haiku")
    commits.updateEnrichment("bbb", "bug-fix", "summary b", "haiku")

    let callCount = 0
    const mixedJudge: IJudgeService = {
      evaluateCommit: mock(async () => {
        callCount++
        if (callCount === 1) {
          return {
            classificationVerdict: {
              pass: false,
              reasoning: "Wrong",
              suggestedClassification: "refactor" as const,
            },
            accuracyVerdict: { pass: true, reasoning: "OK" },
            completenessVerdict: { pass: false, reasoning: "Missing" },
          }
        }
        return {
          classificationVerdict: { pass: true, reasoning: "OK" },
          accuracyVerdict: { pass: false, reasoning: "Inaccurate" },
          completenessVerdict: { pass: true, reasoning: "OK" },
        }
      }),
    }

    const checker = new CheckerService(mockGit, mixedJudge, commits)
    const { summary } = await checker.checkSample(2, () => {})

    expect(summary.total).toBe(2)
    expect(summary.classificationCorrect).toBe(1)
    expect(summary.summaryAccurate).toBe(1)
    expect(summary.summaryComplete).toBe(1)
  })

  test("evaluateOne throws when commit lacks classification/summary", async () => {
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
    // Do NOT enrich — classification and summary are null

    const checker = new CheckerService(mockGit, mockJudge, commits)
    const diffMap = new Map<string, string>([["aaa", "diff"]])
    // Access private method via bracket notation
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (checker as any).evaluateOne(commits.getCommit("aaa")!, diffMap),
    ).rejects.toThrow("Commit aaa missing classification/summary")
  })

  test("checkOne reconciles self-contradictory classification verdict", async () => {
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
    commits.updateEnrichment("aaa", "feature", "Added feature", "haiku")

    const contradictoryJudge: IJudgeService = {
      evaluateCommit: mock(async () => ({
        classificationVerdict: {
          pass: false,
          reasoning: "Should be feature",
          suggestedClassification: "feature" as const,
        },
        accuracyVerdict: { pass: true, reasoning: "OK" },
        completenessVerdict: { pass: true, reasoning: "OK" },
      })),
    }

    const checker = new CheckerService(mockGit, contradictoryJudge, commits)
    const result = await checker.checkOne("aaa", () => {})

    expect(result).not.toBeNull()
    expect(result!.classificationVerdict.pass).toBe(true)
  })

  test("checkSample reconciles self-contradictory classification verdict", async () => {
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
    commits.updateEnrichment("aaa", "refactor", "Refactored code", "haiku")

    const contradictoryJudge: IJudgeService = {
      evaluateCommit: mock(async () => ({
        classificationVerdict: {
          pass: false,
          reasoning: "Should be refactor",
          suggestedClassification: "refactor" as const,
        },
        accuracyVerdict: { pass: true, reasoning: "OK" },
        completenessVerdict: { pass: true, reasoning: "OK" },
      })),
    }

    const checker = new CheckerService(mockGit, contradictoryJudge, commits)
    const { results, summary } = await checker.checkSample(1, () => {})

    expect(results).toHaveLength(1)
    expect(results[0].classificationVerdict.pass).toBe(true)
    expect(summary.classificationCorrect).toBe(1)
  })

  test("checkSample reports progress", async () => {
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
    commits.updateEnrichment("aaa", "feature", "summary", "haiku")

    const checker = new CheckerService(mockGit, mockJudge, commits)
    const phases: string[] = []
    await checker.checkSample(1, (p) => phases.push(p.phase))

    expect(phases).toContain("evaluating")
    expect(phases).toContain("done")
  })

  test("checkOne auto-passes merge commit with empty diff", async () => {
    commits.insertRawCommits([
      {
        hash: "aaa",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "Merge branch 'feature' into main",
        files: [],
      },
    ])
    commits.updateEnrichment(
      "aaa",
      "chore",
      "Merge commit: Merge branch 'feature' into main",
      "haiku",
    )

    const mergeGit: IGitService = {
      ...mockGit,
      getCommitInfo: mock((hash: string) =>
        Promise.resolve({
          hash,
          authorName: "Test",
          authorEmail: "test@example.com",
          committedAt: "2024-01-01T00:00:00Z",
          message: "Merge branch 'feature' into main",
          files: [],
        }),
      ),
      getDiff: mock(() => Promise.resolve("")),
    }

    const checker = new CheckerService(mergeGit, mockJudge, commits)
    const result = await checker.checkOne("aaa", () => {})

    expect(result).not.toBeNull()
    expect(result!.classificationVerdict.pass).toBe(true)
    expect(result!.classificationVerdict.reasoning).toContain(
      "template-enriched",
    )
    expect(mockJudge.evaluateCommit).not.toHaveBeenCalled()
  })

  test("checkOne still evaluates merge commit with non-empty diff", async () => {
    commits.insertRawCommits([
      {
        hash: "aaa",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "Merge branch 'feature' into main",
        files: [],
      },
    ])
    commits.updateEnrichment("aaa", "feature", "Added feature", "haiku")

    const mergeGit: IGitService = {
      ...mockGit,
      getCommitInfo: mock((hash: string) =>
        Promise.resolve({
          hash,
          authorName: "Test",
          authorEmail: "test@example.com",
          committedAt: "2024-01-01T00:00:00Z",
          message: "Merge branch 'feature' into main",
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
    }

    const checker = new CheckerService(mergeGit, mockJudge, commits)
    const result = await checker.checkOne("aaa", () => {})

    expect(result).not.toBeNull()
    expect(mockJudge.evaluateCommit).toHaveBeenCalled()
  })

  test("checkSample backfills past merge commits with empty diffs", async () => {
    commits.insertRawCommits([
      {
        hash: "aaa",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "Merge branch 'feature' into main",
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
      {
        hash: "ccc",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "commit ccc",
        files: [],
      },
    ])
    commits.updateEnrichment(
      "aaa",
      "chore",
      "Merge commit: Merge branch 'feature' into main",
      "haiku",
    )
    commits.updateEnrichment("bbb", "feature", "summary b", "haiku")
    commits.updateEnrichment("ccc", "refactor", "summary c", "haiku")

    const mergeGit: IGitService = {
      ...mockGit,
      getDiffBatch: mock((hashes: string[]) => {
        const map = new Map<string, string>()
        for (const h of hashes) map.set(h, h === "aaa" ? "" : "diff content")
        return Promise.resolve(map)
      }),
    }

    const checker = new CheckerService(mergeGit, mockJudge, commits)
    const { results, summary } = await checker.checkSample(2, () => {})

    // Should get 2 results by backfilling past the merge commit
    expect(results).toHaveLength(2)
    expect(summary.total).toBe(2)
    const hashes = results.map((r) => r.hash).sort()
    expect(hashes).toEqual(["bbb", "ccc"])
  })

  test("checkSample handles all-merge-commit sample", async () => {
    commits.insertRawCommits([
      {
        hash: "aaa",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "Merge branch 'feature' into main",
        files: [],
      },
    ])
    commits.updateEnrichment(
      "aaa",
      "chore",
      "Merge commit: Merge branch 'feature' into main",
      "haiku",
    )

    const mergeGit: IGitService = {
      ...mockGit,
      getDiffBatch: mock((hashes: string[]) => {
        const map = new Map<string, string>()
        for (const h of hashes) map.set(h, "")
        return Promise.resolve(map)
      }),
    }

    const checker = new CheckerService(mergeGit, mockJudge, commits)
    const { results, summary } = await checker.checkSample(1, () => {})

    expect(results).toHaveLength(0)
    expect(summary.total).toBe(0)
    expect(mockJudge.evaluateCommit).not.toHaveBeenCalled()
  })

  describe("checkSampleBatch", () => {
    let batchJobs: BatchJobRepository

    beforeEach(() => {
      batchJobs = new BatchJobRepository(db)
    })

    function createMockBatchJudge(
      behavior: "submit" | "status-in-progress" | "status-ended",
    ): IBatchJudgeService {
      return {
        model: "claude-sonnet-4-5-20250929",
        submitBatch: mock(async () => ({
          batchId: "msgbatch_check_001",
          requestCount: 2,
        })),
        getBatchStatus: mock(async () => ({
          processingStatus:
            behavior === "status-in-progress" ? "in_progress" : "ended",
          requestCounts: {
            succeeded: 2,
            errored: 0,
            canceled: 0,
            expired: 0,
            processing: behavior === "status-in-progress" ? 2 : 0,
          },
        })),
        getBatchResults: mock(async () => [
          {
            hash: "aaa",
            result: {
              classificationVerdict: { pass: true, reasoning: "Correct" },
              accuracyVerdict: { pass: true, reasoning: "Accurate" },
              completenessVerdict: { pass: true, reasoning: "Complete" },
            },
          },
          {
            hash: "bbb",
            result: {
              classificationVerdict: {
                pass: false,
                reasoning: "Wrong",
                suggestedClassification: "refactor" as const,
              },
              accuracyVerdict: { pass: true, reasoning: "OK" },
              completenessVerdict: { pass: false, reasoning: "Missing" },
            },
          },
        ]),
      }
    }

    test("submits new batch when no pending exists", async () => {
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
      commits.updateEnrichment("aaa", "feature", "summary a", "haiku")
      commits.updateEnrichment("bbb", "bug-fix", "summary b", "haiku")

      const batchJudge = createMockBatchJudge("submit")
      const checker = new CheckerService(mockGit, mockJudge, commits)
      const progress: CheckProgress[] = []
      const result = await checker.checkSampleBatch(
        batchJudge,
        batchJobs,
        2,
        "/tmp/claude/check-batch.json",
        (p) => progress.push(p),
      )

      expect(result.kind).toBe("submitted")
      if (result.kind !== "submitted") throw new Error("unreachable")
      expect(result.batchId).toBe("msgbatch_check_001")
      expect(batchJudge.submitBatch).toHaveBeenCalledTimes(1)

      // Verify batch job was persisted
      const job = batchJobs.get("msgbatch_check_001")
      expect(job).not.toBeNull()
      expect(job!.type).toBe("check")

      // Verify check batch items were persisted
      const items = batchJobs.getCheckBatchItems("msgbatch_check_001")
      expect(items).toHaveLength(2)
    })

    test("polls in-progress batch and returns status", async () => {
      // Pre-insert a pending check batch
      batchJobs.insert(
        "msgbatch_pending",
        2,
        "claude-sonnet-4-5-20250929",
        "check",
      )

      const batchJudge = createMockBatchJudge("status-in-progress")
      const checker = new CheckerService(mockGit, mockJudge, commits)
      const result = await checker.checkSampleBatch(
        batchJudge,
        batchJobs,
        2,
        "/tmp/claude/check-batch.json",
        () => {},
      )

      expect(result.kind).toBe("in_progress")
      if (result.kind !== "in_progress") throw new Error("unreachable")
      expect(result.batchId).toBe("msgbatch_pending")
      expect(result.batchStatus).toBe("in_progress")
    })

    test("imports completed batch results", async () => {
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
      commits.updateEnrichment("aaa", "feature", "summary a", "haiku")
      commits.updateEnrichment("bbb", "bug-fix", "summary b", "haiku")

      // Pre-insert a pending check batch with items
      batchJobs.insert(
        "msgbatch_done",
        2,
        "claude-sonnet-4-5-20250929",
        "check",
      )
      batchJobs.insertCheckBatchItems([
        {
          batchId: "msgbatch_done",
          hash: "aaa",
          classification: "feature",
          summary: "summary a",
        },
        {
          batchId: "msgbatch_done",
          hash: "bbb",
          classification: "bug-fix",
          summary: "summary b",
        },
      ])

      const batchJudge = createMockBatchJudge("status-ended")
      const checker = new CheckerService(mockGit, mockJudge, commits)
      const outputPath = "/tmp/claude/check-batch-import.json"
      const result = await checker.checkSampleBatch(
        batchJudge,
        batchJobs,
        2,
        outputPath,
        () => {},
      )

      expect(result.kind).toBe("complete")
      if (result.kind !== "complete") throw new Error("unreachable")
      expect(result.results).toHaveLength(2)
      expect(result.summary.total).toBe(2)
      expect(result.summary.classificationCorrect).toBe(1)
      expect(result.summary.summaryAccurate).toBe(2)
      expect(result.summary.summaryComplete).toBe(1)
      expect(result.outputPath).toBe(outputPath)
    })

    test("handles empty sample", async () => {
      const batchJudge = createMockBatchJudge("submit")
      const checker = new CheckerService(mockGit, mockJudge, commits)
      const result = await checker.checkSampleBatch(
        batchJudge,
        batchJobs,
        5,
        "/tmp/claude/check-empty.json",
        () => {},
      )

      expect(result.kind).toBe("empty")
      if (result.kind !== "empty") throw new Error("unreachable")
      expect(result.results).toEqual([])
      expect(result.summary.total).toBe(0)
      expect(batchJudge.submitBatch).not.toHaveBeenCalled()
    })

    test("backfills past merge commits with empty diffs", async () => {
      commits.insertRawCommits([
        {
          hash: "aaa",
          authorName: "Test",
          authorEmail: "test@example.com",
          committedAt: "2024-01-01T00:00:00Z",
          message: "Merge branch 'feature' into main",
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
        {
          hash: "ccc",
          authorName: "Test",
          authorEmail: "test@example.com",
          committedAt: "2024-01-01T00:00:00Z",
          message: "commit ccc",
          files: [],
        },
      ])
      commits.updateEnrichment(
        "aaa",
        "chore",
        "Merge commit: Merge branch 'feature' into main",
        "haiku",
      )
      commits.updateEnrichment("bbb", "feature", "summary b", "haiku")
      commits.updateEnrichment("ccc", "refactor", "summary c", "haiku")

      const mergeGit: IGitService = {
        ...mockGit,
        getDiffBatch: mock((hashes: string[]) => {
          const map = new Map<string, string>()
          for (const h of hashes) map.set(h, h === "aaa" ? "" : "diff content")
          return Promise.resolve(map)
        }),
      }

      const batchJudge = createMockBatchJudge("submit")
      const checker = new CheckerService(mergeGit, mockJudge, commits)
      await checker.checkSampleBatch(
        batchJudge,
        batchJobs,
        2,
        "/tmp/claude/check-merge.json",
        () => {},
      )

      // Should submit 2 non-merge commits by backfilling past "aaa"
      const call = (batchJudge.submitBatch as ReturnType<typeof mock>).mock
        .calls[0] as unknown as [Array<{ hash: string }>]
      expect(call[0]).toHaveLength(2)
      const hashes = call[0].map((r: { hash: string }) => r.hash).sort()
      expect(hashes).toEqual(["bbb", "ccc"])
    })

    test("all-merge-commit sample returns empty results", async () => {
      commits.insertRawCommits([
        {
          hash: "aaa",
          authorName: "Test",
          authorEmail: "test@example.com",
          committedAt: "2024-01-01T00:00:00Z",
          message: "Merge branch 'feature' into main",
          files: [],
        },
      ])
      commits.updateEnrichment(
        "aaa",
        "chore",
        "Merge commit: Merge branch 'feature' into main",
        "haiku",
      )

      const mergeGit: IGitService = {
        ...mockGit,
        getDiffBatch: mock((hashes: string[]) => {
          const map = new Map<string, string>()
          for (const h of hashes) map.set(h, "")
          return Promise.resolve(map)
        }),
      }

      const batchJudge = createMockBatchJudge("submit")
      const checker = new CheckerService(mergeGit, mockJudge, commits)
      const result = await checker.checkSampleBatch(
        batchJudge,
        batchJobs,
        1,
        "/tmp/claude/check-all-merge.json",
        () => {},
      )

      expect(result.kind).toBe("empty")
      if (result.kind !== "empty") throw new Error("unreachable")
      expect(result.results).toEqual([])
      expect(result.summary.total).toBe(0)
      expect(batchJudge.submitBatch).not.toHaveBeenCalled()
    })

    test("reports progress through phases", async () => {
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
      commits.updateEnrichment("aaa", "feature", "summary a", "haiku")

      const batchJudge = createMockBatchJudge("submit")
      const checker = new CheckerService(mockGit, mockJudge, commits)
      const phases: string[] = []
      await checker.checkSampleBatch(
        batchJudge,
        batchJobs,
        1,
        "/tmp/claude/check-progress.json",
        (p) => phases.push(p.phase),
      )

      expect(phases).toContain("submitting")
      expect(phases).toContain("evaluating")
    })

    test("reconciles self-contradictory classification verdict on import", async () => {
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
      commits.updateEnrichment("aaa", "feature", "summary a", "haiku")

      batchJobs.insert(
        "msgbatch_reconcile",
        1,
        "claude-sonnet-4-5-20250929",
        "check",
      )
      batchJobs.insertCheckBatchItems([
        {
          batchId: "msgbatch_reconcile",
          hash: "aaa",
          classification: "feature",
          summary: "summary a",
        },
      ])

      const batchJudge: IBatchJudgeService = {
        model: "claude-sonnet-4-5-20250929",
        getBatchStatus: mock(async () => ({
          processingStatus: "ended",
          requestCounts: {
            succeeded: 1,
            errored: 0,
            canceled: 0,
            expired: 0,
            processing: 0,
          },
        })),
        getBatchResults: mock(async () => [
          {
            hash: "aaa",
            result: {
              classificationVerdict: {
                pass: false,
                reasoning: "Should be feature",
                suggestedClassification: "feature" as const,
              },
              accuracyVerdict: { pass: true, reasoning: "OK" },
              completenessVerdict: { pass: true, reasoning: "OK" },
            },
          },
        ]),
        submitBatch: mock(async () => ({ batchId: "", requestCount: 0 })),
      }

      const checker = new CheckerService(mockGit, mockJudge, commits)
      const result = await checker.checkSampleBatch(
        batchJudge,
        batchJobs,
        1,
        "/tmp/claude/check-reconcile.json",
        () => {},
      )

      // Contradictory verdict should be reconciled to pass
      expect(result.kind).toBe("complete")
      if (result.kind !== "complete") throw new Error("unreachable")
      expect(result.results[0].classificationVerdict.pass).toBe(true)
      expect(result.summary.classificationCorrect).toBe(1)
    })

    test("index and check batches do not interfere", async () => {
      // Insert an active index batch
      batchJobs.insert(
        "msgbatch_index",
        10,
        "claude-haiku-4-5-20251001",
        "index",
      )

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
      commits.updateEnrichment("aaa", "feature", "summary a", "haiku")

      const batchJudge = createMockBatchJudge("submit")
      const checker = new CheckerService(mockGit, mockJudge, commits)
      const result = await checker.checkSampleBatch(
        batchJudge,
        batchJobs,
        1,
        "/tmp/claude/check-no-interfere.json",
        () => {},
      )

      // Should submit a new check batch, not pick up the index batch
      expect(result.kind).toBe("submitted")
      expect(batchJudge.submitBatch).toHaveBeenCalledTimes(1)

      // Both batches should exist
      const all = batchJobs.getAll()
      expect(all).toHaveLength(2)
    })
  })
})
