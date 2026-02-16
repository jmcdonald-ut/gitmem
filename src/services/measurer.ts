import type { IGitService, IndexProgress } from "@/types"
import type { CommitRepository } from "@db/commits"
import { computeComplexity, isBinary, isGenerated } from "@services/complexity"

/** Orchestrates complexity measurement for commit files. */
export class MeasurerService {
  private git: IGitService
  private commits: CommitRepository

  /**
   * @param git - Git repository service for fetching file contents.
   * @param commits - Commit repository for reading/writing complexity data.
   */
  constructor(git: IGitService, commits: CommitRepository) {
    this.git = git
    this.commits = commits
  }

  /**
   * Measures indentation complexity for all unmeasured commit files.
   * @param onProgress - Callback for progress updates.
   * @returns Number of files measured.
   */
  async measure(
    onProgress: (progress: IndexProgress) => void,
  ): Promise<number> {
    const unmeasured = this.commits.getUnmeasuredFiles()
    if (unmeasured.length === 0) return 0

    const total = unmeasured.length
    let processed = 0
    const BATCH_SIZE = 500

    for (let i = 0; i < unmeasured.length; i += BATCH_SIZE) {
      const batch = unmeasured.slice(i, i + BATCH_SIZE)

      // Separate files that need fetching from those that can be skipped
      const toFetch: Array<{ hash: string; filePath: string }> = []
      const updates: Array<{
        commitHash: string
        filePath: string
        linesOfCode: number
        indentComplexity: number
        maxIndent: number
      }> = []

      for (const row of batch) {
        if (row.change_type === "D" || isGenerated(row.file_path)) {
          updates.push({
            commitHash: row.commit_hash,
            filePath: row.file_path,
            linesOfCode: 0,
            indentComplexity: 0,
            maxIndent: 0,
          })
          processed++
        } else {
          toFetch.push({ hash: row.commit_hash, filePath: row.file_path })
        }
      }

      onProgress({ phase: "measuring", current: processed, total })

      if (toFetch.length > 0) {
        const contents = await this.git.getFileContentsBatch(toFetch)

        for (const entry of toFetch) {
          const key = `${entry.hash}:${entry.filePath}`
          const content = contents.get(key)

          if (!content || isBinary(content)) {
            updates.push({
              commitHash: entry.hash,
              filePath: entry.filePath,
              linesOfCode: 0,
              indentComplexity: 0,
              maxIndent: 0,
            })
          } else {
            const result = computeComplexity(content.toString("utf-8"))
            updates.push({
              commitHash: entry.hash,
              filePath: entry.filePath,
              linesOfCode: result.linesOfCode,
              indentComplexity: result.indentComplexity,
              maxIndent: result.maxIndent,
            })
          }
          processed++
        }
      }

      this.commits.updateComplexityBatch(updates)
      onProgress({ phase: "measuring", current: processed, total })
    }

    return processed
  }
}
