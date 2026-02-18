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

/** Valid time window keys for trend queries. */
export type WindowKey = "weekly" | "monthly" | "quarterly"

/** SQL strftime expressions for grouping commits into time windows. */
export const WINDOW_FORMATS: Record<WindowKey, string> = {
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

  const recentComplexityVals = recent
    .map((p) => p.avg_complexity)
    .filter((v): v is number => v != null)
  const historicalComplexityVals = historical
    .map((p) => p.avg_complexity)
    .filter((v): v is number => v != null)
  const recentComplexityAvg =
    recentComplexityVals.length > 0
      ? recentComplexityVals.reduce((s, v) => s + v, 0) /
        recentComplexityVals.length
      : 0
  const historicalComplexityAvg =
    historicalComplexityVals.length > 0
      ? historicalComplexityVals.reduce((s, v) => s + v, 0) /
        historicalComplexityVals.length
      : 0

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
    complexity_trend: computeDirection(
      recentComplexityAvg,
      historicalComplexityAvg,
    ),
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
  complexity: "current_complexity",
}

/** Repository for computing and querying pre-aggregated file-level statistics. */
export class AggregateRepository {
  private db: Database

  /** @param db - The SQLite database instance. */
  constructor(db: Database) {
    this.db = db
  }

  /**
   * Returns distinct file paths affected by the given commit hashes.
   * Chunks by 500 hashes to stay within SQLite parameter limits.
   */
  private getAffectedFilePaths(commitHashes: string[]): string[] {
    if (commitHashes.length === 0) return []
    const paths = new Set<string>()
    const CHUNK = 500
    for (let i = 0; i < commitHashes.length; i += CHUNK) {
      const chunk = commitHashes.slice(i, i + CHUNK)
      const placeholders = chunk.map(() => "?").join(", ")
      const rows = this.db
        .query<
          { file_path: string },
          string[]
        >(`SELECT DISTINCT file_path FROM commit_files WHERE commit_hash IN (${placeholders})`)
        .all(...chunk)
      for (const row of rows) paths.add(row.file_path)
    }
    return [...paths]
  }

