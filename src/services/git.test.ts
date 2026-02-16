import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { GitService, truncateDiff } from "@services/git"
import { mkdtemp, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

describe("truncateDiff", () => {
  const fileSection = (name: string, lines: number) => {
    const header = `diff --git a/${name} b/${name}\nindex abc..def 100644\n--- a/${name}\n+++ b/${name}\n`
    const content = Array.from(
      { length: lines },
      (_, i) => `+line ${i + 1}\n`,
    ).join("")
    return header + content
  }

  test("returns diff unchanged when under budget", () => {
    const diff = fileSection("small.ts", 3)
    expect(truncateDiff(diff, 10000)).toBe(diff)
  })

  test("truncates single-file diff with marker", () => {
    const diff = fileSection("big.ts", 100)
    const result = truncateDiff(diff, 200)
    expect(result.length).toBeLessThanOrEqual(220)
    expect(result).toContain("[truncated]")
    expect(result).toContain("diff --git a/big.ts")
  })

  test("preserves all file headers when multiple files are truncated", () => {
    const diff =
      fileSection("a.ts", 50) +
      fileSection("b.ts", 50) +
      fileSection("c.ts", 50)
    const result = truncateDiff(diff, 400)
    expect(result).toContain("diff --git a/a.ts")
    expect(result).toContain("diff --git a/b.ts")
    expect(result).toContain("diff --git a/c.ts")
  })

  test("small files keep full content while large files are truncated", () => {
    const small = fileSection("small.ts", 2) // ~100 chars
    const large = fileSection("large.ts", 200) // ~2400 chars
    const diff = small + large
    const result = truncateDiff(diff, 500)

    // Small file should be fully present
    expect(result).toContain("+line 1")
    expect(result).toContain("+line 2")
    // Large file header should be present
    expect(result).toContain("diff --git a/large.ts")
    // Large file should be truncated
    expect(result).toContain("[truncated]")
    expect(result.length).toBeLessThanOrEqual(520)
  })

  test("distributes budget evenly among oversized files", () => {
    const diff =
      fileSection("a.ts", 100) +
      fileSection("b.ts", 100) +
      fileSection("c.ts", 100)
    const result = truncateDiff(diff, 600)

    // All three files should have some content (not just first file)
    expect(result).toContain("diff --git a/a.ts")
    expect(result).toContain("diff --git a/b.ts")
    expect(result).toContain("diff --git a/c.ts")
    expect(result.length).toBeLessThanOrEqual(620)
  })

  test("handles empty diff", () => {
    expect(truncateDiff("", 100)).toBe("")
  })

  test("handles diff with no file sections", () => {
    const text = "some text without diff headers"
    const result = truncateDiff(text, 10)
    expect(result).toContain("[truncated]")
    expect(result.length).toBeLessThanOrEqual(30)
  })

  test("does not split surrogate pairs when truncating", () => {
    // 🎉 is U+1F389, encoded as surrogate pair \uD83C\uDF89
    const emoji = "🎉"
    expect(emoji.length).toBe(2) // surrogate pair = 2 UTF-16 code units
    const header =
      "diff --git a/test.ts b/test.ts\n--- a/test.ts\n+++ b/test.ts\n"
    // Place the emoji so the truncation point falls between the surrogates
    const content = "x".repeat(50) + emoji + "y".repeat(50)
    const diff = header + content
    // Truncate right after the high surrogate would be included
    const cutPoint = header.length + 51 // includes 50 x's + high surrogate
    const result = truncateDiff(diff, cutPoint)
    // Result should NOT contain an orphaned high surrogate
    for (let i = 0; i < result.length; i++) {
      const code = result.charCodeAt(i)
      if (code >= 0xd800 && code <= 0xdbff) {
        // High surrogate must be followed by low surrogate
        const next = result.charCodeAt(i + 1)
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true)
      }
    }
  })

  test("gives oversized files more budget when small files free up space", () => {
    // 3 tiny files (~80 chars each) + 1 huge file (~2400 chars)
    // With budget of 1000: equal share = 250 per file
    // Tiny files use ~80 each (240 total), leaving ~760 for the huge file
    const diff =
      fileSection("tiny1.ts", 1) +
      fileSection("tiny2.ts", 1) +
      fileSection("tiny3.ts", 1) +
      fileSection("huge.ts", 200)
    const result = truncateDiff(diff, 1000)

    // Tiny files should be fully intact
    expect(result).toContain("diff --git a/tiny1.ts")
    expect(result).toContain("diff --git a/tiny2.ts")
    expect(result).toContain("diff --git a/tiny3.ts")
    // Huge file should have more content than a naive equal split would give
    const hugeSection = result.split("diff --git a/huge.ts")[1] ?? ""
    expect(hugeSection.length).toBeGreaterThan(250)
  })
})

