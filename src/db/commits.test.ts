import { describe, test, expect, beforeEach } from "bun:test"
import { createDatabase } from "@db/database"
import { CommitRepository } from "@db/commits"
import type { CommitInfo } from "@/types"
import { Database } from "bun:sqlite"

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
})
