import type { Database } from "bun:sqlite"

import type {
  CommitFile,
  CommitFileRow,
  CommitInfo,
  CommitRow,
  RecentCommit,
} from "@/types"

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
   * Returns unenriched commits on or after the given date, ordered by date descending.
   * @param date - ISO date string (YYYY-MM-DD) to filter by committed_at.
   */
  getUnenrichedCommitsSince(date: string): CommitRow[] {
    return this.db
      .query<
        CommitRow,
        [string]
      >("SELECT * FROM commits WHERE enriched_at IS NULL AND committed_at >= ? ORDER BY committed_at DESC")
      .all(date)
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

  /**
   * Updates enrichment results for multiple commits in a single transaction.
   * @param updates - Array of enrichment results to write.
   * @param model - The model identifier used for enrichment.
   */
  updateEnrichmentBatch(
    updates: Array<{
      hash: string
      classification: string
      summary: string
    }>,
    model: string,
  ): void {
    const stmt = this.db.prepare(
      `UPDATE commits SET classification = ?, summary = ?, enriched_at = ?, model_used = ?
       WHERE hash = ?`,
    )
    const transaction = this.db.transaction(
      (
        updates: Array<{
          hash: string
          classification: string
          summary: string
        }>,
      ) => {
        const now = new Date().toISOString()
        for (const u of updates) {
          stmt.run(u.classification, u.summary, now, model, u.hash)
        }
      },
    )
    transaction(updates)
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
   * Returns N random enriched commits for quality evaluation.
   * @param n - Maximum number of commits to return.
   * @param excludeHashes - Hashes to exclude from selection.
   * @returns Array of enriched commit rows in random order.
   */
  getRandomEnrichedCommits(
    n: number,
    excludeHashes: Set<string> = new Set(),
    excludeTemplateMerges: boolean = false,
  ): CommitRow[] {
    const mergeFilter = excludeTemplateMerges
      ? " AND NOT (message LIKE 'Merge%' AND summary LIKE 'Merge commit:%')"
      : ""

    if (excludeHashes.size === 0) {
      return this.db
        .query<
          CommitRow,
          [number]
        >(`SELECT * FROM commits WHERE enriched_at IS NOT NULL${mergeFilter} ORDER BY RANDOM() LIMIT ?`)
        .all(n)
    }

    // Use temp table for large exclusion sets to stay within SQLite parameter limits
    const excluded = [...excludeHashes]
    const CHUNK = 500

    if (excluded.length <= CHUNK) {
      const placeholders = excluded.map(() => "?").join(", ")
      const params: (string | number)[] = [...excluded, n]
      return this.db
        .query<
          CommitRow,
          (string | number)[]
        >(`SELECT * FROM commits WHERE enriched_at IS NOT NULL AND hash NOT IN (${placeholders})${mergeFilter} ORDER BY RANDOM() LIMIT ?`)
        .all(...params)
    }

    this.db.run(
      "CREATE TEMP TABLE IF NOT EXISTS _exclude_hashes (hash TEXT PRIMARY KEY)",
    )
    this.db.run("DELETE FROM _exclude_hashes")
    const insertStmt = this.db.prepare(
      "INSERT OR IGNORE INTO _exclude_hashes (hash) VALUES (?)",
    )
    const insertTx = this.db.transaction((hashes: string[]) => {
      for (const h of hashes) insertStmt.run(h)
    })
    insertTx(excluded)

    const results = this.db
      .query<
        CommitRow,
        [number]
      >(`SELECT * FROM commits WHERE enriched_at IS NOT NULL AND hash NOT IN (SELECT hash FROM _exclude_hashes)${mergeFilter} ORDER BY RANDOM() LIMIT ?`)
      .all(n)

    this.db.run("DELETE FROM _exclude_hashes")
    return results
  }

  /**
   * Returns commits whose hash starts with the given prefix.
   * @param prefix - The hash prefix to match.
   * @param limit - Maximum number of results (default 10).
   * @returns Matching commit rows.
   */
  getCommitsByHashPrefix(prefix: string, limit: number = 10): CommitRow[] {
    return this.db
      .query<
        CommitRow,
        [string, number]
      >("SELECT * FROM commits WHERE hash LIKE ? || '%' LIMIT ?")
      .all(prefix, limit)
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

  /**
   * Returns file change info for multiple commits, grouped by commit hash.
   * @param hashes - The commit hashes to look up files for.
   * @returns Map from commit hash to array of CommitFile objects.
   */
  getCommitFilesByHashes(hashes: string[]): Map<string, CommitFile[]> {
    const result = new Map<string, CommitFile[]>()
    if (hashes.length === 0) return result

    // Initialize all hashes with empty arrays
    for (const h of hashes) {
      result.set(h, [])
    }

    // Query in chunks to stay within SQLite parameter limits
    const CHUNK = 500
    for (let i = 0; i < hashes.length; i += CHUNK) {
      const chunk = hashes.slice(i, i + CHUNK)
      const placeholders = chunk.map(() => "?").join(", ")
      const rows = this.db
        .query<CommitFileRow, string[]>(
          `SELECT commit_hash, file_path, change_type, additions, deletions
           FROM commit_files WHERE commit_hash IN (${placeholders})`,
        )
        .all(...chunk)

      for (const row of rows) {
        result.get(row.commit_hash)!.push({
          filePath: row.file_path,
          changeType: row.change_type,
          additions: row.additions,
          deletions: row.deletions,
        })
      }
    }

    return result
  }

  /**
   * Returns recent enriched commits that touched a specific file.
   * @param filePath - Exact file path to match.
   * @param limit - Maximum number of commits to return.
   * @returns Recent commits ordered by date descending.
   */
  getRecentCommitsForFile(filePath: string, limit: number = 5): RecentCommit[] {
    return this.db
      .query<RecentCommit, [string, number]>(
        `SELECT c.hash, COALESCE(c.classification, '') as classification, COALESCE(c.summary, '') as summary, c.committed_at
         FROM commits c
         JOIN commit_files cf ON cf.commit_hash = c.hash
         WHERE cf.file_path = ?
         ORDER BY c.committed_at DESC
         LIMIT ?`,
      )
      .all(filePath, limit)
  }

  /**
   * Returns commit_files rows that have not yet been measured for complexity.
   * @returns Rows where indent_complexity IS NULL.
   */
  getUnmeasuredFiles(): Pick<
    CommitFileRow,
    "commit_hash" | "file_path" | "change_type"
  >[] {
    return this.db
      .query<
        Pick<CommitFileRow, "commit_hash" | "file_path" | "change_type">,
        []
      >("SELECT commit_hash, file_path, change_type FROM commit_files WHERE indent_complexity IS NULL")
      .all()
  }

  /**
   * Updates complexity metrics for a specific file in a specific commit.
   * @param commitHash - The commit hash.
   * @param filePath - The file path.
   * @param linesOfCode - Non-blank line count.
   * @param indentComplexity - Sum of indentation levels.
   * @param maxIndent - Maximum indentation level.
   */
  updateComplexity(
    commitHash: string,
    filePath: string,
    linesOfCode: number,
    indentComplexity: number,
    maxIndent: number,
  ): void {
    this.db
      .prepare(
        `UPDATE commit_files SET lines_of_code = ?, indent_complexity = ?, max_indent = ?
       WHERE commit_hash = ? AND file_path = ?`,
      )
      .run(linesOfCode, indentComplexity, maxIndent, commitHash, filePath)
  }

  /**
   * Updates complexity metrics for multiple files in a single transaction.
   * @param updates - Array of complexity measurements to write.
   */
  updateComplexityBatch(
    updates: Array<{
      commitHash: string
      filePath: string
      linesOfCode: number
      indentComplexity: number
      maxIndent: number
    }>,
  ): void {
    const stmt = this.db.prepare(
      `UPDATE commit_files SET lines_of_code = ?, indent_complexity = ?, max_indent = ?
       WHERE commit_hash = ? AND file_path = ?`,
    )
    const transaction = this.db.transaction(
      (
        updates: Array<{
          commitHash: string
          filePath: string
          linesOfCode: number
          indentComplexity: number
          maxIndent: number
        }>,
      ) => {
        for (const u of updates) {
          stmt.run(
            u.linesOfCode,
            u.indentComplexity,
            u.maxIndent,
            u.commitHash,
            u.filePath,
          )
        }
      },
    )
    transaction(updates)
  }

  /**
   * Returns recent enriched commits that touched any file under a directory prefix.
   * @param prefix - Directory prefix to match (e.g. "src/services/").
   * @param limit - Maximum number of commits to return.
   * @returns Recent commits ordered by date descending, deduplicated.
   */
  getRecentCommitsForDirectory(
    prefix: string,
    limit: number = 5,
  ): RecentCommit[] {
    return this.db
      .query<RecentCommit, [string, number]>(
        `SELECT DISTINCT c.hash, COALESCE(c.classification, '') as classification, COALESCE(c.summary, '') as summary, c.committed_at
         FROM commits c
         JOIN commit_files cf ON cf.commit_hash = c.hash
         WHERE cf.file_path LIKE ? || '%'
         ORDER BY c.committed_at DESC
         LIMIT ?`,
      )
      .all(prefix, limit)
  }
}
