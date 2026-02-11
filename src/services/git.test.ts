import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { GitService } from "@services/git"
import { mkdtemp, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

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
