import type { Database } from "bun:sqlite"

import { InvalidQueryError } from "@/errors"
import type { SearchResult } from "@/types"

export { InvalidQueryError }

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
   * @param classification - Optional classification filter.
   * @returns Matching commits ordered by relevance rank.
   */
  search(
    query: string,
    limit: number = 20,
    classification?: string,
  ): SearchResult[] {
    try {
      if (classification) {
        return this.db
          .query<SearchResult, [string, string, number]>(
            `SELECT hash, message, classification, summary, rank
           FROM commits_fts
           WHERE commits_fts MATCH ?
             AND classification = ?
           ORDER BY rank
           LIMIT ?`,
          )
          .all(query, classification, limit)
      }
      return this.db
        .query<SearchResult, [string, number]>(
          `SELECT hash, message, classification, summary, rank
         FROM commits_fts
         WHERE commits_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
        )
        .all(query, limit)
    } catch (error) {
      throw new InvalidQueryError(query, error)
    }
  }

  /**
   * Indexes only the specified commits into the FTS index.
   * Assumes these commits are newly enriched and not yet in FTS.
   * @param hashes - Commit hashes to add to the index.
   */
  indexNewCommits(hashes: string[]): void {
    if (hashes.length === 0) return
    const CHUNK = 500
    for (let i = 0; i < hashes.length; i += CHUNK) {
      const chunk = hashes.slice(i, i + CHUNK)
      const placeholders = chunk.map(() => "?").join(", ")
      this.db
        .query(
          `INSERT INTO commits_fts (hash, message, classification, summary)
          SELECT hash, message, COALESCE(classification, ''), COALESCE(summary, '')
          FROM commits
          WHERE hash IN (${placeholders})`,
        )
        .run(...chunk)
    }
  }

  /** Drops and rebuilds the entire FTS index from all enriched commits. */
  rebuildIndex(): void {
    this.db.run("DELETE FROM commits_fts")
    this.db.run(`
      INSERT INTO commits_fts (hash, message, classification, summary)
      SELECT hash, message, COALESCE(classification, ''), COALESCE(summary, '')
      FROM commits
    `)
  }
}
