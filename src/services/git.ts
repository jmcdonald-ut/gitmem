import type { CommitInfo, CommitFile, IGitService } from "@/types"

/**
 * Truncates a unified diff to fit within maxChars while preserving breadth
 * across all files. Instead of naively slicing (which shows full diffs for the
 * first few files and nothing for the rest), this splits the diff into per-file
 * sections, lets small files keep their full content, and distributes the
 * remaining budget evenly among oversized files.
 */
export function truncateDiff(diff: string, maxChars: number): string {
  if (diff.length <= maxChars) return diff

  const sections = diff.split(/(?=^diff --git )/m).filter((s) => s.length > 0)
  if (sections.length <= 1) {
    return safeSlice(diff, maxChars) + "\n... [truncated]"
  }

  const MARKER = "\n... [truncated]"
  const equalShare = Math.floor(maxChars / sections.length)

  // First pass: small files keep their full content, track remaining budget
  let remainingBudget = maxChars
  let oversizedCount = 0
  const fits: boolean[] = sections.map((section) => {
    if (section.length <= equalShare) {
      remainingBudget -= section.length
      return true
    }
    oversizedCount++
    return false
  })

  // Second pass: distribute remaining budget to oversized files
  const perOversized =
    oversizedCount > 0 ? Math.floor(remainingBudget / oversizedCount) : 0

  return sections
    .map((section, i) => {
      if (fits[i]) return section
      const truncLen = Math.max(0, perOversized - MARKER.length)
      return safeSlice(section, truncLen) + MARKER
    })
    .join("")
}

/**
 * Slices a string without splitting a UTF-16 surrogate pair.
 * If the cut point falls between a high and low surrogate,
 * backs up one position to exclude the orphaned high surrogate.
 */
function safeSlice(str: string, end: number): string {
  if (end <= 0) return ""
  if (end >= str.length) return str
  const code = str.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) {
    return str.slice(0, end - 1)
  }
  return str.slice(0, end)
}

/**
 * Parses `git diff-tree --name-status` output into a map of filePath → changeType.
 * Each line has the format: `<status>\t<filePath>`
 */
function parseNameStatus(text: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of text.split("\n")) {
    if (!line || !line.includes("\t")) continue
    const tab = line.indexOf("\t")
    map.set(line.slice(tab + 1), line.slice(0, tab))
  }
  return map
}

/**
 * Parses `git diff-tree --stdin --name-status` output into a nested map
 * of commitHash → filePath → changeType. Commit hashes appear on their own
 * line as 40-char hex strings.
 */
function parseNameStatusByCommit(
  text: string,
): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>()
  let currentHash: string | null = null
  for (const line of text.split("\n")) {
    if (line.length === 0) continue
    if (/^[0-9a-f]{40}$/.test(line)) {
      currentHash = line
      if (!result.has(line)) result.set(line, new Map())
      continue
    }
    if (currentHash && line.includes("\t")) {
      const tab = line.indexOf("\t")
      result.get(currentHash)!.set(line.slice(tab + 1), line.slice(0, tab))
    }
  }
  return result
}

/** Interacts with a local git repository via Bun shell commands. */
export class GitService implements IGitService {
  private cwd: string

  /** @param cwd - Absolute path to the git working directory. */
  constructor(cwd: string) {
    this.cwd = cwd
  }

  /** Returns all tracked file paths in the working tree. */
  async getTrackedFiles(): Promise<string[]> {
    const result = await Bun.$`git -C ${this.cwd} ls-files`.quiet()
    return result
      .text()
      .trim()
      .split("\n")
      .filter((f) => f.length > 0)
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
    const [numstatResult, statusResult] = await Promise.all([
      Bun.$`git -C ${this.cwd} diff-tree --root --no-commit-id -r --numstat --diff-filter=ACDMRT ${hash}`.quiet(),
      Bun.$`git -C ${this.cwd} diff-tree --root --no-commit-id -r --name-status --diff-filter=ACDMRT ${hash}`.quiet(),
    ])
    const text = numstatResult.text().trim()
    if (!text) return []

    const changeTypes = parseNameStatus(statusResult.text())

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
          changeType: changeTypes.get(filePath) ?? "M",
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
    return truncateDiff(result.text(), maxChars)
  }

