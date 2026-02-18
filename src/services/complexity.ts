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

export { isGenerated } from "@services/file-filter"
