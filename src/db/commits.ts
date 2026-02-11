import { Database } from "bun:sqlite"
import type { CommitInfo, CommitRow } from "@/types"

/** Repository for reading and writing commit records in the SQLite database. */
export class CommitRepository {
  private db: Database

  /** @param db - The SQLite database instance. */
  constructor(db: Database) {
    this.db = db
  }

  /**
   * Inserts commits and their associated files into the database in a single transaction.
   * Existing commits (by hash) are silently skipped.
   * @param commits - Array of parsed commit metadata to insert.
   */
  insertRawCommits(commits: CommitInfo[]): void {
    const insertCommit = this.db.prepare(`
      INSERT OR IGNORE INTO commits (hash, author_name, author_email, committed_at, message)
      VALUES (?, ?, ?, ?, ?)
    `)
    const insertFile = this.db.prepare(`
      INSERT OR IGNORE INTO commit_files (commit_hash, file_path, change_type, additions, deletions)
      VALUES (?, ?, ?, ?, ?)
    `)

    const transaction = this.db.transaction((commits: CommitInfo[]) => {
      for (const commit of commits) {
        insertCommit.run(
          commit.hash,
          commit.authorName,
          commit.authorEmail,
          commit.committedAt,
          commit.message,
        )
        for (const file of commit.files) {
          insertFile.run(
            commit.hash,
            file.filePath,
            file.changeType,
            file.additions,
            file.deletions,
          )
        }
      }
    })
    transaction(commits)
  }

  /** Returns all commits that have not yet been enriched by the LLM, ordered by date descending. */
  getUnenrichedCommits(): CommitRow[] {
    return this.db
      .query<
        CommitRow,
        []
      >("SELECT * FROM commits WHERE enriched_at IS NULL ORDER BY committed_at DESC")
      .all()
  }

  /**
   * Stores LLM enrichment results for a commit.
   * @param hash - The commit hash to update.
   * @param classification - The assigned classification label.
   * @param summary - The generated summary text.
   * @param model - The model identifier used for enrichment.
   */
  updateEnrichment(
    hash: string,
    classification: string,
    summary: string,
    model: string,
  ): void {
    this.db
      .prepare(
        `UPDATE commits SET classification = ?, summary = ?, enriched_at = ?, model_used = ?
       WHERE hash = ?`,
      )
      .run(classification, summary, new Date().toISOString(), model, hash)
  }

  /** Returns the set of all commit hashes currently stored in the database. */
  getIndexedHashes(): Set<string> {
    const rows = this.db
      .query<{ hash: string }, []>("SELECT hash FROM commits")
      .all()
    return new Set(rows.map((r) => r.hash))
  }

  /** Returns the total number of commits stored in the database. */
  getTotalCommitCount(): number {
    return this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM commits")
      .get()!.count
  }

  /** Returns the number of commits that have been successfully enriched. */
  getEnrichedCommitCount(): number {
    return this.db
      .query<
        { count: number },
        []
      >("SELECT COUNT(*) as count FROM commits WHERE enriched_at IS NOT NULL")
      .get()!.count
  }

  /**
   * Retrieves a single commit by its hash.
   * @param hash - The commit hash to look up.
   * @returns The commit row, or null if not found.
   */
  getCommit(hash: string): CommitRow | null {
    return (
      this.db
        .query<CommitRow, [string]>("SELECT * FROM commits WHERE hash = ?")
        .get(hash) ?? null
    )
  }
}
