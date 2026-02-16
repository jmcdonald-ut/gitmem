import { describe, test, expect, beforeEach, mock } from "bun:test"
import { createDatabase } from "@db/database"
import { CommitRepository } from "@db/commits"
import { CheckerService } from "@services/checker"
import type { IGitService, IJudgeService, CheckProgress } from "@/types"
import { Database } from "bun:sqlite"

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
              suggestedClassification: "bug-fix" as const,
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
})
