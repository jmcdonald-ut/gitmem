import type { GitmemConfig } from "@/config"

/** Output format for CLI commands. */
export type OutputFormat = "text" | "json"

/** All valid commit classification types used by the LLM enrichment pipeline. */
export const CLASSIFICATIONS = [
  "bug-fix",
  "feature",
  "refactor",
  "docs",
  "chore",
  "perf",
  "test",
  "style",
] as const

/** A commit classification label assigned during LLM enrichment. */
export type Classification = (typeof CLASSIFICATIONS)[number]

/** The key holding a count of commits with a specific classification. */
export type ClassificationCountKey =
  | "bug_fix_count"
  | "feature_count"
  | "refactor_count"
  | "docs_count"
  | "chore_count"
  | "perf_count"
  | "test_count"
  | "style_count"

/** Colors associated with each commit classification. */
export const CLASSIFICATION_COLORS: { [key in Classification]: string } = {
  "bug-fix": "red",
  feature: "green",
  refactor: "yellow",
  docs: "blue",
  chore: "gray",
  perf: "magenta",
  test: "cyan",
  style: "white",
}

/**
 * Mapping of classification keys to their display labels.
 */
export const CLASSIFICATION_KEYS: {
  key: ClassificationCountKey
  label: Classification
}[] = [
  { key: "bug_fix_count", label: "bug-fix" },
  { key: "feature_count", label: "feature" },
  { key: "refactor_count", label: "refactor" },
  { key: "docs_count", label: "docs" },
  { key: "chore_count", label: "chore" },
  { key: "perf_count", label: "perf" },
  { key: "test_count", label: "test" },
  { key: "style_count", label: "style" },
]

/** Parsed git commit metadata and associated file changes. */
export interface CommitInfo {
  /** Full SHA-1 commit hash. */
  hash: string
  /** Author display name. */
  authorName: string
  /** Author email address. */
  authorEmail: string
  /** ISO 8601 author date. */
  committedAt: string
  /** Full commit message body. */
  message: string
  /** Files modified in this commit. */
  files: CommitFile[]
}

/** A single file changed within a commit. */
export interface CommitFile {
  /** Repository-relative file path. */
  filePath: string
  /** Git change type (e.g. "M" for modified, "A" for added). */
  changeType: string
  /** Number of lines added. */
  additions: number
  /** Number of lines deleted. */
  deletions: number
}

/** LLM-generated classification and summary for a commit. */
export interface EnrichmentResult {
  /** The assigned commit classification. */
  classification: Classification
  /** A 1-2 sentence human-readable summary of the commit. */
  summary: string
}

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

/** Tracks progress through the multi-phase indexing pipeline. */
export interface IndexProgress {
  /** Current pipeline phase. */
  phase:
    | "discovering"
    | "measuring"
    | "enriching"
    | "aggregating"
    | "indexing"
    | "done"
  /** Number of items processed in the current phase. */
  current: number
  /** Total items to process in the current phase. */
  total: number
  /** Hash of the commit currently being processed. */
  currentHash?: string
  /** Batch job ID when using batch mode. */
  batchId?: string
  /** Batch processing status when using batch mode. */
  batchStatus?: string
}

/** Interface for interacting with a git repository. */
export interface IGitService {
  /** Determines the default branch name (e.g. "main" or "master"). */
  getDefaultBranch(): Promise<string>
  /** Returns all commit hashes on the given branch in reverse chronological order. */
  getCommitHashes(branch: string, after?: string): Promise<string[]>
  /** Retrieves full commit metadata and file list for a single commit. */
  getCommitInfo(hash: string): Promise<CommitInfo>
  /** Returns the unified diff for a commit, truncated to maxChars. */
  getDiff(hash: string, maxChars?: number): Promise<string>
  /** Returns the total number of commits on the given branch. */
  getTotalCommitCount(branch: string): Promise<number>
  /** Retrieves commit metadata and file lists for multiple commits in bulk. */
  getCommitInfoBatch(hashes: string[]): Promise<CommitInfo[]>
  /** Returns unified diffs for multiple commits in bulk, each truncated to maxChars. */
  getDiffBatch(
    hashes: string[],
    maxChars?: number,
  ): Promise<Map<string, string>>
  /** Returns all tracked file paths in the working tree. */
  getTrackedFiles(): Promise<string[]>
  /** Checks whether the working directory is inside a git repository. */
  isGitRepo(): Promise<boolean>
  /** Returns the absolute path to the repository root. */
  getRepoRoot(): Promise<string>
  /** Returns file contents at specific commits using git cat-file --batch. */
  getFileContentsBatch(
    entries: Array<{ hash: string; filePath: string }>,
  ): Promise<Map<string, Buffer>>
}

/** Interface for LLM-based commit enrichment. */
export interface ILLMService {
  /** Classifies and summarizes a commit using its metadata and diff. */
  enrichCommit(commit: CommitInfo, diff: string): Promise<EnrichmentResult>
}

