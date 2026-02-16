import { describe, test, expect, beforeEach } from "bun:test"
import { createDatabase } from "@db/database"
import { CommitRepository } from "@db/commits"
import { AggregateRepository } from "@db/aggregates"
import type { CommitInfo } from "@/types"
import { Database } from "bun:sqlite"

describe("AggregateRepository", () => {
  let db: Database
  let commits: CommitRepository
  let aggregates: AggregateRepository

  beforeEach(() => {
    db = createDatabase(":memory:")
    commits = new CommitRepository(db)
    aggregates = new AggregateRepository(db)
  })

  const seedData = () => {
    const commitData: CommitInfo[] = [
      {
        hash: "aaa",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "initial commit",
        files: [
          {
            filePath: "src/main.ts",
            changeType: "A",
            additions: 100,
            deletions: 0,
          },
          {
            filePath: "src/utils.ts",
            changeType: "A",
            additions: 50,
            deletions: 0,
          },
        ],
      },
      {
        hash: "bbb",
        authorName: "Bob",
        authorEmail: "bob@example.com",
        committedAt: "2024-02-01T00:00:00Z",
        message: "fix bug",
        files: [
          {
            filePath: "src/main.ts",
            changeType: "M",
            additions: 5,
            deletions: 3,
          },
          {
            filePath: "src/utils.ts",
            changeType: "M",
            additions: 2,
            deletions: 1,
          },
        ],
      },
      {
        hash: "ccc",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        committedAt: "2024-03-01T00:00:00Z",
        message: "add feature",
        files: [
          {
            filePath: "src/main.ts",
            changeType: "M",
            additions: 20,
            deletions: 5,
          },
          {
            filePath: "src/new.ts",
            changeType: "A",
            additions: 80,
            deletions: 0,
          },
        ],
      },
    ]
    commits.insertRawCommits(commitData)
    commits.updateEnrichment("aaa", "feature", "Initial setup", "haiku-4.5")
    commits.updateEnrichment(
      "bbb",
      "bug-fix",
      "Fixed null pointer",
      "haiku-4.5",
    )
    commits.updateEnrichment("ccc", "feature", "Added login page", "haiku-4.5")
  }

  test("rebuildFileStats computes correct stats", () => {
    seedData()
    aggregates.rebuildFileStats()

    const main = aggregates.getFileStats("src/main.ts")
    expect(main).not.toBeNull()
    expect(main!.total_changes).toBe(3)
    expect(main!.bug_fix_count).toBe(1)
    expect(main!.feature_count).toBe(2)
    expect(main!.first_seen).toBe("2024-01-01T00:00:00Z")
    expect(main!.last_changed).toBe("2024-03-01T00:00:00Z")
    expect(main!.total_additions).toBe(125)
    expect(main!.total_deletions).toBe(8)
  })

  test("rebuildFileStats only counts enriched commits", () => {
    commits.insertRawCommits([
      {
        hash: "unenriched",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "test",
        files: [
          {
            filePath: "src/foo.ts",
            changeType: "A",
            additions: 10,
            deletions: 0,
          },
        ],
      },
    ])
    aggregates.rebuildFileStats()

    const stats = aggregates.getFileStats("src/foo.ts")
    expect(stats).toBeNull()
  })

  test("rebuildFileContributors computes correct contributors", () => {
    seedData()
    aggregates.rebuildFileContributors()

    const contributors = aggregates.getTopContributors("src/main.ts")
    expect(contributors).toHaveLength(2)
    // Alice has 2 commits to main.ts, Bob has 1
    expect(contributors[0].author_name).toBe("Alice")
    expect(contributors[0].commit_count).toBe(2)
    expect(contributors[1].author_name).toBe("Bob")
    expect(contributors[1].commit_count).toBe(1)
  })

  test("rebuildFileCoupling finds co-changed files", () => {
    seedData()
    aggregates.rebuildFileCoupling()

    const coupled = aggregates.getCoupledFiles("src/main.ts")
    // main.ts and utils.ts change together in commits aaa and bbb
    expect(coupled.length).toBeGreaterThanOrEqual(1)
    const mainUtils = coupled.find(
      (c) =>
        (c.file_a === "src/main.ts" && c.file_b === "src/utils.ts") ||
        (c.file_a === "src/utils.ts" && c.file_b === "src/main.ts"),
    )
    expect(mainUtils).toBeDefined()
    expect(mainUtils!.co_change_count).toBe(2)
  })

  test("getHotspots returns files ordered by change frequency", () => {
    seedData()
    aggregates.rebuildFileStats()

    const hotspots = aggregates.getHotspots({ limit: 10 })
    expect(hotspots.length).toBe(3)
    expect(hotspots[0].file_path).toBe("src/main.ts")
    expect(hotspots[0].total_changes).toBe(3)
  })

  test("getHotspots respects limit", () => {
    seedData()
    aggregates.rebuildFileStats()

    const hotspots = aggregates.getHotspots({ limit: 1 })
    expect(hotspots).toHaveLength(1)
  })

  test("getCoupledFiles filters by threshold", () => {
    // Only files with >= 2 co-changes are stored
    commits.insertRawCommits([
      {
        hash: "one",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "one",
        files: [
          { filePath: "a.ts", changeType: "A", additions: 1, deletions: 0 },
          { filePath: "b.ts", changeType: "A", additions: 1, deletions: 0 },
        ],
      },
    ])
    commits.updateEnrichment("one", "feature", "test", "haiku-4.5")
    aggregates.rebuildFileCoupling()

    // Single co-change: below threshold of 2
    const coupled = aggregates.getCoupledFiles("a.ts")
    expect(coupled).toHaveLength(0)
  })

  test("getHotspots sorts by classification", () => {
    seedData()
    aggregates.rebuildFileStats()

    const hotspots = aggregates.getHotspots({ sort: "bug-fix", limit: 10 })
    // Only commit bbb is bug-fix, touching main.ts and utils.ts (1 each)
    // new.ts has 0 bug-fix commits
    expect(hotspots[0].bug_fix_count).toBeGreaterThanOrEqual(
      hotspots[hotspots.length - 1].bug_fix_count,
    )
  })

  test("getHotspots filters by path prefix", () => {
    seedData()
    aggregates.rebuildFileStats()

    const hotspots = aggregates.getHotspots({
      pathPrefix: "src/",
      limit: 10,
    })
    expect(hotspots.length).toBe(3)
    for (const h of hotspots) {
      expect(h.file_path.startsWith("src/")).toBe(true)
    }
  })

  test("getHotspots filters by path prefix narrowly", () => {
    seedData()
    aggregates.rebuildFileStats()

    const hotspots = aggregates.getHotspots({
      pathPrefix: "src/new",
      limit: 10,
    })
    expect(hotspots).toHaveLength(1)
    expect(hotspots[0].file_path).toBe("src/new.ts")
  })

  test("getHotspots combines sort and path prefix", () => {
    seedData()
    aggregates.rebuildFileStats()

    const hotspots = aggregates.getHotspots({
      sort: "feature",
      pathPrefix: "src/",
      limit: 2,
    })
    expect(hotspots.length).toBeLessThanOrEqual(2)
    // Should be sorted by feature_count descending
    if (hotspots.length >= 2) {
      expect(hotspots[0].feature_count).toBeGreaterThanOrEqual(
        hotspots[1].feature_count,
      )
    }
  })

  test("getHotspots throws on invalid sort value", () => {
    seedData()
    aggregates.rebuildFileStats()

    expect(() => aggregates.getHotspots({ sort: "invalid" })).toThrow(
      'Invalid sort field "invalid"',
    )
  })

  test("getHotspots defaults work with no options", () => {
    seedData()
    aggregates.rebuildFileStats()

    const hotspots = aggregates.getHotspots()
    expect(hotspots.length).toBe(3)
    expect(hotspots[0].file_path).toBe("src/main.ts")
  })

  test("rebuildFileStats is idempotent", () => {
    seedData()
    aggregates.rebuildFileStats()
    aggregates.rebuildFileStats()

    const hotspots = aggregates.getHotspots({ limit: 10 })
    expect(hotspots.length).toBe(3)
  })

  test("getFileStats returns null for unknown file", () => {
    expect(aggregates.getFileStats("nonexistent.ts")).toBeNull()
  })

  test("getTopContributors returns empty for unknown file", () => {
    expect(aggregates.getTopContributors("nonexistent.ts")).toHaveLength(0)
  })

  test("getCoupledFiles returns empty for unknown file", () => {
    expect(aggregates.getCoupledFiles("nonexistent.ts")).toHaveLength(0)
  })

  test("getDirectoryStats aggregates across files in prefix", () => {
    seedData()
    aggregates.rebuildFileStats()

    const stats = aggregates.getDirectoryStats("src/")
    expect(stats).not.toBeNull()
    // src/main.ts: 3, src/utils.ts: 2, src/new.ts: 1 = 6 total
    expect(stats!.total_changes).toBe(6)
    expect(stats!.bug_fix_count).toBe(2) // bbb touches main.ts and utils.ts
    expect(stats!.feature_count).toBe(4) // aaa: main+utils, ccc: main+new
    expect(stats!.first_seen).toBe("2024-01-01T00:00:00Z")
    expect(stats!.last_changed).toBe("2024-03-01T00:00:00Z")
    expect(stats!.file_path).toBe("src/")
  })

  test("getDirectoryStats returns null for no matches", () => {
    seedData()
    aggregates.rebuildFileStats()

    const stats = aggregates.getDirectoryStats("nonexistent/")
    expect(stats).toBeNull()
  })

  test("getDirectoryStats works with narrow prefix", () => {
    seedData()
    aggregates.rebuildFileStats()

    const stats = aggregates.getDirectoryStats("src/new")
    expect(stats).not.toBeNull()
    expect(stats!.total_changes).toBe(1)
  })

  test("getDirectoryContributors aggregates across files", () => {
    seedData()
    aggregates.rebuildFileContributors()

    const contributors = aggregates.getDirectoryContributors("src/")
    expect(contributors.length).toBeGreaterThanOrEqual(2)
    // Alice has commits aaa (main+utils) + ccc (main+new) = 4 file touches
    // Bob has commit bbb (main+utils) = 2 file touches
    expect(contributors[0].author_name).toBe("Alice")
    expect(contributors[0].commit_count).toBe(4)
    expect(contributors[1].author_name).toBe("Bob")
    expect(contributors[1].commit_count).toBe(2)
    expect(contributors[0].file_path).toBe("src/")
  })

  test("getDirectoryContributors respects limit", () => {
    seedData()
    aggregates.rebuildFileContributors()

    const contributors = aggregates.getDirectoryContributors("src/", 1)
    expect(contributors).toHaveLength(1)
  })

  test("getDirectoryContributors returns empty for no matches", () => {
    seedData()
    aggregates.rebuildFileContributors()

    const contributors = aggregates.getDirectoryContributors("nonexistent/")
    expect(contributors).toHaveLength(0)
  })

  test("getDirectoryFileCount returns correct count", () => {
    seedData()
    aggregates.rebuildFileStats()

    expect(aggregates.getDirectoryFileCount("src/")).toBe(3)
    expect(aggregates.getDirectoryFileCount("src/main")).toBe(1)
    expect(aggregates.getDirectoryFileCount("nonexistent/")).toBe(0)
  })

  test("getTopCoupledPairs returns global pairs by co-change count", () => {
    seedData()
    aggregates.rebuildFileCoupling()

    const pairs = aggregates.getTopCoupledPairs(10)
    expect(pairs.length).toBeGreaterThanOrEqual(1)
    expect(pairs[0].file_a).toBeDefined()
    expect(pairs[0].file_b).toBeDefined()
    expect(pairs[0].co_change_count).toBeGreaterThanOrEqual(2)
    // main.ts + utils.ts co-change in aaa and bbb
    const mainUtils = pairs.find(
      (p) => p.file_a === "src/main.ts" && p.file_b === "src/utils.ts",
    )
    expect(mainUtils).toBeDefined()
    expect(mainUtils!.co_change_count).toBe(2)
  })

  test("getTopCoupledPairs respects limit", () => {
    seedData()
    aggregates.rebuildFileCoupling()

    const pairs = aggregates.getTopCoupledPairs(1)
    expect(pairs).toHaveLength(1)
  })

  test("getTopCoupledPairs returns empty when no coupling data", () => {
    const pairs = aggregates.getTopCoupledPairs(10)
    expect(pairs).toHaveLength(0)
  })

  test("getCoupledFilesWithRatio returns files with ratio", () => {
    seedData()
    aggregates.rebuildFileStats()
    aggregates.rebuildFileCoupling()

    const coupled = aggregates.getCoupledFilesWithRatio("src/main.ts", 10)
    expect(coupled.length).toBeGreaterThanOrEqual(1)
    const utils = coupled.find((c) => c.file === "src/utils.ts")
    expect(utils).toBeDefined()
    expect(utils!.co_change_count).toBe(2)
    // main.ts has 3 total changes, ratio = 2/3 ≈ 0.67
    expect(utils!.coupling_ratio).toBe(0.67)
  })

  test("getCoupledFilesWithRatio respects limit", () => {
    seedData()
    aggregates.rebuildFileStats()
    aggregates.rebuildFileCoupling()

    const coupled = aggregates.getCoupledFilesWithRatio("src/main.ts", 1)
    expect(coupled).toHaveLength(1)
  })

  test("getCoupledFilesWithRatio returns empty for unknown file", () => {
    const coupled = aggregates.getCoupledFilesWithRatio("nonexistent.ts", 10)
    expect(coupled).toHaveLength(0)
  })

  test("getCoupledFilesForDirectory returns external coupled files", () => {
    // Add data with cross-directory coupling
    const commitData: CommitInfo[] = [
      {
        hash: "d1",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "cross dir change 1",
        files: [
          {
            filePath: "src/services/git.ts",
            changeType: "M",
            additions: 10,
            deletions: 5,
          },
          {
            filePath: "src/db/commits.ts",
            changeType: "M",
            additions: 5,
            deletions: 2,
          },
        ],
      },
      {
        hash: "d2",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        committedAt: "2024-02-01T00:00:00Z",
        message: "cross dir change 2",
        files: [
          {
            filePath: "src/services/git.ts",
            changeType: "M",
            additions: 8,
            deletions: 3,
          },
          {
            filePath: "src/db/commits.ts",
            changeType: "M",
            additions: 4,
            deletions: 1,
          },
        ],
      },
    ]
    commits.insertRawCommits(commitData)
    commits.updateEnrichment("d1", "feature", "Cross dir 1", "haiku-4.5")
    commits.updateEnrichment("d2", "refactor", "Cross dir 2", "haiku-4.5")
    aggregates.rebuildFileStats()
    aggregates.rebuildFileCoupling()

    const coupled = aggregates.getCoupledFilesForDirectory("src/services/", 10)
    expect(coupled.length).toBeGreaterThanOrEqual(1)
    const dbCommits = coupled.find((c) => c.file === "src/db/commits.ts")
    expect(dbCommits).toBeDefined()
    expect(dbCommits!.co_change_count).toBe(2)
    expect(dbCommits!.coupling_ratio).toBeGreaterThan(0)
  })

  test("getCoupledFilesForDirectory returns empty for no matches", () => {
    const coupled = aggregates.getCoupledFilesForDirectory("nonexistent/", 10)
    expect(coupled).toHaveLength(0)
  })

  test("getCoupledFilesForDirectory respects limit", () => {
    seedData()
    aggregates.rebuildFileStats()
    aggregates.rebuildFileCoupling()

    const coupled = aggregates.getCoupledFilesForDirectory("src/", 1)
    expect(coupled.length).toBeLessThanOrEqual(1)
  })
})
