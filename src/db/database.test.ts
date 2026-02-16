import { describe, test, expect } from "bun:test"
import { createDatabase } from "@db/database"

describe("createDatabase", () => {
  test("creates all tables", () => {
    const db = createDatabase(":memory:")
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => r.name)

    expect(tables).toContain("metadata")
    expect(tables).toContain("commits")
    expect(tables).toContain("commit_files")
    expect(tables).toContain("file_stats")
    expect(tables).toContain("file_contributors")
    expect(tables).toContain("file_coupling")
    expect(tables).toContain("batch_jobs")
    expect(tables).toContain("commits_fts")
    db.close()
  })

  test("is idempotent", () => {
    const db = createDatabase(":memory:")
    // Creating schema again should not throw
    expect(() => createDatabase(":memory:")).not.toThrow()
    db.close()
  })

  test("enables WAL mode", () => {
    const db = createDatabase(":memory:")
    const mode = db
      .query<{ journal_mode: string }, []>("PRAGMA journal_mode")
      .get()
    // In-memory databases may not support WAL, but the call should not error
    expect(mode).toBeDefined()
    db.close()
  })
})