  /** Rebuilds the file_stats table by aggregating all enriched commit data per file. */
  rebuildFileStats(): void {
    this.db.run("DELETE FROM file_stats")
    this.db.run(`
      WITH latest_loc AS (
        SELECT cf2.file_path, cf2.lines_of_code,
          ROW_NUMBER() OVER (PARTITION BY cf2.file_path ORDER BY c2.committed_at DESC) as rn
        FROM commit_files cf2
        JOIN commits c2 ON c2.hash = cf2.commit_hash
        WHERE cf2.lines_of_code > 0
      ),
      latest_complexity AS (
        SELECT cf2.file_path, cf2.indent_complexity,
          ROW_NUMBER() OVER (PARTITION BY cf2.file_path ORDER BY c2.committed_at DESC) as rn
        FROM commit_files cf2
        JOIN commits c2 ON c2.hash = cf2.commit_hash
        WHERE cf2.indent_complexity > 0
      )
      INSERT INTO file_stats (
        file_path, total_changes,
        bug_fix_count, feature_count, refactor_count, docs_count,
        chore_count, perf_count, test_count, style_count,
        first_seen, last_changed,
        total_additions, total_deletions,
        current_loc, current_complexity, avg_complexity, max_complexity
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
        COALESCE(SUM(cf.deletions), 0) as total_deletions,
        ll.lines_of_code as current_loc,
        lc.indent_complexity as current_complexity,
        AVG(CASE WHEN cf.indent_complexity > 0 THEN cf.indent_complexity END) as avg_complexity,
        MAX(CASE WHEN cf.indent_complexity > 0 THEN cf.indent_complexity END) as max_complexity
      FROM commit_files cf
      JOIN commits c ON c.hash = cf.commit_hash
      LEFT JOIN latest_loc ll ON ll.file_path = cf.file_path AND ll.rn = 1
      LEFT JOIN latest_complexity lc ON lc.file_path = cf.file_path AND lc.rn = 1
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

  /**
   * Maximum files per commit for coupling analysis.
   * Commits touching more files than this are excluded — they're typically
   * bulk operations (mass renames, formatting) that produce noise, not signal.
   * Also prevents the O(F^2) self-join from exploding on large commits.
   */
  static readonly MAX_COUPLING_FILES_PER_COMMIT = 200

  /** Creates a temp table of commit hashes that exceed the coupling file cap. */
  private createExcludedCouplingCommits(): void {
    this.db.run("DROP TABLE IF EXISTS _excluded_coupling_commits")
    this.db.run(`
      CREATE TEMP TABLE _excluded_coupling_commits AS
      SELECT commit_hash FROM commit_files
      GROUP BY commit_hash
      HAVING COUNT(*) > ${AggregateRepository.MAX_COUPLING_FILES_PER_COMMIT}
    `)
  }

  /** Drops the temp table of excluded coupling commits. */
  private dropExcludedCouplingCommits(): void {
    this.db.run("DROP TABLE IF EXISTS _excluded_coupling_commits")
  }

  /** Rebuilds the file_coupling table with co-change counts for file pairs (minimum 2 co-changes). */
  rebuildFileCoupling(): void {
    this.db.run("DELETE FROM file_coupling")
    this.createExcludedCouplingCommits()
    try {
      this.db.run(`
        INSERT INTO file_coupling (file_a, file_b, co_change_count)
        SELECT
          a.file_path as file_a,
          b.file_path as file_b,
          COUNT(DISTINCT a.commit_hash) as co_change_count
        FROM commit_files a
        JOIN commit_files b ON a.commit_hash = b.commit_hash AND a.file_path < b.file_path
        LEFT JOIN _excluded_coupling_commits ec ON a.commit_hash = ec.commit_hash
        WHERE ec.commit_hash IS NULL
        GROUP BY a.file_path, b.file_path
        HAVING co_change_count >= 2
      `)
    } finally {
      this.dropExcludedCouplingCommits()
    }
  }

  /**
   * Incrementally rebuilds file_stats for files affected by the given commit hashes.
   * Uses INSERT OR REPLACE to upsert only affected rows.
   */
  rebuildFileStatsIncremental(commitHashes: string[]): void {
    const paths = this.getAffectedFilePaths(commitHashes)
    if (paths.length === 0) return
    const CHUNK = 500
    for (let i = 0; i < paths.length; i += CHUNK) {
      const chunk = paths.slice(i, i + CHUNK)
      const placeholders = chunk.map(() => "?").join(", ")
      this.db
        .query(
          `WITH latest_loc AS (
            SELECT cf2.file_path, cf2.lines_of_code,
              ROW_NUMBER() OVER (PARTITION BY cf2.file_path ORDER BY c2.committed_at DESC) as rn
            FROM commit_files cf2
            JOIN commits c2 ON c2.hash = cf2.commit_hash
            WHERE cf2.lines_of_code > 0 AND cf2.file_path IN (${placeholders})
          ),
          latest_complexity AS (
            SELECT cf2.file_path, cf2.indent_complexity,
              ROW_NUMBER() OVER (PARTITION BY cf2.file_path ORDER BY c2.committed_at DESC) as rn
            FROM commit_files cf2
            JOIN commits c2 ON c2.hash = cf2.commit_hash
            WHERE cf2.indent_complexity > 0 AND cf2.file_path IN (${placeholders})
          )
          INSERT OR REPLACE INTO file_stats (
            file_path, total_changes,
            bug_fix_count, feature_count, refactor_count, docs_count,
            chore_count, perf_count, test_count, style_count,
            first_seen, last_changed,
            total_additions, total_deletions,
            current_loc, current_complexity, avg_complexity, max_complexity
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
            COALESCE(SUM(cf.deletions), 0) as total_deletions,
            ll.lines_of_code as current_loc,
            lc.indent_complexity as current_complexity,
            AVG(CASE WHEN cf.indent_complexity > 0 THEN cf.indent_complexity END) as avg_complexity,
            MAX(CASE WHEN cf.indent_complexity > 0 THEN cf.indent_complexity END) as max_complexity
          FROM commit_files cf
          JOIN commits c ON c.hash = cf.commit_hash
          LEFT JOIN latest_loc ll ON ll.file_path = cf.file_path AND ll.rn = 1
          LEFT JOIN latest_complexity lc ON lc.file_path = cf.file_path AND lc.rn = 1
          WHERE c.enriched_at IS NOT NULL AND cf.file_path IN (${placeholders})
          GROUP BY cf.file_path`,
        )
        .run(...chunk, ...chunk, ...chunk)
    }
  }

  /**
   * Incrementally rebuilds file_contributors for files affected by the given commit hashes.
   * Uses INSERT OR REPLACE to upsert only affected rows.
   */
  rebuildFileContributorsIncremental(commitHashes: string[]): void {
    const paths = this.getAffectedFilePaths(commitHashes)
    if (paths.length === 0) return
    const CHUNK = 500
    for (let i = 0; i < paths.length; i += CHUNK) {
      const chunk = paths.slice(i, i + CHUNK)
      const placeholders = chunk.map(() => "?").join(", ")
      this.db
        .query(
          `INSERT OR REPLACE INTO file_contributors (file_path, author_name, author_email, commit_count)
          SELECT
            cf.file_path,
            c.author_name,
            c.author_email,
            COUNT(DISTINCT cf.commit_hash) as commit_count
          FROM commit_files cf
          JOIN commits c ON c.hash = cf.commit_hash
          WHERE cf.file_path IN (${placeholders})
          GROUP BY cf.file_path, c.author_email`,
        )
        .run(...chunk)
    }
  }

  /**
   * Incrementally rebuilds file_coupling for files affected by the given commit hashes.
   * Falls back to full rebuild if more than 5000 files are affected.
   */
  rebuildFileCouplingIncremental(commitHashes: string[]): void {
    const paths = this.getAffectedFilePaths(commitHashes)
    if (paths.length === 0) return
    if (paths.length > 5000) {
      this.rebuildFileCoupling()
      return
    }
    const CHUNK = 500
    // Delete existing coupling rows involving affected files
    for (let i = 0; i < paths.length; i += CHUNK) {
      const chunk = paths.slice(i, i + CHUNK)
      const placeholders = chunk.map(() => "?").join(", ")
      this.db
        .query(
          `DELETE FROM file_coupling WHERE file_a IN (${placeholders}) OR file_b IN (${placeholders})`,
        )
        .run(...chunk, ...chunk)
    }
    // Re-insert coupling for pairs where at least one file is affected
    this.createExcludedCouplingCommits()
    try {
      for (let i = 0; i < paths.length; i += CHUNK) {
        const chunk = paths.slice(i, i + CHUNK)
        const placeholders = chunk.map(() => "?").join(", ")
        this.db
          .query(
            `INSERT OR REPLACE INTO file_coupling (file_a, file_b, co_change_count)
            SELECT
              a.file_path as file_a,
              b.file_path as file_b,
              COUNT(DISTINCT a.commit_hash) as co_change_count
            FROM commit_files a
            JOIN commit_files b ON a.commit_hash = b.commit_hash AND a.file_path < b.file_path
            LEFT JOIN _excluded_coupling_commits ec ON a.commit_hash = ec.commit_hash
            WHERE (a.file_path IN (${placeholders}) OR b.file_path IN (${placeholders}))
              AND ec.commit_hash IS NULL
            GROUP BY a.file_path, b.file_path
            HAVING co_change_count >= 2`,
          )
          .run(...chunk, ...chunk)
      }
    } finally {
      this.dropExcludedCouplingCommits()
    }
  }

  /**
   * Returns the most frequently changed files.
   * @param options - Limit, sort field, and path prefix filter.
   * @returns Files ordered by the chosen sort column descending.
   */
  getHotspots(
    options: HotspotsOptions = {},
  ): Array<FileStatsRow & { combined_score?: number }> {
    const { limit = 10, sort = "total", pathPrefix } = options

    if (sort === "combined") {
      return this.getHotspotsCombined(limit, pathPrefix)
    }

    const column = SORT_COLUMNS[sort]
    if (!column) {
      throw new Error(
        `Invalid sort field "${sort}". Valid values: ${[...Object.keys(SORT_COLUMNS), "combined"].join(", ")}`,
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
   * Returns hotspots sorted by combined score: normalized changes * normalized complexity.
   * Files without complexity data get score 0.
   */
  private getHotspotsCombined(
    limit: number,
    pathPrefix?: string,
  ): Array<FileStatsRow & { combined_score: number }> {
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (pathPrefix) {
      conditions.push("fs.file_path LIKE ? || '%'")
      // Push pathPrefix twice: once for the CTE WHERE, once for the main WHERE
      params.push(pathPrefix, pathPrefix)
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
    params.push(limit)

    return this.db
      .query<FileStatsRow & { combined_score: number }, (string | number)[]>(
        `WITH maxvals AS (
           SELECT
             MAX(total_changes) as max_changes,
             MAX(current_complexity) as max_complexity
           FROM file_stats ${where.replace("fs.", "")}
         )
         SELECT fs.*,
           CASE
             WHEN m.max_changes > 0 AND m.max_complexity > 0 AND fs.current_complexity IS NOT NULL
             THEN ROUND(
               (CAST(fs.total_changes AS REAL) / m.max_changes) *
               (fs.current_complexity / m.max_complexity),
               4
             )
             ELSE 0.0
           END as combined_score
         FROM file_stats fs, maxvals m
         ${where}
         ORDER BY combined_score DESC
         LIMIT ?`,
      )
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
      .query<FileStatsRow, [string, string]>(
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
           COALESCE(SUM(total_deletions), 0) as total_deletions,
           COALESCE(SUM(current_loc), 0) as current_loc,
           AVG(current_complexity) as current_complexity,
           AVG(avg_complexity) as avg_complexity,
           MAX(max_complexity) as max_complexity
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
   * @param window - Time window key: "weekly", "monthly", or "quarterly".
   * @param limit - Maximum number of most recent periods to return.
   * @returns Periods ordered by period label descending (most recent first).
   */
  getTrendsForFile(
    filePath: string,
    window: WindowKey,
    limit: number,
  ): TrendPeriod[] {
    const windowSql = WINDOW_FORMATS[window]
    if (!windowSql) {
      throw new Error(
        `Invalid window "${window}". Valid values: ${Object.keys(WINDOW_FORMATS).join(", ")}`,
      )
    }
    return this.db
      .query<TrendPeriod, [string, number]>(
        `SELECT
           ${windowSql} as period,
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
           COALESCE(SUM(cf.deletions), 0) as deletions,
           AVG(CASE WHEN cf.indent_complexity > 0 THEN cf.indent_complexity END) as avg_complexity,
           MAX(CASE WHEN cf.indent_complexity > 0 THEN cf.indent_complexity END) as max_complexity,
           AVG(CASE WHEN cf.lines_of_code > 0 THEN cf.lines_of_code END) as avg_loc
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
   * @param window - Time window key: "weekly", "monthly", or "quarterly".
   * @param limit - Maximum number of most recent periods to return.
   * @returns Periods ordered by period label descending (most recent first).
   */
  getTrendsForDirectory(
    prefix: string,
    window: WindowKey,
    limit: number,
  ): TrendPeriod[] {
    const windowSql = WINDOW_FORMATS[window]
    if (!windowSql) {
      throw new Error(
        `Invalid window "${window}". Valid values: ${Object.keys(WINDOW_FORMATS).join(", ")}`,
      )
    }
    return this.db
      .query<TrendPeriod, [string, number]>(
        `SELECT
           ${windowSql} as period,
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
           COALESCE(SUM(cf.deletions), 0) as deletions,
           AVG(CASE WHEN cf.indent_complexity > 0 THEN cf.indent_complexity END) as avg_complexity,
           MAX(CASE WHEN cf.indent_complexity > 0 THEN cf.indent_complexity END) as max_complexity,
           AVG(CASE WHEN cf.lines_of_code > 0 THEN cf.lines_of_code END) as avg_loc
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
