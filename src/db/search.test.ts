import { describe, test, expect, beforeEach } from "bun:test"
import { createDatabase } from "@db/database"
import { CommitRepository } from "@db/commits"
import { SearchService } from "@db/search"
import { Database } from "bun:sqlite"

describe("SearchService", () => {
  let db: Database
  let commits: CommitRepository
  let search: SearchService

  beforeEach(() => {
    db = createDatabase(":memory:")
    commits = new CommitRepository(db)
    search = new SearchService(db)
  })

  test("indexCommit makes commit searchable", () => {
    search.indexCommit(
      "abc",
      "fix login bug",
      "bug-fix",
      "Fixed null pointer in login flow",
    )
    const results = search.search("login")
    expect(results).toHaveLength(1)
    expect(results[0].hash).toBe("abc")
    expect(results[0].classification).toBe("bug-fix")
  })

  test("search returns results ranked by relevance", () => {
    search.indexCommit(
      "aaa",
      "update readme",
      "docs",
      "Updated readme with API docs",
    )
    search.indexCommit(
      "bbb",
      "fix auth bug",
      "bug-fix",
      "Fixed authentication bypass",
    )
    search.indexCommit(
      "ccc",
      "auth refactor",
      "refactor",
      "Refactored authentication module",
    )

    const results = search.search("auth")
    expect(results.length).toBeGreaterThanOrEqual(2)
    // Both auth-related commits should appear
    const hashes = results.map((r) => r.hash)
    expect(hashes).toContain("bbb")
    expect(hashes).toContain("ccc")
  })

  test("search respects limit", () => {
    for (let i = 0; i < 5; i++) {
      search.indexCommit(
        `hash${i}`,
        `fix bug ${i}`,
        "bug-fix",
        `Fixed bug number ${i}`,
      )
    }
    const results = search.search("bug", 2)
    expect(results).toHaveLength(2)
  })

  test("search returns empty for no matches", () => {
    search.indexCommit("abc", "fix login", "bug-fix", "Fixed login")
    const results = search.search("database")
    expect(results).toHaveLength(0)
  })

  test("rebuildIndex populates from enriched commits", () => {
    commits.insertRawCommits([
      {
        hash: "aaa",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "fix bug",
        files: [],
      },
      {
        hash: "bbb",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-02T00:00:00Z",
        message: "add feature",
        files: [],
      },
    ])
    commits.updateEnrichment("aaa", "bug-fix", "Fixed a bug", "haiku-4.5")
    // bbb is not enriched

    search.rebuildIndex()

    const results = search.search("bug")
    expect(results).toHaveLength(1)
    expect(results[0].hash).toBe("aaa")
  })

  test("rebuildIndex clears old data", () => {
    search.indexCommit("old", "old commit", "chore", "Old stuff")
    search.rebuildIndex()

    // "old" was not in the commits table, so it should be gone
    const results = search.search("old")
    expect(results).toHaveLength(0)
  })

  test("indexCommit replaces existing entry", () => {
    search.indexCommit("abc", "original", "bug-fix", "Original summary")
    search.indexCommit("abc", "updated", "feature", "Updated summary")

    const results = search.search("updated")
    expect(results).toHaveLength(1)
    expect(results[0].classification).toBe("feature")
  })
})
