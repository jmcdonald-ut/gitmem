import type { Database } from "bun:sqlite"
import { beforeEach, describe, expect, test } from "bun:test"

import { CommitRepository } from "@db/commits"
import { createDatabase } from "@db/database"
import { InvalidQueryError, SearchService } from "@db/search"

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

  test("search filters by classification", () => {
    search.indexCommit(
      "aaa",
      "fix auth bug",
      "bug-fix",
      "Fixed authentication bypass",
    )
    search.indexCommit(
      "bbb",
      "auth refactor",
      "refactor",
      "Refactored authentication module",
    )
    search.indexCommit(
      "ccc",
      "auth feature",
      "feature",
      "Added OAuth authentication",
    )

    const results = search.search("auth", 20, "bug-fix")
    expect(results).toHaveLength(1)
    expect(results[0].hash).toBe("aaa")
    expect(results[0].classification).toBe("bug-fix")
  })

  test("search without classification returns all matches", () => {
    search.indexCommit(
      "aaa",
      "fix auth bug",
      "bug-fix",
      "Fixed authentication bypass",
    )
    search.indexCommit(
      "bbb",
      "auth refactor",
      "refactor",
      "Refactored authentication module",
    )

    const results = search.search("auth", 20)
    expect(results).toHaveLength(2)
  })

  test("search with classification returns empty when no matches", () => {
    search.indexCommit(
      "aaa",
      "fix auth bug",
      "bug-fix",
      "Fixed authentication bypass",
    )

    const results = search.search("auth", 20, "feature")
    expect(results).toHaveLength(0)
  })

  test("indexNewCommits adds only specified commits to FTS", () => {
    commits.insertRawCommits([
      {
        hash: "aaa",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "fix login bug",
        files: [],
      },
      {
        hash: "bbb",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-02T00:00:00Z",
        message: "add dashboard feature",
        files: [],
      },
      {
        hash: "ccc",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-03T00:00:00Z",
        message: "refactor utils",
        files: [],
      },
    ])
    commits.updateEnrichment("aaa", "bug-fix", "Fixed login bug", "haiku-4.5")
    commits.updateEnrichment("bbb", "feature", "Added dashboard", "haiku-4.5")
    commits.updateEnrichment("ccc", "refactor", "Refactored utils", "haiku-4.5")

    // Only index aaa and bbb
    search.indexNewCommits(["aaa", "bbb"])

    const loginResults = search.search("login")
    expect(loginResults).toHaveLength(1)
    expect(loginResults[0].hash).toBe("aaa")

    const dashResults = search.search("dashboard")
    expect(dashResults).toHaveLength(1)
    expect(dashResults[0].hash).toBe("bbb")

    // ccc should not be in FTS
    const utilsResults = search.search("refactor utils")
    expect(utilsResults).toHaveLength(0)
  })

  test("indexNewCommits indexes unenriched commits by message", () => {
    commits.insertRawCommits([
      {
        hash: "aaa",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "unenriched commit",
        files: [],
      },
    ])

    // Don't enrich it, then index — should still be searchable by message
    search.indexNewCommits(["aaa"])

    const results = search.search("unenriched")
    expect(results).toHaveLength(1)
    expect(results[0].hash).toBe("aaa")
  })

  test("indexNewCommits with empty hashes is a no-op", () => {
    search.indexNewCommits([])
    // Should not throw and FTS should be empty
    const results = search.search("anything")
    expect(results).toHaveLength(0)
  })

  test("search with classification respects limit", () => {
    for (let i = 0; i < 5; i++) {
      search.indexCommit(
        `hash${i}`,
        `fix bug ${i}`,
        "bug-fix",
        `Fixed bug number ${i}`,
      )
    }
    const results = search.search("bug", 2, "bug-fix")
    expect(results).toHaveLength(2)
  })

  test("searchWithScope delegates to search when scope is empty", () => {
    search.indexCommit("aaa", "fix login bug", "bug-fix", "Fixed login")
    const results = search.searchWithScope("login", 20, undefined, {
      include: [],
      exclude: [],
    })
    expect(results).toHaveLength(1)
  })

  test("searchWithScope filters by file scope", () => {
    // Insert commits with file data
    commits.insertRawCommits([
      {
        hash: "aaa",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "fix login bug",
        files: [
          {
            filePath: "src/auth.ts",
            changeType: "M" as const,
            additions: 5,
            deletions: 2,
          },
        ],
      },
      {
        hash: "bbb",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-02T00:00:00Z",
        message: "fix database bug",
        files: [
          {
            filePath: "lib/db.ts",
            changeType: "M" as const,
            additions: 3,
            deletions: 1,
          },
        ],
      },
    ])
    commits.updateEnrichment("aaa", "bug-fix", "Fixed login", "haiku-4.5")
    commits.updateEnrichment("bbb", "bug-fix", "Fixed db", "haiku-4.5")
    search.indexNewCommits(["aaa", "bbb"])

    // Scope to src/ only
    const results = search.searchWithScope("fix", 20, undefined, {
      include: ["src/"],
      exclude: [],
    })
    expect(results).toHaveLength(1)
    expect(results[0].hash).toBe("aaa")
  })

  test("searchWithScope with classification and scope", () => {
    commits.insertRawCommits([
      {
        hash: "aaa",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "fix auth bug",
        files: [
          {
            filePath: "src/auth.ts",
            changeType: "M" as const,
            additions: 5,
            deletions: 2,
          },
        ],
      },
      {
        hash: "bbb",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-02T00:00:00Z",
        message: "auth refactor",
        files: [
          {
            filePath: "src/auth.ts",
            changeType: "M" as const,
            additions: 10,
            deletions: 5,
          },
        ],
      },
    ])
    commits.updateEnrichment("aaa", "bug-fix", "Fixed auth", "haiku-4.5")
    commits.updateEnrichment("bbb", "refactor", "Refactored auth", "haiku-4.5")
    search.indexNewCommits(["aaa", "bbb"])

    const results = search.searchWithScope("auth", 20, "bug-fix", {
      include: ["src/"],
      exclude: [],
    })
    expect(results).toHaveLength(1)
    expect(results[0].hash).toBe("aaa")
  })

  test("searchWithScope delegates to search when scope is undefined", () => {
    search.indexCommit("aaa", "fix login bug", "bug-fix", "Fixed login")
    const results = search.searchWithScope("login", 20, undefined, undefined)
    expect(results).toHaveLength(1)
  })

  test("search throws InvalidQueryError on unbalanced parentheses", () => {
    expect(() => search.search("auth(")).toThrow(InvalidQueryError)
    expect(() => search.search("auth(")).toThrow(/Invalid search query/)
  })

  test("search throws InvalidQueryError on malformed column filter", () => {
    expect(() => search.search("nosuchcol:value")).toThrow(InvalidQueryError)
  })

  test("search throws InvalidQueryError with classification filter too", () => {
    expect(() => search.search("auth(", 20, "bug-fix")).toThrow(
      InvalidQueryError,
    )
  })

  test("InvalidQueryError contains the original query text", () => {
    try {
      search.search('test"')
      throw new Error("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidQueryError)
      expect((error as InvalidQueryError).message).toContain('test"')
    }
  })
})
