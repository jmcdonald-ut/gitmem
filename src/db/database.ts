import { Database } from "bun:sqlite"
import { copyFileSync, existsSync } from "node:fs"

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
  db.run("PRAGMA synchronous = NORMAL")
  db.run("PRAGMA cache_size = -64000")
  db.run("PRAGMA temp_store = MEMORY")
  db.run("PRAGMA busy_timeout = 5000")
  createSchema(db)
  if (needsMigration(db)) {
    if (path !== ":memory:" && existsSync(path)) {
      db.run("PRAGMA wal_checkpoint(TRUNCATE)")
      copyFileSync(path, `${path}.backup`)
    }
    migrateSchema(db)
  }
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
      lines_of_code INTEGER,
      indent_complexity REAL,
      max_indent INTEGER,
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
      total_deletions INTEGER NOT NULL DEFAULT 0,
      current_loc INTEGER,
      current_complexity REAL,
      avg_complexity REAL,
      max_complexity REAL
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
    CREATE TABLE IF NOT EXISTS batch_jobs (
      batch_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'submitted',
      request_count INTEGER NOT NULL DEFAULT 0,
      succeeded_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT NOT NULL,
      completed_at TEXT,
      model_used TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'index'
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS check_batch_items (
      batch_id TEXT NOT NULL REFERENCES batch_jobs(batch_id),
      hash TEXT NOT NULL,
      classification TEXT NOT NULL,
      summary TEXT NOT NULL,
      PRIMARY KEY (batch_id, hash)
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

  db.run(
    "CREATE INDEX IF NOT EXISTS idx_commit_files_file_path ON commit_files(file_path)",
  )
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_commits_enriched_at ON commits(enriched_at)",
  )
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const cols = db
    .query<{ name: string }, [string]>("SELECT name FROM pragma_table_info(?)")
    .all(table)
  return cols.some((c) => c.name === column)
}

/** Returns true if any known migration needs to run. */
function needsMigration(db: Database): boolean {
  return (
    !hasColumn(db, "commit_files", "lines_of_code") ||
    !hasColumn(db, "commit_files", "indent_complexity") ||
    !hasColumn(db, "commit_files", "max_indent") ||
    !hasColumn(db, "file_stats", "current_loc") ||
    !hasColumn(db, "file_stats", "current_complexity") ||
    !hasColumn(db, "file_stats", "avg_complexity") ||
    !hasColumn(db, "file_stats", "max_complexity") ||
    !hasColumn(db, "batch_jobs", "type")
  )
}

/**
 * Adds new columns to existing tables if they are missing.
 * Ensures both fresh and upgraded databases have the same schema.
 * @param db - The SQLite database instance.
 */
function migrateSchema(db: Database): void {
  // commit_files complexity columns
  if (!hasColumn(db, "commit_files", "lines_of_code")) {
    db.run("ALTER TABLE commit_files ADD COLUMN lines_of_code INTEGER")
  }
  if (!hasColumn(db, "commit_files", "indent_complexity")) {
    db.run("ALTER TABLE commit_files ADD COLUMN indent_complexity REAL")
  }
  if (!hasColumn(db, "commit_files", "max_indent")) {
    db.run("ALTER TABLE commit_files ADD COLUMN max_indent INTEGER")
  }

  // batch_jobs type column
  if (!hasColumn(db, "batch_jobs", "type")) {
    db.run(
      "ALTER TABLE batch_jobs ADD COLUMN type TEXT NOT NULL DEFAULT 'index'",
    )
  }

  // file_stats complexity columns
  if (!hasColumn(db, "file_stats", "current_loc")) {
    db.run("ALTER TABLE file_stats ADD COLUMN current_loc INTEGER")
  }
  if (!hasColumn(db, "file_stats", "current_complexity")) {
    db.run("ALTER TABLE file_stats ADD COLUMN current_complexity REAL")
  }
  if (!hasColumn(db, "file_stats", "avg_complexity")) {
    db.run("ALTER TABLE file_stats ADD COLUMN avg_complexity REAL")
  }
  if (!hasColumn(db, "file_stats", "max_complexity")) {
    db.run("ALTER TABLE file_stats ADD COLUMN max_complexity REAL")
  }
}
