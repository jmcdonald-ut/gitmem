import { Database } from "bun:sqlite"
import type {
  FileStatsRow,
  FileContributorRow,
  FileCouplingRow,
  CouplingPairRow,
  CouplingPairGlobalRow,
  TrendPeriod,
  TrendSummary,
} from "@/types"

/** SQL strftime expressions for grouping commits into time windows. */
export const WINDOW_FORMATS: Record<string, string> = {
  weekly: "strftime('%Y-W%W', c.committed_at)",
  monthly: "strftime('%Y-%m', c.committed_at)",
  quarterly:
    "strftime('%Y', c.committed_at) || '-Q' || ((CAST(strftime('%m', c.committed_at) AS INTEGER) - 1) / 3 + 1)",
}

/**
 * Computes a trend summary from an array of periods (most recent first).
 * Returns null if fewer than 2 periods are provided.
 */
export function computeTrend(periods: TrendPeriod[]): TrendSummary | null {
  if (periods.length < 2) return null

  const recentCount = periods.length < 6 ? Math.floor(periods.length / 2) : 3
  const recent = periods.slice(0, recentCount)
  const historical = periods.slice(recentCount)

  const recentAvg =
    recent.reduce((sum, p) => sum + p.total_changes, 0) / recent.length
  const historicalAvg =
    historical.reduce((sum, p) => sum + p.total_changes, 0) / historical.length

  const recentBugAvg =
    recent.reduce((sum, p) => sum + p.bug_fix_count, 0) / recent.length
  const historicalBugAvg =
    historical.reduce((sum, p) => sum + p.bug_fix_count, 0) / historical.length

  const computeDirection = (
    recentVal: number,
    historicalVal: number,
  ): "increasing" | "decreasing" | "stable" => {
    if (historicalVal === 0) {
      return recentVal > 0 ? "increasing" : "stable"
    }
    const ratio = recentVal / historicalVal
    if (ratio > 1.2) return "increasing"
    if (ratio < 0.8) return "decreasing"
    return "stable"
  }

  return {
    direction: computeDirection(recentAvg, historicalAvg),
    recent_avg: Math.round(recentAvg * 10) / 10,
    historical_avg: Math.round(historicalAvg * 10) / 10,
    bug_fix_trend: computeDirection(recentBugAvg, historicalBugAvg),
  }
}

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

  /**
   * Returns aggregated stats across all files under a directory prefix.
   * @param prefix - Directory prefix (e.g. "src/services/").
   * @returns Combined stats, or null if no files match.
   */
  getDirectoryStats(prefix: string): FileStatsRow | null {
    const row = this.db
      .query<FileStatsRow, [string]>(
        `SELECT
           ? as file_path,
           COALESCE(SUM(total_changes), 0) as total_changes,
           COALESCE(SUM(bug_fix_count), 0) as bug_fix_count,
           COALESCE(SUM(feature_count), 0) as feature_count,
           COALESCE(SUM(refactor_count), 0) as refactor_count,
           COALESCE(SUM(docs_count), 0) as docs_count,
           COALESCE(SUM(chore_count), 0) as chore_count,
           COALESCE(SUM(perf_count), 0) as perf_count,
           COALESCE(SUM(test_count), 0) as test_count,
           COALESCE(SUM(style_count), 0) as style_count,
           MIN(first_seen) as first_seen,
           MAX(last_changed) as last_changed,
           COALESCE(SUM(total_additions), 0) as total_additions,
           COALESCE(SUM(total_deletions), 0) as total_deletions
         FROM file_stats
         WHERE file_path LIKE ? || '%'`,
      )
      .get(prefix, prefix)
    if (!row || row.first_seen === null) return null
    return row
  }

  /**
   * Returns aggregated contributors across all files under a directory prefix.
   * @param prefix - Directory prefix (e.g. "src/services/").
   * @param limit - Maximum number of contributors to return.
   * @returns Contributors ordered by total commit count descending.
   */
  getDirectoryContributors(
    prefix: string,
    limit: number = 5,
  ): FileContributorRow[] {
    return this.db
      .query<FileContributorRow, [string, string, number]>(
        `SELECT
           ? as file_path,
           author_name,
           author_email,
           SUM(commit_count) as commit_count
         FROM file_contributors
         WHERE file_path LIKE ? || '%'
         GROUP BY author_email
         ORDER BY commit_count DESC
         LIMIT ?`,
      )
      .all(prefix, prefix, limit)
  }

  /**
   * Returns the number of distinct files under a directory prefix.
   * @param prefix - Directory prefix (e.g. "src/services/").
   * @returns Count of files matching the prefix.
   */
  getDirectoryFileCount(prefix: string): number {
    return this.db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) as count FROM file_stats WHERE file_path LIKE ? || '%'")
      .get(prefix)!.count
  }

  /**
   * Returns the top co-change pairs ranked by co_change_count.
   * @param limit - Maximum number of pairs to return.
   * @returns Pairs ordered by co-change count descending.
   */
  getTopCoupledPairs(limit: number = 10): CouplingPairGlobalRow[] {
    return this.db
      .query<CouplingPairGlobalRow, [number]>(
        `SELECT file_a, file_b, co_change_count
         FROM file_coupling
         ORDER BY co_change_count DESC
         LIMIT ?`,
      )
      .all(limit)
  }

  /**
   * Returns files most frequently changed alongside the given file, with coupling ratio.
   * @param filePath - Repository-relative file path.
   * @param limit - Maximum number of coupled files to return.
   * @returns Coupled files with co-change count and ratio, ordered by count descending.
   */
  getCoupledFilesWithRatio(
    filePath: string,
    limit: number = 10,
  ): CouplingPairRow[] {
    return this.db
      .query<CouplingPairRow, [string, string, string, string, number]>(
        `SELECT
           CASE WHEN fc.file_a = ? THEN fc.file_b ELSE fc.file_a END as file,
           fc.co_change_count,
           ROUND(CAST(fc.co_change_count AS REAL) / fs.total_changes, 2) as coupling_ratio
         FROM file_coupling fc
         JOIN file_stats fs ON fs.file_path = ?
         WHERE fc.file_a = ? OR fc.file_b = ?
         ORDER BY fc.co_change_count DESC
         LIMIT ?`,
      )
      .all(filePath, filePath, filePath, filePath, limit)
  }

  /**
   * Returns change trends per time period for a single file.
   * @param filePath - Repository-relative file path.
   * @param window - Time window SQL expression from WINDOW_FORMATS.
   * @param limit - Maximum number of most recent periods to return.
   * @returns Periods ordered by period label descending (most recent first).
   */
  getTrendsForFile(
    filePath: string,
    window: string,
    limit: number,
  ): TrendPeriod[] {
    return this.db
      .query<TrendPeriod, [string, number]>(
        `SELECT
           ${window} as period,
           COUNT(DISTINCT cf.commit_hash) as total_changes,
           COUNT(DISTINCT CASE WHEN c.classification = 'bug-fix' THEN cf.commit_hash END) as bug_fix_count,
           COUNT(DISTINCT CASE WHEN c.classification = 'feature' THEN cf.commit_hash END) as feature_count,
           COUNT(DISTINCT CASE WHEN c.classification = 'refactor' THEN cf.commit_hash END) as refactor_count,
           COUNT(DISTINCT CASE WHEN c.classification = 'docs' THEN cf.commit_hash END) as docs_count,
           COUNT(DISTINCT CASE WHEN c.classification = 'chore' THEN cf.commit_hash END) as chore_count,
           COUNT(DISTINCT CASE WHEN c.classification = 'perf' THEN cf.commit_hash END) as perf_count,
           COUNT(DISTINCT CASE WHEN c.classification = 'test' THEN cf.commit_hash END) as test_count,
           COUNT(DISTINCT CASE WHEN c.classification = 'style' THEN cf.commit_hash END) as style_count,
           COALESCE(SUM(cf.additions), 0) as additions,
           COALESCE(SUM(cf.deletions), 0) as deletions
         FROM commit_files cf
         JOIN commits c ON c.hash = cf.commit_hash
         WHERE c.enriched_at IS NOT NULL AND cf.file_path = ?
         GROUP BY period
         ORDER BY period DESC
         LIMIT ?`,
      )
      .all(filePath, limit)
  }

  /**
   * Returns change trends per time period for all files under a directory prefix.
   * @param prefix - Directory prefix (e.g. "src/services/").
   * @param window - Time window SQL expression from WINDOW_FORMATS.
   * @param limit - Maximum number of most recent periods to return.
   * @returns Periods ordered by period label descending (most recent first).
   */
  getTrendsForDirectory(
    prefix: string,
    window: string,
    limit: number,
  ): TrendPeriod[] {
    return this.db
      .query<TrendPeriod, [string, number]>(
        `SELECT
           ${window} as period,
           COUNT(DISTINCT cf.commit_hash) as total_changes,
           COUNT(DISTINCT CASE WHEN c.classification = 'bug-fix' THEN cf.commit_hash END) as bug_fix_count,
           COUNT(DISTINCT CASE WHEN c.classification = 'feature' THEN cf.commit_hash END) as feature_count,
           COUNT(DISTINCT CASE WHEN c.classification = 'refactor' THEN cf.commit_hash END) as refactor_count,
           COUNT(DISTINCT CASE WHEN c.classification = 'docs' THEN cf.commit_hash END) as docs_count,
           COUNT(DISTINCT CASE WHEN c.classification = 'chore' THEN cf.commit_hash END) as chore_count,
           COUNT(DISTINCT CASE WHEN c.classification = 'perf' THEN cf.commit_hash END) as perf_count,
           COUNT(DISTINCT CASE WHEN c.classification = 'test' THEN cf.commit_hash END) as test_count,
           COUNT(DISTINCT CASE WHEN c.classification = 'style' THEN cf.commit_hash END) as style_count,
           COALESCE(SUM(cf.additions), 0) as additions,
           COALESCE(SUM(cf.deletions), 0) as deletions
         FROM commit_files cf
         JOIN commits c ON c.hash = cf.commit_hash
         WHERE c.enriched_at IS NOT NULL AND cf.file_path LIKE ? || '%'
         GROUP BY period
         ORDER BY period DESC
         LIMIT ?`,
      )
      .all(prefix, limit)
  }

  /**
   * Returns coupling between files inside a directory and files outside it.
   * @param prefix - Directory prefix (e.g. "src/services/").
   * @param limit - Maximum number of results to return.
   * @returns External files coupled to the directory, with aggregated counts and ratios.
   */
  getCoupledFilesForDirectory(
    prefix: string,
    limit: number = 10,
  ): CouplingPairRow[] {
    return this.db
      .query<
        CouplingPairRow,
        [string, string, string, string, string, string, number]
      >(
        `SELECT
           CASE
             WHEN fc.file_a LIKE ? || '%' THEN fc.file_b
             ELSE fc.file_a
           END as file,
           SUM(fc.co_change_count) as co_change_count,
           ROUND(CAST(SUM(fc.co_change_count) AS REAL) / ds.total_changes, 2) as coupling_ratio
         FROM file_coupling fc
         JOIN (
           SELECT COALESCE(SUM(total_changes), 0) as total_changes
           FROM file_stats WHERE file_path LIKE ? || '%'
         ) ds
         WHERE (fc.file_a LIKE ? || '%' AND fc.file_b NOT LIKE ? || '%')
            OR (fc.file_b LIKE ? || '%' AND fc.file_a NOT LIKE ? || '%')
         GROUP BY file
         ORDER BY co_change_count DESC
         LIMIT ?`,
      )
      .all(prefix, prefix, prefix, prefix, prefix, prefix, limit)
  }
}
