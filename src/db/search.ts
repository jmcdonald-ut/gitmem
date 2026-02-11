import { Database } from "bun:sqlite"
import type { SearchResult } from "@/types"

/** Manages the FTS5 full-text search index over enriched commits. */
export class SearchService {
  private db: Database

  /** @param db - The SQLite database instance. */
  constructor(db: Database) {
    this.db = db
  }

  /**
   * Adds or replaces a single commit in the FTS index.
   * @param hash - The commit hash.
   * @param message - The commit message.
   * @param classification - The LLM-assigned classification.
   * @param summary - The LLM-generated summary.
   */
  indexCommit(
    hash: string,
    message: string,
    classification: string,
    summary: string,
  ): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO commits_fts (hash, message, classification, summary) VALUES (?, ?, ?, ?)",
      )
      .run(hash, message, classification, summary)
  }

  /**
   * Searches the FTS index for commits matching the query.
   * @param query - FTS5 match expression.
   * @param limit - Maximum number of results to return.
   * @returns Matching commits ordered by relevance rank.
   */
  search(query: string, limit: number = 20): SearchResult[] {
    return this.db
      .query<SearchResult, [string, number]>(
        `SELECT hash, message, classification, summary, rank
       FROM commits_fts
       WHERE commits_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      )
      .all(query, limit)
  }

  /** Drops and rebuilds the entire FTS index from all enriched commits. */
  rebuildIndex(): void {
    this.db.run("DELETE FROM commits_fts")
    this.db.run(`
      INSERT INTO commits_fts (hash, message, classification, summary)
      SELECT hash, message, classification, summary
      FROM commits
      WHERE enriched_at IS NOT NULL
    `)
  }
}
