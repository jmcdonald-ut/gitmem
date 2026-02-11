import { Database } from "bun:sqlite"

/**
 * Opens (or creates) the SQLite database at the given path, enables WAL mode
 * and foreign keys, and ensures all required tables exist.
 * @param path - Absolute path to the SQLite database file.
 * @returns The initialized Database instance.
 */
export function createDatabase(path: string): Database {
  const db = new Database(path)
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA foreign_keys = ON")
  createSchema(db)
  return db
}

/**
 * Creates all required tables and the FTS5 virtual table if they don't already exist.
 * @param db - The SQLite database instance.
 */
function createSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commits (
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

    CREATE TABLE IF NOT EXISTS commit_files (
      commit_hash TEXT NOT NULL REFERENCES commits(hash),
      file_path TEXT NOT NULL,
      change_type TEXT NOT NULL,
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      PRIMARY KEY (commit_hash, file_path)
    );

    CREATE TABLE IF NOT EXISTS file_stats (
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

    CREATE TABLE IF NOT EXISTS file_contributors (
      file_path TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL,
      commit_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (file_path, author_email)
    );

    CREATE TABLE IF NOT EXISTS file_coupling (
      file_a TEXT NOT NULL,
      file_b TEXT NOT NULL,
      co_change_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (file_a, file_b)
    );
  `)

  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS commits_fts USING fts5(
      hash UNINDEXED,
      message,
      classification,
      summary
    );
  `)
}
