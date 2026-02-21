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
