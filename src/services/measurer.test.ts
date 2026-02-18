import { describe, test, expect, beforeEach, mock } from "bun:test"
import { createDatabase } from "@db/database"
import { CommitRepository } from "@db/commits"
import { MeasurerService } from "@services/measurer"
import type { IGitService, IndexProgress, CommitInfo } from "@/types"
import { Database } from "bun:sqlite"

describe("MeasurerService", () => {
  let db: Database
  let commits: CommitRepository
  let mockGit: IGitService

  beforeEach(() => {
    db = createDatabase(":memory:")
    commits = new CommitRepository(db)

    mockGit = {
      isGitRepo: mock(() => Promise.resolve(true)),
      getDefaultBranch: mock(() => Promise.resolve("main")),
      getCommitHashes: mock(() => Promise.resolve([])),
      getCommitInfo: mock(() => Promise.resolve({} as CommitInfo)),
      getCommitInfoBatch: mock(() => Promise.resolve([])),
      getDiff: mock(() => Promise.resolve("")),
      getDiffBatch: mock(() => Promise.resolve(new Map())),
      getTotalCommitCount: mock(() => Promise.resolve(0)),
      getFileContentsBatch: mock(() => Promise.resolve(new Map())),
      getTrackedFiles: mock(() => Promise.resolve([])),
    }
  })

  const insertCommit = (
    hash: string,
    files: Array<{
      filePath: string
      changeType: string
      additions?: number
      deletions?: number
    }>,
  ) => {
    commits.insertRawCommits([
      {
        hash,
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: `commit ${hash}`,
        files: files.map((f) => ({
          filePath: f.filePath,
          changeType: f.changeType,
          additions: f.additions ?? 10,
          deletions: f.deletions ?? 5,
        })),
      },
    ])
  }

  test("returns 0 when no unmeasured files exist", async () => {
    const measurer = new MeasurerService(mockGit, commits)
    const count = await measurer.measure(() => {})
    expect(count).toBe(0)
  })

  test("measures complexity for source files", async () => {
    insertCommit("aaa", [{ filePath: "src/main.ts", changeType: "A" }])

    const fileContent = Buffer.from("function foo() {\n    return 1\n}\n")
    mockGit.getFileContentsBatch = mock(() => {
      const map = new Map<string, Buffer>()
      map.set("aaa:src/main.ts", fileContent)
      return Promise.resolve(map)
    })

    const measurer = new MeasurerService(mockGit, commits)
    const count = await measurer.measure(() => {})

    expect(count).toBe(1)

    // Verify DB was updated
    const row = db
      .query<
        {
          lines_of_code: number
          indent_complexity: number
          max_indent: number
        },
        [string, string]
      >(
        "SELECT lines_of_code, indent_complexity, max_indent FROM commit_files WHERE commit_hash = ? AND file_path = ?",
      )
      .get("aaa", "src/main.ts")
    expect(row).not.toBeNull()
    expect(row!.lines_of_code).toBe(3) // 3 non-blank lines
    expect(row!.indent_complexity).toBe(1) // "    return 1" = indent level 1
    expect(row!.max_indent).toBe(1)
  })

  test("sets 0,0,0 for deleted files without fetching", async () => {
    insertCommit("aaa", [{ filePath: "src/removed.ts", changeType: "D" }])

    const measurer = new MeasurerService(mockGit, commits)
    const count = await measurer.measure(() => {})

    expect(count).toBe(1)
    expect(mockGit.getFileContentsBatch).not.toHaveBeenCalled()

    const row = db
      .query<
        {
          lines_of_code: number
          indent_complexity: number
          max_indent: number
        },
        [string, string]
      >(
        "SELECT lines_of_code, indent_complexity, max_indent FROM commit_files WHERE commit_hash = ? AND file_path = ?",
      )
      .get("aaa", "src/removed.ts")
    expect(row!.lines_of_code).toBe(0)
    expect(row!.indent_complexity).toBe(0)
    expect(row!.max_indent).toBe(0)
  })

  test("sets 0,0,0 for generated files without fetching", async () => {
    insertCommit("aaa", [{ filePath: "package-lock.json", changeType: "M" }])

    const measurer = new MeasurerService(mockGit, commits)
    const count = await measurer.measure(() => {})

    expect(count).toBe(1)
    expect(mockGit.getFileContentsBatch).not.toHaveBeenCalled()
  })

  test("sets 0,0,0 for binary files", async () => {
    insertCommit("aaa", [{ filePath: "image.png", changeType: "A" }])

    const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00])
    mockGit.getFileContentsBatch = mock(() => {
      const map = new Map<string, Buffer>()
      map.set("aaa:image.png", binaryContent)
      return Promise.resolve(map)
    })

    const measurer = new MeasurerService(mockGit, commits)
    const count = await measurer.measure(() => {})

    expect(count).toBe(1)
    const row = db
      .query<
        { lines_of_code: number },
        [string, string]
      >("SELECT lines_of_code FROM commit_files WHERE commit_hash = ? AND file_path = ?")
      .get("aaa", "image.png")
    expect(row!.lines_of_code).toBe(0)
  })

  test("sets 0,0,0 for missing files in git", async () => {
    insertCommit("aaa", [{ filePath: "gone.ts", changeType: "A" }])

    // Return empty map (file not found)
    mockGit.getFileContentsBatch = mock(() =>
      Promise.resolve(new Map<string, Buffer>()),
    )

    const measurer = new MeasurerService(mockGit, commits)
    const count = await measurer.measure(() => {})

    expect(count).toBe(1)
    const row = db
      .query<
        { lines_of_code: number },
        [string, string]
      >("SELECT lines_of_code FROM commit_files WHERE commit_hash = ? AND file_path = ?")
      .get("aaa", "gone.ts")
    expect(row!.lines_of_code).toBe(0)
  })

  test("reports progress via callback", async () => {
    insertCommit("aaa", [
      { filePath: "src/a.ts", changeType: "A" },
      { filePath: "src/b.ts", changeType: "A" },
    ])

    mockGit.getFileContentsBatch = mock(() => {
      const map = new Map<string, Buffer>()
      map.set("aaa:src/a.ts", Buffer.from("code\n"))
      map.set("aaa:src/b.ts", Buffer.from("code\n"))
      return Promise.resolve(map)
    })

    const progress: IndexProgress[] = []
    const measurer = new MeasurerService(mockGit, commits)
    await measurer.measure((p) => progress.push({ ...p }))

    expect(progress.length).toBeGreaterThan(0)
    expect(progress[0].phase).toBe("measuring")
    expect(progress[0].total).toBe(2)
    // Final progress should show all processed
    const last = progress[progress.length - 1]
    expect(last.current).toBe(2)
  })

  test("handles mixed file types in a single batch", async () => {
    insertCommit("aaa", [
      { filePath: "src/code.ts", changeType: "M" },
      { filePath: "old.ts", changeType: "D" },
      { filePath: "yarn.lock", changeType: "M" },
    ])

    mockGit.getFileContentsBatch = mock(() => {
      const map = new Map<string, Buffer>()
      map.set("aaa:src/code.ts", Buffer.from("    indented\n"))
      return Promise.resolve(map)
    })

    const measurer = new MeasurerService(mockGit, commits)
    const count = await measurer.measure(() => {})

    expect(count).toBe(3)

    // code.ts should have real measurements
    const code = db
      .query<
        { lines_of_code: number; indent_complexity: number },
        [string, string]
      >("SELECT lines_of_code, indent_complexity FROM commit_files WHERE commit_hash = ? AND file_path = ?")
      .get("aaa", "src/code.ts")
    expect(code!.lines_of_code).toBe(1)
    expect(code!.indent_complexity).toBe(1)

    // Deleted and generated should be 0
    const deleted = db
      .query<
        { lines_of_code: number },
        [string, string]
      >("SELECT lines_of_code FROM commit_files WHERE commit_hash = ? AND file_path = ?")
      .get("aaa", "old.ts")
    expect(deleted!.lines_of_code).toBe(0)
  })

  test("does not re-measure already measured files", async () => {
    insertCommit("aaa", [{ filePath: "src/main.ts", changeType: "A" }])

    // Pre-measure
    commits.updateComplexity("aaa", "src/main.ts", 10, 5, 3)

    const measurer = new MeasurerService(mockGit, commits)
    const count = await measurer.measure(() => {})

    expect(count).toBe(0)
    expect(mockGit.getFileContentsBatch).not.toHaveBeenCalled()
  })
})