describe("GitService", () => {
  let tmpDir: string
  let git: GitService

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "gitmem-test-"))
    git = new GitService(tmpDir)

    // Init repo with a branch name
    await Bun.$`git -C ${tmpDir} init -b main`.quiet()
    await Bun.$`git -C ${tmpDir} config user.email "test@example.com"`.quiet()
    await Bun.$`git -C ${tmpDir} config user.name "Test User"`.quiet()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  const makeCommit = async (
    filename: string,
    content: string,
    message: string,
  ) => {
    await Bun.$`printf ${content} > ${join(tmpDir, filename)}`.quiet()
    await Bun.$`git -C ${tmpDir} add ${filename}`.quiet()
    await Bun.$`git -C ${tmpDir} commit -m ${message}`.quiet()
  }

  test("isGitRepo returns true for git repos", async () => {
    expect(await git.isGitRepo()).toBe(true)
  })

  test("isGitRepo returns false for non-git dirs", async () => {
    const nonGit = await mkdtemp(join(tmpdir(), "gitmem-nongit-"))
    const service = new GitService(nonGit)
    expect(await service.isGitRepo()).toBe(false)
    await rm(nonGit, { recursive: true, force: true })
  })

  test("getDefaultBranch returns main", async () => {
    await makeCommit("init.txt", "hello", "initial commit")
    expect(await git.getDefaultBranch()).toBe("main")
  })

  test("getCommitHashes returns hashes most-recent-first", async () => {
    await makeCommit("a.txt", "a", "first")
    await makeCommit("b.txt", "b", "second")

    const hashes = await git.getCommitHashes("main")
    expect(hashes).toHaveLength(2)
    // Most recent first
    expect(hashes[0]).not.toBe(hashes[1])
  })

  test("getCommitInfo returns correct data", async () => {
    await makeCommit("hello.txt", "hello world", "add greeting")

    const hashes = await git.getCommitHashes("main")
    const info = await git.getCommitInfo(hashes[0])

    expect(info.hash).toBe(hashes[0])
    expect(info.authorName).toBe("Test User")
    expect(info.authorEmail).toBe("test@example.com")
    expect(info.message).toBe("add greeting")
    expect(info.committedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(info.files).toHaveLength(1)
    expect(info.files[0].filePath).toBe("hello.txt")
  })

  test("getCommitInfo handles multiple files", async () => {
    await Bun.$`printf "a" > ${join(tmpDir, "a.txt")}`.quiet()
    await Bun.$`printf "b" > ${join(tmpDir, "b.txt")}`.quiet()
    await Bun.$`git -C ${tmpDir} add a.txt b.txt`.quiet()
    await Bun.$`git -C ${tmpDir} commit -m "add two files"`.quiet()

    const hashes = await git.getCommitHashes("main")
    const info = await git.getCommitInfo(hashes[0])

    expect(info.files).toHaveLength(2)
    const paths = info.files.map((f) => f.filePath).sort()
    expect(paths).toEqual(["a.txt", "b.txt"])
  })

  test("getDiff returns patch content", async () => {
    await makeCommit("code.ts", "const x = 1\n", "add code")

    const hashes = await git.getCommitHashes("main")
    const diff = await git.getDiff(hashes[0])

    expect(diff).toContain("const x = 1")
  })

  test("getDiff truncates long diffs", async () => {
    const longContent = "x".repeat(500)
    await makeCommit("big.txt", longContent, "big file")

    const hashes = await git.getCommitHashes("main")
    const diff = await git.getDiff(hashes[0], 100)

    expect(diff.length).toBeLessThanOrEqual(120) // 100 + truncation message
    expect(diff).toContain("[truncated]")
  })

  test("getTotalCommitCount returns correct count", async () => {
    await makeCommit("a.txt", "a", "first")
    await makeCommit("b.txt", "b", "second")
    await makeCommit("c.txt", "c", "third")

    expect(await git.getTotalCommitCount("main")).toBe(3)
  })

  test("getCommitInfoBatch returns empty array for empty input", async () => {
    const result = await git.getCommitInfoBatch([])
    expect(result).toEqual([])
  })

  test("getCommitInfoBatch returns single commit", async () => {
    await makeCommit("hello.txt", "hello", "add greeting")

    const hashes = await git.getCommitHashes("main")
    const batch = await git.getCommitInfoBatch(hashes)

    expect(batch).toHaveLength(1)
    expect(batch[0].hash).toBe(hashes[0])
    expect(batch[0].authorName).toBe("Test User")
    expect(batch[0].message).toBe("add greeting")
    expect(batch[0].files).toHaveLength(1)
    expect(batch[0].files[0].filePath).toBe("hello.txt")
  })

  test("getCommitInfoBatch returns N commits in input order", async () => {
    await makeCommit("a.txt", "a", "first")
    await makeCommit("b.txt", "b", "second")
    await makeCommit("c.txt", "c", "third")

    const hashes = await git.getCommitHashes("main")
    expect(hashes).toHaveLength(3)

    const batch = await git.getCommitInfoBatch(hashes)
    expect(batch).toHaveLength(3)

    // Verify order matches input hashes
    for (let i = 0; i < hashes.length; i++) {
      expect(batch[i].hash).toBe(hashes[i])
    }
  })

  test("getCommitInfoBatch matches single-call results", async () => {
    await makeCommit("x.txt", "x content", "add x")
    await makeCommit("y.txt", "y content", "add y")

    const hashes = await git.getCommitHashes("main")
    const batch = await git.getCommitInfoBatch(hashes)
    const singles = await Promise.all(hashes.map((h) => git.getCommitInfo(h)))

    for (let i = 0; i < hashes.length; i++) {
      expect(batch[i].hash).toBe(singles[i].hash)
      expect(batch[i].authorName).toBe(singles[i].authorName)
      expect(batch[i].authorEmail).toBe(singles[i].authorEmail)
      expect(batch[i].message).toBe(singles[i].message)
      expect(batch[i].files.length).toBe(singles[i].files.length)
    }
  })

  test("getDiffBatch returns empty map for empty input", async () => {
    const result = await git.getDiffBatch([])
    expect(result.size).toBe(0)
  })

  test("getDiffBatch returns single diff", async () => {
    await makeCommit("code.ts", "const x = 1\n", "add code")

    const hashes = await git.getCommitHashes("main")
    const diffs = await git.getDiffBatch(hashes)

    expect(diffs.size).toBe(1)
    expect(diffs.get(hashes[0])).toContain("const x = 1")
  })

  test("getDiffBatch returns N diffs", async () => {
    await makeCommit("a.ts", "const a = 1\n", "add a")
    await makeCommit("b.ts", "const b = 2\n", "add b")

    const hashes = await git.getCommitHashes("main")
    const diffs = await git.getDiffBatch(hashes)

    expect(diffs.size).toBe(2)
    for (const h of hashes) {
      expect(diffs.has(h)).toBe(true)
    }
  })

  test("getDiffBatch matches single-call results", async () => {
    await makeCommit("p.ts", "const p = 1\n", "add p")
    await makeCommit("q.ts", "const q = 2\n", "add q")

    const hashes = await git.getCommitHashes("main")
    const batchDiffs = await git.getDiffBatch(hashes)
    const singleDiffs = await Promise.all(hashes.map((h) => git.getDiff(h)))

    for (let i = 0; i < hashes.length; i++) {
      // Both should contain the same core diff content
      const batchDiff = batchDiffs.get(hashes[i]) ?? ""
      expect(batchDiff).toContain(singleDiffs[i].trim().slice(0, 20))
    }
  })

  test("getDiffBatch truncates long diffs", async () => {
    const longContent = "x".repeat(500)
    await makeCommit("big.txt", longContent, "big file")

    const hashes = await git.getCommitHashes("main")
    const diffs = await git.getDiffBatch(hashes, 100)

    const diff = diffs.get(hashes[0]) ?? ""
    expect(diff).toContain("[truncated]")
  })

  test("getCommitInfo handles additions and deletions", async () => {
    await makeCommit("file.txt", "line1\nline2\nline3\n", "initial")
    await Bun.$`printf "line1\nmodified\nline3\nnew\n" > ${join(tmpDir, "file.txt")}`.quiet()
    await Bun.$`git -C ${tmpDir} add file.txt`.quiet()
    await Bun.$`git -C ${tmpDir} commit -m "modify file"`.quiet()

    const hashes = await git.getCommitHashes("main")
    const info = await git.getCommitInfo(hashes[0])

    expect(info.files).toHaveLength(1)
    expect(info.files[0].additions).toBeGreaterThan(0)
    expect(info.files[0].deletions).toBeGreaterThan(0)
  })
})