  /**
   * Retrieves commit metadata and file lists for multiple commits in a small
   * number of git process spawns instead of 2×N individual calls.
   * Hashes are chunked at 500 to stay under ARG_MAX.
   * @param hashes - Full SHA-1 commit hashes.
   * @returns CommitInfo[] preserving input order.
   */
  async getCommitInfoBatch(hashes: string[]): Promise<CommitInfo[]> {
    if (hashes.length === 0) return []

    const CHUNK = 500
    const DELIM = "---GITMEM_RECORD---"
    const commitMap = new Map<string, CommitInfo>()

    // Fetch metadata in chunks using --no-walk
    for (let i = 0; i < hashes.length; i += CHUNK) {
      const chunk = hashes.slice(i, i + CHUNK)
      const format = `${DELIM}%n%H%n%an%n%ae%n%aI%n%B`
      const result =
        await Bun.$`git -C ${this.cwd} log --no-walk --format=${format} ${chunk}`.quiet()
      const text = result.text()
      const records = text.split(DELIM).filter((r) => r.trim().length > 0)

      for (const record of records) {
        const lines = record.trim().split("\n")
        const hash = lines[0]
        const authorName = lines[1]
        const authorEmail = lines[2]
        const committedAt = lines[3]
        const message = lines.slice(4).join("\n").trim()
        commitMap.set(hash, {
          hash,
          authorName,
          authorEmail,
          committedAt,
          message,
          files: [],
        })
      }
    }

    // Fetch file stats and change types via stdin to avoid ARG_MAX
    const stdinHashes = hashes.join("\n")
    const [numstatResult, statusResult] = await Promise.all([
      Bun.$`echo ${stdinHashes} | git -C ${this.cwd} diff-tree --stdin --root -r --numstat`.quiet(),
      Bun.$`echo ${stdinHashes} | git -C ${this.cwd} diff-tree --stdin --root -r --name-status`.quiet(),
    ])

    // Build per-commit change type maps from name-status output
    const changeTypeMap = parseNameStatusByCommit(statusResult.text())

    const numstatText = numstatResult.text()
    let currentHash: string | null = null
    for (const line of numstatText.split("\n")) {
      if (line.length === 0) continue
      // Commit hash lines from diff-tree --stdin are 40-char hex
      if (/^[0-9a-f]{40}$/.test(line)) {
        currentHash = line
        continue
      }
      if (currentHash && line.includes("\t")) {
        const parts = line.split("\t")
        const additions = parts[0] === "-" ? 0 : parseInt(parts[0], 10)
        const deletions = parts[1] === "-" ? 0 : parseInt(parts[1], 10)
        const filePath = parts[2]
        const commit = commitMap.get(currentHash)
        if (commit) {
          commit.files.push({
            filePath,
            changeType: changeTypeMap.get(currentHash)?.get(filePath) ?? "M",
            additions,
            deletions,
          })
        }
      }
    }

    // Preserve input order
    return hashes
      .map((h) => commitMap.get(h))
      .filter((c): c is CommitInfo => c !== undefined)
  }

  /**
   * Returns unified diffs for multiple commits in a single git process spawn,
   * piping hashes via stdin. Each diff is truncated at maxChars.
   * @param hashes - Full SHA-1 commit hashes.
   * @param maxChars - Maximum character length per diff.
   * @returns Map from hash to diff string.
   */
  async getDiffBatch(
    hashes: string[],
    maxChars: number = 12000,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>()
    if (hashes.length === 0) return result

    const stdinHashes = hashes.join("\n")
    const proc =
      await Bun.$`echo ${stdinHashes} | git -C ${this.cwd} diff-tree --stdin --root -p`.quiet()
    const output = proc.text()

    // Split on commit hash boundaries — diff-tree --stdin outputs the hash on its own line
    // before each diff. We split using a regex that matches a 40-char hex hash at start of line.
    const parts = output.split(/^([0-9a-f]{40})$/m)
    // parts array: ['', hash1, diff1, hash2, diff2, ...]
    for (let i = 1; i < parts.length - 1; i += 2) {
      const hash = parts[i].trim()
      const diff = truncateDiff(parts[i + 1], maxChars)
      result.set(hash, diff)
    }

    // Ensure all requested hashes have an entry
    for (const h of hashes) {
      if (!result.has(h)) {
        result.set(h, "")
      }
    }

    return result
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

  /**
   * Returns file contents at specific commits using git cat-file --batch.
   * Uses Bun.spawn for binary-safe I/O.
   * @param entries - Array of { hash, filePath } to fetch.
   * @returns Map keyed by "hash:filePath" to file content Buffer.
   */
  async getFileContentsBatch(
    entries: Array<{ hash: string; filePath: string }>,
  ): Promise<Map<string, Buffer>> {
    const result = new Map<string, Buffer>()
    if (entries.length === 0) return result

    const proc = Bun.spawn(["git", "-C", this.cwd, "cat-file", "--batch"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    // Write all refs to stdin
    const input =
      entries.map((e) => `${e.hash}:${e.filePath}`).join("\n") + "\n"
    proc.stdin.write(input)
    proc.stdin.end()

    // Read all stdout as a single buffer
    const output = Buffer.from(await new Response(proc.stdout).arrayBuffer())
    await proc.exited

    // Parse batch output: each object is either:
    //   <ref> missing\n
    //   <sha> <type> <size>\n<data>\n
    let offset = 0
    for (const entry of entries) {
      const key = `${entry.hash}:${entry.filePath}`

      // Find end of header line
      const newlineIdx = output.indexOf(0x0a, offset)
      if (newlineIdx === -1) break

      const headerLine = output.subarray(offset, newlineIdx).toString("utf-8")

      if (headerLine.endsWith("missing")) {
        offset = newlineIdx + 1
        continue
      }

      // Parse header: "<sha> <type> <size>"
      const parts = headerLine.split(" ")
      const size = parseInt(parts[parts.length - 1], 10)

      // Data starts after the header newline
      const dataStart = newlineIdx + 1
      const dataEnd = dataStart + size
      result.set(key, Buffer.from(output.subarray(dataStart, dataEnd)))

      // Skip past data + trailing newline
      offset = dataEnd + 1
    }

    return result
  }
}
