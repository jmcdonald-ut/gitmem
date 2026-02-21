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
