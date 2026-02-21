/** Database row representation of a commit record. */
export interface CommitRow {
  /** Full SHA-1 commit hash (primary key). */
  hash: string
  /** Author display name. */
  author_name: string
  /** Author email address. */
  author_email: string
  /** ISO 8601 commit timestamp. */
  committed_at: string
  /** Full commit message. */
  message: string
  /** LLM-assigned classification, or null if not yet enriched. */
  classification: string | null
  /** LLM-generated summary, or null if not yet enriched. */
  summary: string | null
  /** ISO 8601 timestamp of when enrichment was performed. */
  enriched_at: string | null
  /** Model identifier used for enrichment. */
  model_used: string | null
}

/** Database row representation of a file within a commit. */
export interface CommitFileRow {
  /** SHA-1 hash of the parent commit. */
  commit_hash: string
  /** Repository-relative file path. */
  file_path: string
  /** Git change type (e.g. "M", "A", "D"). */
  change_type: string
  /** Number of lines added. */
  additions: number
  /** Number of lines deleted. */
  deletions: number
  /** Non-blank lines of code, or null if not yet measured. */
  lines_of_code: number | null
  /** Sum of indentation levels across all lines, or null if not yet measured. */
  indent_complexity: number | null
  /** Maximum indentation level seen, or null if not yet measured. */
  max_indent: number | null
}

/** Aggregated change statistics for a single file across all enriched commits. */
export interface FileStatsRow {
  /** Repository-relative file path (primary key). */
  file_path: string
  /** Total number of distinct commits that touched this file. */
  total_changes: number
  /** Number of bug-fix commits touching this file. */
  bug_fix_count: number
  /** Number of feature commits touching this file. */
  feature_count: number
  /** Number of refactor commits touching this file. */
  refactor_count: number
  /** Number of docs commits touching this file. */
  docs_count: number
  /** Number of chore commits touching this file. */
  chore_count: number
  /** Number of perf commits touching this file. */
  perf_count: number
  /** Number of test commits touching this file. */
  test_count: number
  /** Number of style commits touching this file. */
  style_count: number
  /** ISO 8601 date of the earliest commit touching this file. */
  first_seen: string
  /** ISO 8601 date of the most recent commit touching this file. */
  last_changed: string
  /** Total lines added across all commits. */
  total_additions: number
  /** Total lines deleted across all commits. */
  total_deletions: number
  /** Lines of code from the most recent commit, or null if unmeasured. */
  current_loc: number | null
  /** Indentation complexity from the most recent commit, or null if unmeasured. */
  current_complexity: number | null
  /** Average indentation complexity across all measured commits. */
  avg_complexity: number | null
  /** Maximum indentation complexity across all measured commits. */
  max_complexity: number | null
}

/** Per-file contributor statistics. */
export interface FileContributorRow {
  /** Repository-relative file path. */
  file_path: string
  /** Contributor display name. */
  author_name: string
  /** Contributor email address. */
  author_email: string
  /** Number of commits by this contributor to this file. */
  commit_count: number
}

/** Measures how frequently two files are changed together. */
export interface FileCouplingRow {
  /** First file path (lexicographically smaller). */
  file_a: string
  /** Second file path (lexicographically larger). */
  file_b: string
  /** Number of commits where both files were changed together. */
  co_change_count: number
}

/** A coupled file with co-change count and coupling ratio, for file/directory views. */
export interface CouplingPairRow {
  file: string
  co_change_count: number
  coupling_ratio: number
}

/** A co-change pair for the global view, showing both files. */
export interface CouplingPairGlobalRow {
  file_a: string
  file_b: string
  co_change_count: number
}

/** A recent commit associated with a file or directory. */
export interface RecentCommit {
  hash: string
  classification: string
  summary: string
  committed_at: string
}

/** Change velocity and classification mix for a single time period. */
export interface TrendPeriod {
  /** Period label, e.g. "2025-01", "2025-W03", "2025-Q1". */
  period: string
  /** Total number of distinct commits in this period. */
  total_changes: number
  /** Number of bug-fix commits. */
  bug_fix_count: number
  /** Number of feature commits. */
  feature_count: number
  /** Number of refactor commits. */
  refactor_count: number
  /** Number of docs commits. */
  docs_count: number
  /** Number of chore commits. */
  chore_count: number
  /** Number of perf commits. */
  perf_count: number
  /** Number of test commits. */
  test_count: number
  /** Number of style commits. */
  style_count: number
  /** Total lines added. */
  additions: number
  /** Total lines deleted. */
  deletions: number
  /** Average indentation complexity for files in this period. */
  avg_complexity: number | null
  /** Maximum indentation complexity for files in this period. */
  max_complexity: number | null
  /** Average lines of code for files in this period. */
  avg_loc: number | null
}

/** Summary of the overall trend direction computed from TrendPeriod data. */
export interface TrendSummary {
  /** Overall change velocity direction. */
  direction: "increasing" | "decreasing" | "stable"
  /** Average changes per period in the recent window. */
  recent_avg: number
  /** Average changes per period in the historical window. */
  historical_avg: number
  /** Direction of bug-fix frequency over time. */
  bug_fix_trend: "increasing" | "decreasing" | "stable"
  /** Direction of complexity over time. */
  complexity_trend: "increasing" | "decreasing" | "stable"
}

/** A full-text search result from the commits FTS index. */
export interface SearchResult {
  /** Full SHA-1 commit hash. */
  hash: string
  /** Commit message. */
  message: string
  /** LLM-assigned classification. */
  classification: string
  /** LLM-generated summary. */
  summary: string
  /** FTS5 relevance rank (lower is more relevant). */
  rank: number
}

/** Valid batch job processing statuses. */
export type BatchJobStatus = "submitted" | "in_progress" | "ended" | "failed"

/** Valid batch job types. */
export type BatchJobType = "index" | "check"
