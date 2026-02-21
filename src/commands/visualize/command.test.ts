import type { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"

import {
  handleDetails,
  normalizePathPrefix,
  parsePort,
} from "@commands/visualize/command"
import { AggregateRepository } from "@db/aggregates"
import { CommitRepository } from "@db/commits"
import { createDatabase } from "@db/database"

describe("parsePort", () => {
  test("parses valid port numbers", () => {
    expect(parsePort("3000")).toBe(3000)
    expect(parsePort("8080")).toBe(8080)
  })

  test("accepts port 0 (auto-assign)", () => {
    expect(parsePort("0")).toBe(0)
  })

  test("accepts port 65535 (max)", () => {
    expect(parsePort("65535")).toBe(65535)
  })

  test("rejects negative numbers", () => {
    expect(() => parsePort("-1")).toThrow("port must be between 0 and 65535")
  })

  test("rejects ports above 65535", () => {
    expect(() => parsePort("65536")).toThrow("port must be between 0 and 65535")
  })

  test("rejects non-numeric strings", () => {
    expect(() => parsePort("abc")).toThrow("port must be between 0 and 65535")
  })

  test("rejects empty string", () => {
    expect(() => parsePort("")).toThrow("port must be between 0 and 65535")
  })
})

describe("normalizePathPrefix", () => {
  test("adds trailing slash to directory path", () => {
    expect(normalizePathPrefix("src/commands")).toBe("src/commands/")
  })

  test("preserves existing trailing slash", () => {
    expect(normalizePathPrefix("src/commands/")).toBe("src/commands/")
  })

  test("removes leading ./", () => {
    expect(normalizePathPrefix("./src/commands/")).toBe("src/commands/")
  })

  test("removes leading /", () => {
    expect(normalizePathPrefix("/src/")).toBe("src/")
  })

  test("returns empty string for empty input", () => {
    expect(normalizePathPrefix("")).toBe("")
  })

  test("returns empty string for dot", () => {
    expect(normalizePathPrefix(".")).toBe("")
  })

  test("returns empty string for ./", () => {
    expect(normalizePathPrefix("./")).toBe("")
  })
})

describe("handleDetails", () => {
  function setup() {
    const db = createDatabase(":memory:")
    const commits = new CommitRepository(db)
    const aggregates = new AggregateRepository(db)
    return { db, commits, aggregates }
  }

  /** Seeds the database with enriched commits, file stats, contributors, and coupling data. */
  function seedData(db: Database) {
    // Insert enriched commits
    db.run(`
      INSERT INTO commits (hash, author_name, author_email, committed_at, message, classification, summary, enriched_at, model_used)
      VALUES
        ('aaa111', 'Alice', 'alice@test.com', '2025-01-15T00:00:00Z', 'fix: login bug', 'bug-fix', 'Fixed login', '2025-01-15T00:00:00Z', 'test'),
        ('bbb222', 'Bob', 'bob@test.com', '2025-02-10T00:00:00Z', 'feat: add dashboard', 'feature', 'Added dashboard', '2025-02-10T00:00:00Z', 'test'),
        ('ccc333', 'Alice', 'alice@test.com', '2025-03-05T00:00:00Z', 'refactor: clean up utils', 'refactor', 'Cleaned utils', '2025-03-05T00:00:00Z', 'test')
    `)

    // Insert commit files
    db.run(`
      INSERT INTO commit_files (commit_hash, file_path, change_type, additions, deletions)
      VALUES
        ('aaa111', 'src/auth.ts', 'M', 10, 5),
        ('aaa111', 'src/utils.ts', 'M', 3, 1),
        ('bbb222', 'src/auth.ts', 'M', 20, 2),
        ('bbb222', 'src/dashboard.ts', 'A', 100, 0),
        ('ccc333', 'src/utils.ts', 'M', 15, 8),
        ('ccc333', 'src/auth.ts', 'M', 5, 3)
    `)

    // Insert file stats with complexity data
    db.run(`
      INSERT INTO file_stats (file_path, total_changes, bug_fix_count, feature_count, refactor_count, docs_count, chore_count, perf_count, test_count, style_count, first_seen, last_changed, total_additions, total_deletions, current_loc, current_complexity)
      VALUES
        ('src/auth.ts', 3, 1, 1, 1, 0, 0, 0, 0, 0, '2025-01-15', '2025-03-05', 35, 10, 200, 45.0),
        ('src/utils.ts', 2, 1, 0, 1, 0, 0, 0, 0, 0, '2025-01-15', '2025-03-05', 18, 9, 80, 12.0),
        ('src/dashboard.ts', 1, 0, 1, 0, 0, 0, 0, 0, 0, '2025-02-10', '2025-02-10', 100, 0, 100, 20.0)
    `)

    // Insert file contributors
    db.run(`
      INSERT INTO file_contributors (file_path, author_name, author_email, commit_count)
      VALUES
        ('src/auth.ts', 'Alice', 'alice@test.com', 2),
        ('src/auth.ts', 'Bob', 'bob@test.com', 1),
        ('src/utils.ts', 'Alice', 'alice@test.com', 2),
        ('src/dashboard.ts', 'Bob', 'bob@test.com', 1)
    `)

    // Insert file coupling (files changed together at least twice)
    db.run(`
      INSERT INTO file_coupling (file_a, file_b, co_change_count)
      VALUES
        ('src/auth.ts', 'src/utils.ts', 2)
    `)
  }

  function makeUrl(path: string): URL {
    return new URL(
      `http://localhost/api/details?path=${encodeURIComponent(path)}`,
    )
  }

  test("returns root details for empty path", async () => {
    const { commits, aggregates } = setup()
    const res = handleDetails(makeUrl("/"), commits, aggregates, [])
    const data = await res.json()

    expect(data.type).toBe("root")
    expect(data.totalCommits).toBe(0)
    expect(data.enrichedCommits).toBe(0)
    expect(data.enrichmentPct).toBe(0)
    expect(data.hotspots).toEqual([])
    expect(data.coupledPairs).toEqual([])
  })

  test("returns root details when path param is missing", async () => {
    const { commits, aggregates } = setup()
    const url = new URL("http://localhost/api/details")
    const res = handleDetails(url, commits, aggregates, [])
    const data = await res.json()

    expect(data.type).toBe("root")
  })

  test("returns root details with hotspots, coupling, and enrichment percentage", async () => {
    const { db, commits, aggregates } = setup()
    seedData(db)

    const res = handleDetails(makeUrl(""), commits, aggregates, [])
    const data = await res.json()

    expect(data.type).toBe("root")
    expect(data.totalCommits).toBe(3)
    expect(data.enrichedCommits).toBe(3)
    expect(data.enrichmentPct).toBe(100)
    expect(data.hotspots.length).toBeGreaterThan(0)
    expect(data.hotspots[0]).toEqual(
      expect.objectContaining({
        file: expect.any(String),
        changes: expect.any(Number),
        score: expect.any(Number),
      }),
    )
    expect(data.coupledPairs.length).toBe(1)
    expect(data.coupledPairs[0]).toEqual({
      fileA: "src/auth.ts",
      fileB: "src/utils.ts",
      count: 2,
    })
    expect(data.trendSummary).not.toBeNull()
  })

  test("returns directory details for path ending in /", async () => {
    const { commits, aggregates } = setup()
    const res = handleDetails(makeUrl("src/"), commits, aggregates, [])
    const data = await res.json()

    expect(data.type).toBe("directory")
    expect(data.path).toBe("src/")
  })

  test("returns directory details with stats, hotspots, contributors, and coupling", async () => {
    const { db, commits, aggregates } = setup()
    seedData(db)

    const res = handleDetails(makeUrl("src/"), commits, aggregates, [])
    const data = await res.json()

    expect(data.type).toBe("directory")
    expect(data.path).toBe("src/")
    expect(data.fileCount).toBe(3)
    expect(data.stats).not.toBeNull()
    expect(data.stats.total_changes).toBeGreaterThan(0)

    expect(data.hotspots.length).toBeGreaterThan(0)
    expect(data.hotspots[0]).toEqual(
      expect.objectContaining({
        file: expect.any(String),
        changes: expect.any(Number),
        score: expect.any(Number),
      }),
    )

    expect(data.contributors.length).toBeGreaterThan(0)
    expect(data.contributors[0]).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        commits: expect.any(Number),
      }),
    )

    expect(data.trendSummary).not.toBeNull()
  })

  test("returns file details for file path", async () => {
    const { commits, aggregates } = setup()
    const res = handleDetails(makeUrl("src/main.ts"), commits, aggregates, [])
    const data = await res.json()

    expect(data.type).toBe("file")
    expect(data.path).toBe("src/main.ts")
    expect(data.stats).toBeNull()
  })

  test("returns file details with stats when file exists in db", async () => {
    const { db, commits, aggregates } = setup()

    db.run(
      `INSERT INTO commits (hash, author_name, author_email, committed_at, message, classification, enriched_at, model_used)
       VALUES ('abc123', 'Alice', 'alice@test.com', '2025-01-01T00:00:00Z', 'feat: add main', 'feature', '2025-01-01T00:00:00Z', 'test')`,
    )
    db.run(
      `INSERT INTO commit_files (commit_hash, file_path, change_type, additions, deletions)
       VALUES ('abc123', 'src/main.ts', 'A', 100, 0)`,
    )
    db.run(
      `INSERT INTO file_stats (file_path, total_changes, bug_fix_count, feature_count, refactor_count, docs_count, chore_count, perf_count, test_count, style_count, first_seen, last_changed, total_additions, total_deletions, current_loc)
       VALUES ('src/main.ts', 5, 1, 2, 1, 0, 1, 0, 0, 0, '2025-01-01', '2025-06-01', 200, 50, 150)`,
    )

    const res = handleDetails(makeUrl("src/main.ts"), commits, aggregates, [])
    const data = await res.json()

    expect(data.type).toBe("file")
    expect(data.stats).not.toBeNull()
    expect(data.stats.current_loc).toBe(150)
    expect(data.stats.total_changes).toBe(5)
  })

  test("returns file details with contributors and coupled files", async () => {
    const { db, commits, aggregates } = setup()
    seedData(db)

    const res = handleDetails(makeUrl("src/auth.ts"), commits, aggregates, [])
    const data = await res.json()

    expect(data.type).toBe("file")
    expect(data.path).toBe("src/auth.ts")
    expect(data.stats).not.toBeNull()

    expect(data.contributors.length).toBe(2)
    expect(data.contributors[0]).toEqual({
      name: "Alice",
      commits: 2,
    })
    expect(data.contributors[1]).toEqual({
      name: "Bob",
      commits: 1,
    })

    expect(data.coupled.length).toBe(1)
    expect(data.coupled[0]).toEqual(
      expect.objectContaining({
        file: "src/utils.ts",
        count: 2,
        ratio: expect.any(Number),
      }),
    )

    expect(data.trendSummary).not.toBeNull()
  })

  test("returns 500 with generic error message when an exception occurs", async () => {
    const { db, commits, aggregates } = setup()
    db.close()

    const res = handleDetails(makeUrl(""), commits, aggregates, [])

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe("Internal server error")
  })

  test("returns 500 with generic error for non-Error throws", async () => {
    const { commits, aggregates } = setup()
    const origMethod = commits.getTotalCommitCount.bind(commits)
    commits.getTotalCommitCount = () => {
      throw "something went wrong"
    }

    const res = handleDetails(makeUrl(""), commits, aggregates, [])

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe("Internal server error")

    commits.getTotalCommitCount = origMethod
  })

  test("returns root details with enrichmentPct when partially enriched", async () => {
    const { db, commits, aggregates } = setup()

    // Insert 2 commits, only 1 enriched
    db.run(`
      INSERT INTO commits (hash, author_name, author_email, committed_at, message, classification, enriched_at, model_used)
      VALUES ('aaa111', 'Alice', 'alice@test.com', '2025-01-15T00:00:00Z', 'fix: bug', 'bug-fix', '2025-01-15T00:00:00Z', 'test')
    `)
    db.run(`
      INSERT INTO commits (hash, author_name, author_email, committed_at, message)
      VALUES ('bbb222', 'Bob', 'bob@test.com', '2025-02-10T00:00:00Z', 'wip')
    `)

    const res = handleDetails(makeUrl(""), commits, aggregates, [])
    const data = await res.json()

    expect(data.type).toBe("root")
    expect(data.totalCommits).toBe(2)
    expect(data.enrichedCommits).toBe(1)
    expect(data.enrichmentPct).toBe(50)
  })

  test("filters deleted files from root hotspots and coupling when trackedFiles provided", async () => {
    const { db, commits, aggregates } = setup()
    seedData(db)

    // Only src/auth.ts exists in the working tree
    const trackedFiles = new Set(["src/auth.ts"])
    const res = handleDetails(
      makeUrl(""),
      commits,
      aggregates,
      [],
      trackedFiles,
    )
    const data = await res.json()

    expect(data.type).toBe("root")
    // Hotspots should only include src/auth.ts
    expect(data.hotspots.length).toBe(1)
    expect(data.hotspots[0].file).toBe("src/auth.ts")
    // Coupled pairs require both files in tracked set — src/utils.ts is deleted
    expect(data.coupledPairs.length).toBe(0)
  })

  test("filters deleted files from directory hotspots and coupling when trackedFiles provided", async () => {
    const { db, commits, aggregates } = setup()
    seedData(db)

    // Only src/auth.ts exists
    const trackedFiles = new Set(["src/auth.ts"])
    const res = handleDetails(
      makeUrl("src/"),
      commits,
      aggregates,
      [],
      trackedFiles,
    )
    const data = await res.json()

    expect(data.type).toBe("directory")
    expect(data.hotspots.length).toBe(1)
    expect(data.hotspots[0].file).toBe("src/auth.ts")
  })

  test("filters deleted files from file coupled list when trackedFiles provided", async () => {
    const { db, commits, aggregates } = setup()
    seedData(db)

    // src/utils.ts is deleted — should be filtered from src/auth.ts coupled files
    const trackedFiles = new Set(["src/auth.ts", "src/dashboard.ts"])
    const res = handleDetails(
      makeUrl("src/auth.ts"),
      commits,
      aggregates,
      [],
      trackedFiles,
    )
    const data = await res.json()

    expect(data.type).toBe("file")
    expect(data.coupled.length).toBe(0)
  })

  test("does not filter when trackedFiles is undefined", async () => {
    const { db, commits, aggregates } = setup()
    seedData(db)

    const res = handleDetails(makeUrl(""), commits, aggregates, [])
    const data = await res.json()

    expect(data.hotspots.length).toBe(3)
    expect(data.coupledPairs.length).toBe(1)
  })

  test("root path with pathPrefix returns directory response for prefix", async () => {
    const { db, commits, aggregates } = setup()
    seedData(db)

    const res = handleDetails(
      makeUrl("/"),
      commits,
      aggregates,
      [],
      undefined,
      "src/",
    )
    const data = await res.json()

    expect(data.type).toBe("directory")
    expect(data.path).toBe("src/")
    expect(data.fileCount).toBe(3)
    expect(data.hotspots.length).toBeGreaterThan(0)
  })

  test("directory request with pathPrefix prepends prefix to DB query", async () => {
    const { db, commits, aggregates } = setup()
    seedData(db)

    // Client sends "services/" but DB has "src/services/"
    db.run(`
      INSERT INTO file_stats (file_path, total_changes, bug_fix_count, feature_count, refactor_count, docs_count, chore_count, perf_count, test_count, style_count, first_seen, last_changed, total_additions, total_deletions)
      VALUES ('src/services/auth.ts', 5, 2, 1, 1, 0, 1, 0, 0, 0, '2025-01-01', '2025-06-01', 100, 20)
    `)

    const res = handleDetails(
      makeUrl("services/"),
      commits,
      aggregates,
      [],
      undefined,
      "src/",
    )
    const data = await res.json()

    expect(data.type).toBe("directory")
    // Response path should be stripped of prefix
    expect(data.path).toBe("services/")
  })

  test("file request with pathPrefix prepends prefix to DB query", async () => {
    const { db, commits, aggregates } = setup()
    seedData(db)

    // Client sends "auth.ts" but DB has "src/auth.ts"
    const res = handleDetails(
      makeUrl("auth.ts"),
      commits,
      aggregates,
      [],
      undefined,
      "src/",
    )
    const data = await res.json()

    expect(data.type).toBe("file")
    expect(data.path).toBe("auth.ts")
    expect(data.stats).not.toBeNull()
    expect(data.stats.current_loc).toBe(200)
  })

  test("pathPrefix strips prefix from hotspot and coupled file paths", async () => {
    const { db, commits, aggregates } = setup()
    seedData(db)

    const res = handleDetails(
      makeUrl("/"),
      commits,
      aggregates,
      [],
      undefined,
      "src/",
    )
    const data = await res.json()

    // Hotspot file paths should have prefix stripped
    for (const h of data.hotspots) {
      expect(h.file).not.toMatch(/^src\//)
    }
  })

  test("empty pathPrefix behaves identically to no pathPrefix", async () => {
    const { db, commits, aggregates } = setup()
    seedData(db)

    const resDefault = handleDetails(makeUrl(""), commits, aggregates, [])
    const resEmpty = handleDetails(
      makeUrl(""),
      commits,
      aggregates,
      [],
      undefined,
      "",
    )
    const dataDefault = await resDefault.json()
    const dataEmpty = await resEmpty.json()

    expect(dataDefault.type).toBe("root")
    expect(dataEmpty.type).toBe("root")
    expect(dataDefault.totalCommits).toBe(dataEmpty.totalCommits)
  })

  test("directory details include coupled files from outside the directory", async () => {
    const { db, commits, aggregates } = setup()

    db.run(`
      INSERT INTO commits (hash, author_name, author_email, committed_at, message, classification, enriched_at, model_used)
      VALUES ('aaa111', 'Alice', 'alice@test.com', '2025-01-15T00:00:00Z', 'fix: bug', 'bug-fix', '2025-01-15T00:00:00Z', 'test')
    `)
    db.run(`
      INSERT INTO file_stats (file_path, total_changes, bug_fix_count, feature_count, refactor_count, docs_count, chore_count, perf_count, test_count, style_count, first_seen, last_changed, total_additions, total_deletions)
      VALUES
        ('src/services/auth.ts', 5, 2, 1, 1, 0, 1, 0, 0, 0, '2025-01-01', '2025-06-01', 100, 20),
        ('lib/helpers.ts', 3, 1, 1, 0, 0, 1, 0, 0, 0, '2025-01-01', '2025-06-01', 50, 10)
    `)
    db.run(`
      INSERT INTO file_coupling (file_a, file_b, co_change_count)
      VALUES ('lib/helpers.ts', 'src/services/auth.ts', 3)
    `)

    const res = handleDetails(makeUrl("src/services/"), commits, aggregates, [])
    const data = await res.json()

    expect(data.type).toBe("directory")
    expect(data.coupled.length).toBe(1)
    expect(data.coupled[0]).toEqual(
      expect.objectContaining({
        file: "lib/helpers.ts",
        count: 3,
        ratio: expect.any(Number),
      }),
    )
  })
})
