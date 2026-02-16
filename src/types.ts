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

/** A recent enriched commit associated with a file or directory. */
export interface RecentCommit {
  hash: string
  classification: string
  summary: string
  committed_at: string
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
  phase: "discovering" | "enriching" | "aggregating" | "indexing" | "done"
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
  getCommitHashes(branch: string): Promise<string[]>
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
  /** Checks whether the working directory is inside a git repository. */
  isGitRepo(): Promise<boolean>
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
  phase: "evaluating" | "done"
  /** Number of commits evaluated so far. */
  current: number
  /** Total commits to evaluate. */
  total: number
  /** Hash of the commit currently being evaluated. */
  currentHash?: string
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
}
