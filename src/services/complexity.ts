/** Result of computing indentation-based complexity for a file. */
export interface ComplexityResult {
  /** Number of non-blank lines. */
  linesOfCode: number
  /** Sum of indentation levels across all non-blank lines. */
  indentComplexity: number
  /** Maximum indentation level seen. */
  maxIndent: number
}

/**
 * Computes indentation-based complexity metrics for source code.
 * @param content - The file content as a string.
 * @param tabWidth - Number of spaces per tab (default 4).
 * @returns Complexity metrics.
 */
export function computeComplexity(
  content: string,
  tabWidth: number = 4,
): ComplexityResult {
  const lines = content.split("\n")
  let linesOfCode = 0
  let indentComplexity = 0
  let maxIndent = 0

  for (const line of lines) {
    if (line.trim().length === 0) continue
    linesOfCode++

    let leadingSpaces = 0
    for (const ch of line) {
      if (ch === " ") {
        leadingSpaces++
      } else if (ch === "\t") {
        leadingSpaces += tabWidth
      } else {
        break
      }
    }

    const indentLevel = Math.floor(leadingSpaces / tabWidth)
    indentComplexity += indentLevel
    if (indentLevel > maxIndent) maxIndent = indentLevel
  }

  return { linesOfCode, indentComplexity, maxIndent }
}

/**
 * Detects binary files by checking for NUL bytes in the first 8KB.
 * Uses the same heuristic as git.
 * @param content - The raw file content as a Buffer.
 * @returns true if the file appears to be binary.
 */
export function isBinary(content: Buffer): boolean {
  const limit = Math.min(content.length, 8192)
  for (let i = 0; i < limit; i++) {
    if (content[i] === 0) return true
  }
  return false
}

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

/**
 * Detects generated or vendored files that should be skipped for complexity measurement.
 * @param filePath - Repository-relative file path.
 * @returns true if the file should be skipped.
 */
export function isGenerated(filePath: string): boolean {
  const basename = filePath.split("/").pop() ?? ""
  if (GENERATED_FILENAMES.has(basename)) return true
  for (const ext of GENERATED_EXTENSIONS) {
    if (filePath.endsWith(ext)) return true
  }
  return false
}
