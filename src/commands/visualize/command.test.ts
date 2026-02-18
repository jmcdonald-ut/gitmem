import { describe, test, expect } from "bun:test"
import { parsePort, handleDetails } from "@commands/visualize/command"
import { CommitRepository } from "@db/commits"
import { AggregateRepository } from "@db/aggregates"
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

describe("handleDetails", () => {
  function setup() {
    const db = createDatabase(":memory:")
    const commits = new CommitRepository(db)
    const aggregates = new AggregateRepository(db)
    return { db, commits, aggregates }
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

  test("returns directory details for path ending in /", async () => {
    const { commits, aggregates } = setup()
    const res = handleDetails(makeUrl("src/"), commits, aggregates, [])
    const data = await res.json()

    expect(data.type).toBe("directory")
    expect(data.path).toBe("src/")
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
})