/** A pass/fail verdict with reasoning for a single evaluation dimension. */
export interface EvalVerdict {
  /** Whether this dimension passed. */
  pass: boolean
  /** The judge's reasoning for the verdict. */
  reasoning: string
  /** Suggested correct classification (only for classification dimension on fail). */
  suggestedClassification?: Classification
}

/** Full evaluation result for a single commit. */
export interface EvalResult {
  /** The commit hash that was evaluated. */
  hash: string
  /** The original classification assigned during enrichment. */
  classification: string
  /** The original summary assigned during enrichment. */
  summary: string
  /** Verdict on classification correctness. */
  classificationVerdict: EvalVerdict
  /** Verdict on summary accuracy. */
  accuracyVerdict: EvalVerdict
  /** Verdict on summary completeness. */
  completenessVerdict: EvalVerdict
}

/** Aggregate summary of evaluation results across multiple commits. */
export interface EvalSummary {
  /** Total number of commits evaluated. */
  total: number
  /** Number of commits with correct classification. */
  classificationCorrect: number
  /** Number of commits with accurate summaries. */
  summaryAccurate: number
  /** Number of commits with complete summaries. */
  summaryComplete: number
}

/** Tracks progress through the check workflow. */
export interface CheckProgress {
  /** Current check phase. */
  phase: "evaluating" | "submitting" | "importing" | "done"
  /** Number of commits evaluated so far. */
  current: number
  /** Total commits to evaluate. */
  total: number
  /** Hash of the commit currently being evaluated. */
  currentHash?: string
  /** Batch job ID when using batch mode. */
  batchId?: string
  /** Batch processing status when using batch mode. */
  batchStatus?: string
}

/** Valid batch job processing statuses. */
export type BatchJobStatus = "submitted" | "in_progress" | "ended" | "failed"

/** Valid batch job types. */
export type BatchJobType = "index" | "check"

/** Status result from polling a batch job via the Anthropic API. */
export interface BatchStatusResult {
  processingStatus: string
  requestCounts: {
    succeeded: number
    errored: number
    canceled: number
    expired: number
    processing: number
  }
}

/** Result from a batch check operation. */
export type CheckBatchResult =
  | {
      kind: "complete"
      results: EvalResult[]
      summary: EvalSummary
      outputPath: string
    }
  | {
      kind: "empty"
      results: EvalResult[]
      summary: EvalSummary
    }
  | {
      kind: "submitted"
      batchId: string
    }
  | {
      kind: "in_progress"
      batchId: string
      batchStatus: string
    }

/** Interface for LLM-based commit evaluation (judge). */
export interface IJudgeService {
  /** Evaluates a commit's enrichment quality using a stronger model. */
  evaluateCommit(
    commit: CommitInfo,
    diff: string,
    classification: string,
    summary: string,
  ): Promise<{
    classificationVerdict: EvalVerdict
    accuracyVerdict: EvalVerdict
    completenessVerdict: EvalVerdict
  }>
}

/** Interface for batch LLM-based commit evaluation (judge). */
export interface IBatchJudgeService {
  /** The model used for batch evaluation. */
  readonly model: string
  /** Submits a batch of evaluation requests. */
  submitBatch(
    requests: Array<{
      hash: string
      commit: CommitInfo
      diff: string
      classification: string
      summary: string
    }>,
  ): Promise<{ batchId: string; requestCount: number }>
  /** Retrieves the current status of a batch. */
  getBatchStatus(batchId: string): Promise<BatchStatusResult>
  /** Retrieves and parses results from a completed batch. */
  getBatchResults(batchId: string): Promise<
    Array<{
      hash: string
      result?: {
        classificationVerdict: EvalVerdict
        accuracyVerdict: EvalVerdict
        completenessVerdict: EvalVerdict
      }
      error?: string
    }>
  >
}

/** A column within a database table, used for schema documentation. */
export interface SchemaColumn {
  /** Column name. */
  name: string
  /** SQLite column type (e.g. "TEXT", "INTEGER"). */
  type: string
  /** Whether this column is part of the primary key. */
  primary_key: boolean
  /** Whether this column is NOT NULL. */
  not_null: boolean
  /** Brief description of the column's purpose. */
  description: string
}

/** A database table or virtual table, used for schema documentation. */
export interface SchemaTable {
  /** Table name. */
  name: string
  /** Brief description of the table's purpose. */
  description: string
  /** Whether this is an FTS5 virtual table. */
  virtual: boolean
  /** Columns in this table. */
  columns: SchemaColumn[]
}

/** Summary of the current gitmem index state, displayed by the status command. */
export interface StatusInfo {
  /** Total commits on the default branch in the git repo. */
  totalCommits: number
  /** Number of commits stored in the database. */
  indexedCommits: number
  /** Number of commits that have been LLM-enriched. */
  enrichedCommits: number
  /** ISO 8601 timestamp of the last index run, or null if never run. */
  lastRun: string | null
  /** Model identifier used in the last index run. */
  modelUsed: string | null
  /** Absolute path to the SQLite database file. */
  dbPath: string
  /** Database file size in bytes. */
  dbSize: number
  /** Effective configuration, if loaded. */
  config?: GitmemConfig
}
