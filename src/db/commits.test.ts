import { Database } from "bun:sqlite"
import { beforeEach, describe, expect, test } from "bun:test"

import type { CommitInfo } from "@/types"
import { CommitRepository } from "@db/commits"
import { createDatabase } from "@db/database"

describe("CommitRepository", () => {
  let db: Database
  let repo: CommitRepository

  beforeEach(() => {
    db = createDatabase(":memory:")
    repo = new CommitRepository(db)
  })

  const makeCommit = (
    hash: string,
    extra?: Partial<CommitInfo>,
  ): CommitInfo => ({
    hash,
    authorName: "Test User",
    authorEmail: "test@example.com",
    committedAt: "2024-01-15T10:00:00Z",
    message: `commit ${hash}`,
    files: [
      {
        filePath: "src/main.ts",
        changeType: "M",
        additions: 10,
        deletions: 5,
      },
    ],
    ...extra,
  })

  test("insertRawCommits inserts commits and files", () => {
    repo.insertRawCommits([makeCommit("abc1234")])

    expect(repo.getTotalCommitCount()).toBe(1)
    const commit = repo.getCommit("abc1234")
    expect(commit).not.toBeNull()
    expect(commit!.author_name).toBe("Test User")
    expect(commit!.message).toBe("commit abc1234")

    const files = db
      .query<
        { file_path: string },
        [string]
      >("SELECT file_path FROM commit_files WHERE commit_hash = ?")
      .all("abc1234")
    expect(files).toHaveLength(1)
    expect(files[0].file_path).toBe("src/main.ts")
  })

  test("insertRawCommits skips duplicates", () => {
    repo.insertRawCommits([makeCommit("abc1234")])
    repo.insertRawCommits([makeCommit("abc1234")])
    expect(repo.getTotalCommitCount()).toBe(1)
  })

  test("insertRawCommits handles batch insert", () => {
    repo.insertRawCommits([
      makeCommit("aaa"),
      makeCommit("bbb"),
      makeCommit("ccc"),
    ])
    expect(repo.getTotalCommitCount()).toBe(3)
  })

  test("getUnenrichedCommits returns commits without enrichment", () => {
    repo.insertRawCommits([makeCommit("abc1234")])
    const unenriched = repo.getUnenrichedCommits()
    expect(unenriched).toHaveLength(1)
    expect(unenriched[0].hash).toBe("abc1234")
  })

  test("updateEnrichment sets classification and summary", () => {
    repo.insertRawCommits([makeCommit("abc1234")])
    repo.updateEnrichment(
      "abc1234",
      "bug-fix",
      "Fixed null pointer",
      "haiku-4.5",
    )

    const commit = repo.getCommit("abc1234")
    expect(commit!.classification).toBe("bug-fix")
    expect(commit!.summary).toBe("Fixed null pointer")
    expect(commit!.enriched_at).not.toBeNull()
    expect(commit!.model_used).toBe("haiku-4.5")
  })

  test("getUnenrichedCommits excludes enriched commits", () => {
    repo.insertRawCommits([makeCommit("abc1234"), makeCommit("def5678")])
    repo.updateEnrichment("abc1234", "feature", "Added login", "haiku-4.5")

    const unenriched = repo.getUnenrichedCommits()
    expect(unenriched).toHaveLength(1)
    expect(unenriched[0].hash).toBe("def5678")
  })

  test("getIndexedHashes returns all commit hashes", () => {
    repo.insertRawCommits([makeCommit("aaa"), makeCommit("bbb")])
    const hashes = repo.getIndexedHashes()
    expect(hashes.size).toBe(2)
    expect(hashes.has("aaa")).toBe(true)
    expect(hashes.has("bbb")).toBe(true)
  })

  test("getEnrichedCommitCount counts enriched commits", () => {
    repo.insertRawCommits([makeCommit("aaa"), makeCommit("bbb")])
    expect(repo.getEnrichedCommitCount()).toBe(0)

    repo.updateEnrichment("aaa", "feature", "summary", "haiku-4.5")
    expect(repo.getEnrichedCommitCount()).toBe(1)
  })

  test("getCommit returns null for missing hash", () => {
    expect(repo.getCommit("nonexistent")).toBeNull()
  })

  test("getUnenrichedCommits orders by committed_at DESC", () => {
    repo.insertRawCommits([
      makeCommit("old", { committedAt: "2024-01-01T00:00:00Z" }),
      makeCommit("new", { committedAt: "2024-06-01T00:00:00Z" }),
    ])
    const unenriched = repo.getUnenrichedCommits()
    expect(unenriched[0].hash).toBe("new")
    expect(unenriched[1].hash).toBe("old")
  })

  test("getCommitsByHashPrefix matches unique prefix", () => {
    repo.insertRawCommits([makeCommit("abc1234"), makeCommit("def5678")])
    const results = repo.getCommitsByHashPrefix("abc")
    expect(results).toHaveLength(1)
    expect(results[0].hash).toBe("abc1234")
  })

  test("getCommitsByHashPrefix returns multiple matches for ambiguous prefix", () => {
    repo.insertRawCommits([makeCommit("abc1234"), makeCommit("abc5678")])
    const results = repo.getCommitsByHashPrefix("abc")
    expect(results).toHaveLength(2)
  })

  test("getCommitsByHashPrefix returns empty for no matches", () => {
    repo.insertRawCommits([makeCommit("abc1234")])
    const results = repo.getCommitsByHashPrefix("zzz")
    expect(results).toHaveLength(0)
  })

  test("getCommitsByHashPrefix matches full hash exactly", () => {
    repo.insertRawCommits([makeCommit("abc1234")])
    const results = repo.getCommitsByHashPrefix("abc1234")
    expect(results).toHaveLength(1)
    expect(results[0].hash).toBe("abc1234")
  })

  test("getCommitsByHashPrefix respects limit", () => {
    repo.insertRawCommits([
      makeCommit("aaa111"),
      makeCommit("aaa222"),
      makeCommit("aaa333"),
    ])
    const results = repo.getCommitsByHashPrefix("aaa", 2)
    expect(results).toHaveLength(2)
  })

  test("getRandomEnrichedCommits returns only enriched commits", () => {
    repo.insertRawCommits([
      makeCommit("aaa"),
      makeCommit("bbb"),
      makeCommit("ccc"),
    ])
    repo.updateEnrichment("aaa", "feature", "summary a", "haiku-4.5")
    repo.updateEnrichment("bbb", "bug-fix", "summary b", "haiku-4.5")

    const results = repo.getRandomEnrichedCommits(10)
    expect(results).toHaveLength(2)
    const hashes = results.map((r) => r.hash).sort()
    expect(hashes).toEqual(["aaa", "bbb"])
  })

  test("getRandomEnrichedCommits respects limit", () => {
    repo.insertRawCommits([
      makeCommit("aaa"),
      makeCommit("bbb"),
      makeCommit("ccc"),
    ])
    repo.updateEnrichment("aaa", "feature", "summary a", "haiku-4.5")
    repo.updateEnrichment("bbb", "bug-fix", "summary b", "haiku-4.5")
    repo.updateEnrichment("ccc", "refactor", "summary c", "haiku-4.5")

    const results = repo.getRandomEnrichedCommits(2)
    expect(results).toHaveLength(2)
  })

  test("getRandomEnrichedCommits returns empty for no enriched commits", () => {
    repo.insertRawCommits([makeCommit("aaa")])
    const results = repo.getRandomEnrichedCommits(5)
    expect(results).toHaveLength(0)
  })

  test("getRandomEnrichedCommits excludes specified hashes", () => {
    repo.insertRawCommits([
      makeCommit("aaa"),
      makeCommit("bbb"),
      makeCommit("ccc"),
    ])
    repo.updateEnrichment("aaa", "feature", "summary a", "haiku-4.5")
    repo.updateEnrichment("bbb", "bug-fix", "summary b", "haiku-4.5")
    repo.updateEnrichment("ccc", "refactor", "summary c", "haiku-4.5")

    const results = repo.getRandomEnrichedCommits(10, new Set(["aaa", "bbb"]))
    expect(results).toHaveLength(1)
    expect(results[0].hash).toBe("ccc")
  })

  test("getCommitFilesByHashes returns files grouped by hash", () => {
    repo.insertRawCommits([
      makeCommit("aaa", {
        files: [
          {
            filePath: "src/main.ts",
            changeType: "M",
            additions: 10,
            deletions: 5,
          },
          {
            filePath: "src/utils.ts",
            changeType: "A",
            additions: 20,
            deletions: 0,
          },
        ],
      }),
      makeCommit("bbb", {
        files: [
          {
            filePath: "README.md",
            changeType: "M",
            additions: 3,
            deletions: 1,
          },
        ],
      }),
    ])

    const filesMap = repo.getCommitFilesByHashes(["aaa", "bbb"])
    expect(filesMap.get("aaa")).toHaveLength(2)
    expect(filesMap.get("aaa")![0].filePath).toBe("src/main.ts")
    expect(filesMap.get("aaa")![1].filePath).toBe("src/utils.ts")
    expect(filesMap.get("bbb")).toHaveLength(1)
    expect(filesMap.get("bbb")![0].filePath).toBe("README.md")
  })

  test("getCommitFilesByHashes returns empty arrays for commits with no files", () => {
    repo.insertRawCommits([makeCommit("aaa", { files: [] })])
    const filesMap = repo.getCommitFilesByHashes(["aaa"])
    expect(filesMap.get("aaa")).toHaveLength(0)
  })

  test("getCommitFilesByHashes handles empty input", () => {
    const filesMap = repo.getCommitFilesByHashes([])
    expect(filesMap.size).toBe(0)
  })

  test("getRecentCommitsForFile returns enriched commits for a file", () => {
    repo.insertRawCommits([
      makeCommit("aaa", {
        committedAt: "2024-01-01T00:00:00Z",
        files: [
          {
            filePath: "src/main.ts",
            changeType: "A",
            additions: 10,
            deletions: 0,
          },
        ],
      }),
      makeCommit("bbb", {
        committedAt: "2024-02-01T00:00:00Z",
        files: [
          {
            filePath: "src/main.ts",
            changeType: "M",
            additions: 5,
            deletions: 2,
          },
        ],
      }),
    ])
    repo.updateEnrichment("aaa", "feature", "Initial setup", "haiku-4.5")
    repo.updateEnrichment("bbb", "bug-fix", "Fix null check", "haiku-4.5")

    const results = repo.getRecentCommitsForFile("src/main.ts")
    expect(results).toHaveLength(2)
    expect(results[0].hash).toBe("bbb")
    expect(results[0].classification).toBe("bug-fix")
    expect(results[0].summary).toBe("Fix null check")
    expect(results[1].hash).toBe("aaa")
  })

  test("getRecentCommitsForFile includes unenriched commits with empty classification", () => {
    repo.insertRawCommits([
      makeCommit("aaa", {
        files: [
          {
            filePath: "src/main.ts",
            changeType: "A",
            additions: 10,
            deletions: 0,
          },
        ],
      }),
      makeCommit("bbb", {
        files: [
          {
            filePath: "src/main.ts",
            changeType: "M",
            additions: 5,
            deletions: 2,
          },
        ],
      }),
    ])
    repo.updateEnrichment("aaa", "feature", "Initial setup", "haiku-4.5")

    const results = repo.getRecentCommitsForFile("src/main.ts")
    expect(results).toHaveLength(2)
    expect(results[0].classification).toBe("feature")
    expect(results[1].classification).toBe("")
  })

  test("getRecentCommitsForFile respects limit", () => {
    repo.insertRawCommits([
      makeCommit("aaa", { committedAt: "2024-01-01T00:00:00Z" }),
      makeCommit("bbb", { committedAt: "2024-02-01T00:00:00Z" }),
      makeCommit("ccc", { committedAt: "2024-03-01T00:00:00Z" }),
    ])
    repo.updateEnrichment("aaa", "feature", "a", "haiku-4.5")
    repo.updateEnrichment("bbb", "bug-fix", "b", "haiku-4.5")
    repo.updateEnrichment("ccc", "refactor", "c", "haiku-4.5")

    const results = repo.getRecentCommitsForFile("src/main.ts", 2)
    expect(results).toHaveLength(2)
  })

  test("getRecentCommitsForFile returns empty for unknown file", () => {
    const results = repo.getRecentCommitsForFile("nonexistent.ts")
    expect(results).toHaveLength(0)
  })

  test("getRecentCommitsForDirectory matches files by prefix", () => {
    repo.insertRawCommits([
      makeCommit("aaa", {
        committedAt: "2024-01-01T00:00:00Z",
        files: [
          {
            filePath: "src/services/git.ts",
            changeType: "A",
            additions: 10,
            deletions: 0,
          },
        ],
      }),
      makeCommit("bbb", {
        committedAt: "2024-02-01T00:00:00Z",
        files: [
          {
            filePath: "src/services/llm.ts",
            changeType: "A",
            additions: 20,
            deletions: 0,
          },
        ],
      }),
      makeCommit("ccc", {
        committedAt: "2024-03-01T00:00:00Z",
        files: [
          {
            filePath: "src/db/commits.ts",
            changeType: "A",
            additions: 5,
            deletions: 0,
          },
        ],
      }),
    ])
    repo.updateEnrichment("aaa", "feature", "Add git service", "haiku-4.5")
    repo.updateEnrichment("bbb", "feature", "Add LLM service", "haiku-4.5")
    repo.updateEnrichment("ccc", "feature", "Add commits repo", "haiku-4.5")

    const results = repo.getRecentCommitsForDirectory("src/services/")
    expect(results).toHaveLength(2)
    expect(results[0].hash).toBe("bbb")
    expect(results[1].hash).toBe("aaa")
  })

  test("getRecentCommitsForDirectory deduplicates commits touching multiple files", () => {
    repo.insertRawCommits([
      makeCommit("aaa", {
        committedAt: "2024-01-01T00:00:00Z",
        files: [
          {
            filePath: "src/services/git.ts",
            changeType: "M",
            additions: 5,
            deletions: 1,
          },
          {
            filePath: "src/services/llm.ts",
            changeType: "M",
            additions: 3,
            deletions: 1,
          },
        ],
      }),
    ])
    repo.updateEnrichment("aaa", "refactor", "Refactor services", "haiku-4.5")

    const results = repo.getRecentCommitsForDirectory("src/services/")
    expect(results).toHaveLength(1)
    expect(results[0].hash).toBe("aaa")
  })

  test("getRecentCommitsForDirectory respects limit", () => {
    repo.insertRawCommits([
      makeCommit("aaa", {
        committedAt: "2024-01-01T00:00:00Z",
        files: [
          { filePath: "src/a.ts", changeType: "A", additions: 1, deletions: 0 },
        ],
      }),
      makeCommit("bbb", {
        committedAt: "2024-02-01T00:00:00Z",
        files: [
          { filePath: "src/b.ts", changeType: "A", additions: 1, deletions: 0 },
        ],
      }),
      makeCommit("ccc", {
        committedAt: "2024-03-01T00:00:00Z",
        files: [
          { filePath: "src/c.ts", changeType: "A", additions: 1, deletions: 0 },
        ],
      }),
    ])
    repo.updateEnrichment("aaa", "feature", "a", "haiku-4.5")
    repo.updateEnrichment("bbb", "feature", "b", "haiku-4.5")
    repo.updateEnrichment("ccc", "feature", "c", "haiku-4.5")

    const results = repo.getRecentCommitsForDirectory("src/", 2)
    expect(results).toHaveLength(2)
  })

  test("getRecentCommitsForDirectory returns empty for no matches", () => {
    const results = repo.getRecentCommitsForDirectory("nonexistent/")
    expect(results).toHaveLength(0)
  })

  test("getUnenrichedCommitsSince returns only unenriched commits on or after date", () => {
    repo.insertRawCommits([
      makeCommit("old", { committedAt: "2023-06-01T00:00:00Z" }),
      makeCommit("boundary", { committedAt: "2024-01-01T00:00:00Z" }),
      makeCommit("new", { committedAt: "2024-06-01T00:00:00Z" }),
    ])
    // Enrich one so it's excluded
    repo.updateEnrichment("new", "feature", "summary", "haiku-4.5")

    const results = repo.getUnenrichedCommitsSince("2024-01-01")
    expect(results).toHaveLength(1)
    expect(results[0].hash).toBe("boundary")
  })

  test("getUnenrichedCommitsSince returns empty when all are enriched", () => {
    repo.insertRawCommits([
      makeCommit("aaa", { committedAt: "2024-06-01T00:00:00Z" }),
    ])
    repo.updateEnrichment("aaa", "feature", "summary", "haiku-4.5")

    const results = repo.getUnenrichedCommitsSince("2024-01-01")
    expect(results).toHaveLength(0)
  })

  test("getUnenrichedCommitsSince orders by committed_at DESC", () => {
    repo.insertRawCommits([
      makeCommit("jan", { committedAt: "2024-01-15T00:00:00Z" }),
      makeCommit("jun", { committedAt: "2024-06-15T00:00:00Z" }),
      makeCommit("mar", { committedAt: "2024-03-15T00:00:00Z" }),
    ])

    const results = repo.getUnenrichedCommitsSince("2024-01-01")
    expect(results).toHaveLength(3)
    expect(results[0].hash).toBe("jun")
    expect(results[1].hash).toBe("mar")
    expect(results[2].hash).toBe("jan")
  })
})
