import { Database } from "bun:sqlite"
import type { FileStatsRow, FileContributorRow, FileCouplingRow } from "@/types"

/** Options for querying file hotspots. */
export interface HotspotsOptions {
  /** Maximum number of files to return (default 10). */
  limit?: number
  /** Sort field — "total" or a classification name (default "total"). */
  sort?: string
  /** Only include files under this directory prefix. */
  pathPrefix?: string
}

const SORT_COLUMNS: Record<string, string> = {
  total: "total_changes",
  "bug-fix": "bug_fix_count",
  feature: "feature_count",
  refactor: "refactor_count",
  docs: "docs_count",
  chore: "chore_count",
  perf: "perf_count",
  test: "test_count",
  style: "style_count",
}

/** Repository for computing and querying pre-aggregated file-level statistics. */
export class AggregateRepository {
  private db: Database

  /** @param db - The SQLite database instance. */
  constructor(db: Database) {
    this.db = db
  }

  /** Rebuilds the file_stats table by aggregating all enriched commit data per file. */
  rebuildFileStats(): void {
    this.db.run("DELETE FROM file_stats")
    this.db.run(`
      INSERT INTO file_stats (
        file_path, total_changes,
        bug_fix_count, feature_count, refactor_count, docs_count,
        chore_count, perf_count, test_count, style_count,
        first_seen, last_changed,
        total_additions, total_deletions
      )
      SELECT
        cf.file_path,
        COUNT(DISTINCT cf.commit_hash) as total_changes,
        COUNT(DISTINCT CASE WHEN c.classification = 'bug-fix' THEN cf.commit_hash END) as bug_fix_count,
        COUNT(DISTINCT CASE WHEN c.classification = 'feature' THEN cf.commit_hash END) as feature_count,
        COUNT(DISTINCT CASE WHEN c.classification = 'refactor' THEN cf.commit_hash END) as refactor_count,
        COUNT(DISTINCT CASE WHEN c.classification = 'docs' THEN cf.commit_hash END) as docs_count,
        COUNT(DISTINCT CASE WHEN c.classification = 'chore' THEN cf.commit_hash END) as chore_count,
        COUNT(DISTINCT CASE WHEN c.classification = 'perf' THEN cf.commit_hash END) as perf_count,
        COUNT(DISTINCT CASE WHEN c.classification = 'test' THEN cf.commit_hash END) as test_count,
        COUNT(DISTINCT CASE WHEN c.classification = 'style' THEN cf.commit_hash END) as style_count,
        MIN(c.committed_at) as first_seen,
        MAX(c.committed_at) as last_changed,
        COALESCE(SUM(cf.additions), 0) as total_additions,
        COALESCE(SUM(cf.deletions), 0) as total_deletions
      FROM commit_files cf
      JOIN commits c ON c.hash = cf.commit_hash
      WHERE c.enriched_at IS NOT NULL
      GROUP BY cf.file_path
    `)
  }

  /** Rebuilds the file_contributors table with per-file contributor commit counts. */
  rebuildFileContributors(): void {
    this.db.run("DELETE FROM file_contributors")
    this.db.run(`
      INSERT INTO file_contributors (file_path, author_name, author_email, commit_count)
      SELECT
        cf.file_path,
        c.author_name,
        c.author_email,
        COUNT(DISTINCT cf.commit_hash) as commit_count
      FROM commit_files cf
      JOIN commits c ON c.hash = cf.commit_hash
      GROUP BY cf.file_path, c.author_email
    `)
  }

  /** Rebuilds the file_coupling table with co-change counts for file pairs (minimum 2 co-changes). */
  rebuildFileCoupling(): void {
    this.db.run("DELETE FROM file_coupling")
    this.db.run(`
      INSERT INTO file_coupling (file_a, file_b, co_change_count)
      SELECT
        a.file_path as file_a,
        b.file_path as file_b,
        COUNT(DISTINCT a.commit_hash) as co_change_count
      FROM commit_files a
      JOIN commit_files b ON a.commit_hash = b.commit_hash AND a.file_path < b.file_path
      GROUP BY a.file_path, b.file_path
      HAVING co_change_count >= 2
    `)
  }

  /**
   * Returns the most frequently changed files.
   * @param options - Limit, sort field, and path prefix filter.
   * @returns Files ordered by the chosen sort column descending.
   */
  getHotspots(options: HotspotsOptions = {}): FileStatsRow[] {
    const { limit = 10, sort = "total", pathPrefix } = options
    const column = SORT_COLUMNS[sort]
    if (!column) {
      throw new Error(
        `Invalid sort field "${sort}". Valid values: ${Object.keys(SORT_COLUMNS).join(", ")}`,
      )
    }

    const conditions: string[] = []
    const params: (string | number)[] = []

    if (pathPrefix) {
      conditions.push("file_path LIKE ? || '%'")
      params.push(pathPrefix)
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
    params.push(limit)

    return this.db
      .query<
        FileStatsRow,
        (string | number)[]
      >(`SELECT * FROM file_stats ${where} ORDER BY ${column} DESC LIMIT ?`)
      .all(...params)
  }

  /**
   * Returns aggregate statistics for a single file.
   * @param filePath - Repository-relative file path.
   * @returns The file stats row, or null if the file has no recorded changes.
   */
  getFileStats(filePath: string): FileStatsRow | null {
    return (
      this.db
        .query<
          FileStatsRow,
          [string]
        >("SELECT * FROM file_stats WHERE file_path = ?")
        .get(filePath) ?? null
    )
  }

  /**
   * Returns the top contributors for a given file.
   * @param filePath - Repository-relative file path.
   * @param limit - Maximum number of contributors to return.
   * @returns Contributors ordered by commit count descending.
   */
  getTopContributors(
    filePath: string,
    limit: number = 5,
  ): FileContributorRow[] {
    return this.db
      .query<
        FileContributorRow,
        [string, number]
      >("SELECT * FROM file_contributors WHERE file_path = ? ORDER BY commit_count DESC LIMIT ?")
      .all(filePath, limit)
  }

  /**
   * Returns files most frequently changed alongside the given file.
   * @param filePath - Repository-relative file path.
   * @param limit - Maximum number of coupled files to return.
   * @returns Coupled file pairs ordered by co-change count descending.
   */
  getCoupledFiles(filePath: string, limit: number = 10): FileCouplingRow[] {
    return this.db
      .query<FileCouplingRow, [string, string, number]>(
        `SELECT * FROM file_coupling
       WHERE file_a = ? OR file_b = ?
       ORDER BY co_change_count DESC LIMIT ?`,
      )
      .all(filePath, filePath, limit)
  }
}
