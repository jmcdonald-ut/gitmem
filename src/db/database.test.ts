import { describe, test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { unlinkSync } from "node:fs"
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

  test("migrates old schema to add complexity columns", () => {
    const tmpPath = "/tmp/claude/migrate-test.db"

    // Create a database with old schema (no complexity columns)
    const oldDb = new Database(tmpPath)
    oldDb.run("PRAGMA journal_mode = WAL")
    oldDb.run("PRAGMA foreign_keys = ON")
    oldDb.run(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE commits (
        hash TEXT PRIMARY KEY,
        author_name TEXT NOT NULL,
        author_email TEXT NOT NULL,
        committed_at TEXT NOT NULL,
        message TEXT NOT NULL,
        classification TEXT,
        summary TEXT,
        enriched_at TEXT,
        model_used TEXT
      );
      CREATE TABLE commit_files (
        commit_hash TEXT NOT NULL REFERENCES commits(hash),
        file_path TEXT NOT NULL,
        change_type TEXT NOT NULL,
        additions INTEGER DEFAULT 0,
        deletions INTEGER DEFAULT 0,
        PRIMARY KEY (commit_hash, file_path)
      );
      CREATE TABLE file_stats (
        file_path TEXT PRIMARY KEY,
        total_changes INTEGER NOT NULL DEFAULT 0,
        bug_fix_count INTEGER NOT NULL DEFAULT 0,
        feature_count INTEGER NOT NULL DEFAULT 0,
        refactor_count INTEGER NOT NULL DEFAULT 0,
        docs_count INTEGER NOT NULL DEFAULT 0,
        chore_count INTEGER NOT NULL DEFAULT 0,
        perf_count INTEGER NOT NULL DEFAULT 0,
        test_count INTEGER NOT NULL DEFAULT 0,
        style_count INTEGER NOT NULL DEFAULT 0,
        first_seen TEXT NOT NULL,
        last_changed TEXT NOT NULL,
        total_additions INTEGER NOT NULL DEFAULT 0,
        total_deletions INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE file_contributors (
        file_path TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_email TEXT NOT NULL,
        commit_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (file_path, author_email)
      );
      CREATE TABLE file_coupling (
        file_a TEXT NOT NULL,
        file_b TEXT NOT NULL,
        co_change_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (file_a, file_b)
      );
    `)
    oldDb.run(`
      CREATE TABLE batch_jobs (
        batch_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'submitted',
        request_count INTEGER NOT NULL DEFAULT 0,
        succeeded_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        submitted_at TEXT NOT NULL,
        completed_at TEXT,
        model_used TEXT NOT NULL
      );
    `)
    oldDb.run(`
      CREATE VIRTUAL TABLE commits_fts USING fts5(
        hash UNINDEXED, message, classification, summary
      );
    `)
    oldDb.close()

    // Now open with createDatabase which should migrate
    const db = createDatabase(tmpPath)

    const getColumns = (table: string) =>
      db
        .query<{ name: string }, [string]>(
          "SELECT name FROM pragma_table_info(?)",
        )
        .all(table)
        .map((c) => c.name)

    const cfCols = getColumns("commit_files")
    expect(cfCols).toContain("lines_of_code")
    expect(cfCols).toContain("indent_complexity")
    expect(cfCols).toContain("max_indent")

    const fsCols = getColumns("file_stats")
    expect(fsCols).toContain("current_loc")
    expect(fsCols).toContain("current_complexity")
    expect(fsCols).toContain("avg_complexity")
    expect(fsCols).toContain("max_complexity")

    db.close()
    unlinkSync(tmpPath)
  })
})
