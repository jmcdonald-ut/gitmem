export type FileCategory = "test" | "docs" | "generated"

export const DEFAULT_EXCLUDED: FileCategory[] = ["test", "docs", "generated"]

const TEST_DIR_PATTERNS = ["__tests__/", "test/", "tests/", "spec/"]

const DOCS_DIR_PATTERNS = ["docs/"]

const GENERATED_FILENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "Gemfile.lock",
  "Cargo.lock",
  "composer.lock",
  "poetry.lock",
  "go.sum",
])

const GENERATED_EXTENSIONS = [".min.js", ".min.css", ".map", ".lock"]

function isTest(filePath: string): boolean {
  const basename = filePath.split("/").pop() ?? ""
  // Suffix patterns: .test.*, .spec.*, _test.*, _spec.*
  if (
    basename.includes(".test.") ||
    basename.includes(".spec.") ||
    /_test\.[^.]+$/.test(basename) ||
    /_spec\.[^.]+$/.test(basename)
  )
    return true
  // Directory patterns
  for (const dir of TEST_DIR_PATTERNS) {
    if (filePath.includes("/" + dir) || filePath.startsWith(dir)) return true
  }
  return false
}

function isDocs(filePath: string): boolean {
  if (filePath.endsWith(".md") || filePath.endsWith(".mdx")) return true
  for (const dir of DOCS_DIR_PATTERNS) {
    if (filePath.includes("/" + dir) || filePath.startsWith(dir)) return true
  }
  return false
}

export function isGenerated(filePath: string): boolean {
  const basename = filePath.split("/").pop() ?? ""
  if (GENERATED_FILENAMES.has(basename)) return true
  for (const ext of GENERATED_EXTENSIONS) {
    if (filePath.endsWith(ext)) return true
  }
  return false
}

const CATEGORY_CHECKS: Record<FileCategory, (path: string) => boolean> = {
  test: isTest,
  docs: isDocs,
  generated: isGenerated,
}

export function isExcluded(
  filePath: string,
  categories: FileCategory[] = DEFAULT_EXCLUDED,
): boolean {
  for (const cat of categories) {
    if (CATEGORY_CHECKS[cat](filePath)) return true
  }
  return false
}

export function getExclusionPatterns(categories: FileCategory[]): string[] {
  const patterns: string[] = []

  if (categories.includes("test")) {
    patterns.push(
      "%.test.%",
      "%.spec.%",
      "%\\_test.%",
      "%\\_spec.%",
      "%/__tests__/%",
      "%/test/%",
      "%/tests/%",
      "%/spec/%",
    )
  }

  if (categories.includes("docs")) {
    patterns.push("%.md", "%.mdx", "%/docs/%")
  }

  if (categories.includes("generated")) {
    patterns.push("%.min.js", "%.min.css", "%.map", "%.lock")
    for (const name of GENERATED_FILENAMES) {
      patterns.push("%" + name)
    }
  }

  return patterns
}

export interface FilterFlags {
  includeTests?: boolean
  includeDocs?: boolean
  includeGenerated?: boolean
  all?: boolean
}

export function resolveExcludedCategories(opts: FilterFlags): FileCategory[] {
  if (opts.all) return []
  const excluded = [...DEFAULT_EXCLUDED]
  if (opts.includeTests) excluded.splice(excluded.indexOf("test"), 1)
  if (opts.includeDocs) excluded.splice(excluded.indexOf("docs"), 1)
  if (opts.includeGenerated) excluded.splice(excluded.indexOf("generated"), 1)
  return excluded
}
