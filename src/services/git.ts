import type { CommitInfo, CommitFile, IGitService } from "@/types"

/** Interacts with a local git repository via Bun shell commands. */
export class GitService implements IGitService {
  private cwd: string

  /** @param cwd - Absolute path to the git working directory. */
  constructor(cwd: string) {
    this.cwd = cwd
  }

  /** Checks whether the working directory is inside a git repository. */
  async isGitRepo(): Promise<boolean> {
    try {
      const result =
        await Bun.$`git -C ${this.cwd} rev-parse --is-inside-work-tree 2>/dev/null`.quiet()
      return result.exitCode === 0
    } catch {
      return false
    }
  }

  /**
   * Determines the default branch name by checking the remote HEAD,
   * falling back to "main"/"master", then the current HEAD.
   */
  async getDefaultBranch(): Promise<string> {
    // Try symbolic-ref first (works for repos with a remote)
    try {
      const result =
        await Bun.$`git -C ${this.cwd} symbolic-ref refs/remotes/origin/HEAD`.quiet()
      if (result.exitCode === 0) {
        const ref = result.text().trim()
        return ref.replace("refs/remotes/origin/", "")
      }
    } catch {
      // fall through
    }

    // Check for common branch names
    for (const branch of ["main", "master"]) {
      try {
        const result =
          await Bun.$`git -C ${this.cwd} rev-parse --verify ${branch}`.quiet()
        if (result.exitCode === 0) return branch
      } catch {
        // try next
      }
    }

    // Last resort: whatever HEAD points to
    const result =
      await Bun.$`git -C ${this.cwd} rev-parse --abbrev-ref HEAD`.quiet()
    return result.text().trim()
  }

  /**
   * Returns all commit hashes on the given branch in reverse chronological order.
   * @param branch - Branch name to list commits from.
   */
  async getCommitHashes(branch: string): Promise<string[]> {
    const result =
      await Bun.$`git -C ${this.cwd} log ${branch} --format=%H`.quiet()
    return result
      .text()
      .trim()
      .split("\n")
      .filter((h) => h.length > 0)
  }

  /**
   * Retrieves full commit metadata and file list for a single commit.
   * @param hash - The full SHA-1 commit hash.
   */
  async getCommitInfo(hash: string): Promise<CommitInfo> {
    const logResult =
      await Bun.$`git -C ${this.cwd} log -1 --format=%H%n%an%n%ae%n%aI%n%B ${hash}`.quiet()
    const lines = logResult.text().trim().split("\n")

    const commitHash = lines[0]
    const authorName = lines[1]
    const authorEmail = lines[2]
    const committedAt = lines[3]
    const message = lines.slice(4).join("\n").trim()

    const files = await this.getCommitFiles(hash)

    return {
      hash: commitHash,
      authorName,
      authorEmail,
      committedAt,
      message,
      files,
    }
  }

  /**
   * Parses the numstat output to extract file-level addition/deletion counts.
   * @param hash - The full SHA-1 commit hash.
   */
  private async getCommitFiles(hash: string): Promise<CommitFile[]> {
    const result =
      await Bun.$`git -C ${this.cwd} diff-tree --root --no-commit-id -r --numstat --diff-filter=ACDMRT ${hash}`.quiet()
    const text = result.text().trim()
    if (!text) return []

    return text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const parts = line.split("\t")
        const additions = parts[0] === "-" ? 0 : parseInt(parts[0], 10)
        const deletions = parts[1] === "-" ? 0 : parseInt(parts[1], 10)
        const filePath = parts[2]

        return {
          filePath,
          changeType: "M",
          additions,
          deletions,
        }
      })
  }

  /**
   * Returns the unified diff for a commit, truncated if it exceeds maxChars.
   * @param hash - The full SHA-1 commit hash.
   * @param maxChars - Maximum character length before truncation.
   */
  async getDiff(hash: string, maxChars: number = 12000): Promise<string> {
    const result =
      await Bun.$`git -C ${this.cwd} diff-tree --root -p --no-commit-id ${hash}`.quiet()
    const diff = result.text()
    if (diff.length > maxChars) {
      return diff.slice(0, maxChars) + "\n... [truncated]"
    }
    return diff
  }

  /**
   * Returns the total number of commits on the given branch.
   * @param branch - Branch name to count commits on.
   */
  async getTotalCommitCount(branch: string): Promise<number> {
    const result =
      await Bun.$`git -C ${this.cwd} rev-list --count ${branch}`.quiet()
    return parseInt(result.text().trim(), 10)
  }
}
