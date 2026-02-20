import { describe, test, expect, beforeEach } from "bun:test"
import { createDatabase } from "@db/database"
import { CommitRepository } from "@db/commits"
import { AggregateRepository, computeTrend } from "@db/aggregates"
import type { CommitInfo, TrendPeriod } from "@/types"
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

  test("rebuildFileStats includes unenriched commits with zero classification counts", () => {
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
    expect(stats).not.toBeNull()
    expect(stats!.total_changes).toBe(1)
    expect(stats!.total_additions).toBe(10)
    expect(stats!.bug_fix_count).toBe(0)
    expect(stats!.feature_count).toBe(0)
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

  test("rebuildFileCoupling excludes commits with too many files", () => {
    // Create two commits where files co-change:
    // - "small1" and "small2" each touch fileA + fileB (2 files, under cap)
    // - "huge" touches fileA + fileB + MAX_COUPLING_FILES_PER_COMMIT more files (2 over cap)
    const smallCommits: CommitInfo[] = [
      {
        hash: "small1",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "small 1",
        files: [
          {
            filePath: "fileA.ts",
            changeType: "M",
            additions: 1,
            deletions: 0,
          },
          {
            filePath: "fileB.ts",
            changeType: "M",
            additions: 1,
            deletions: 0,
          },
        ],
      },
      {
        hash: "small2",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        committedAt: "2024-02-01T00:00:00Z",
        message: "small 2",
        files: [
          {
            filePath: "fileA.ts",
            changeType: "M",
            additions: 1,
            deletions: 0,
          },
          {
            filePath: "fileB.ts",
            changeType: "M",
            additions: 1,
            deletions: 0,
          },
        ],
      },
    ]
    commits.insertRawCommits(smallCommits)
    commits.updateEnrichment("small1", "feature", "test", "haiku-4.5")
    commits.updateEnrichment("small2", "feature", "test", "haiku-4.5")

    // Create a huge commit that exceeds the cap
    const cap = AggregateRepository.MAX_COUPLING_FILES_PER_COMMIT
    const hugeFiles = Array.from({ length: cap + 2 }, (_, i) => ({
      filePath: `bulk/file${i}.ts`,
      changeType: "A" as const,
      additions: 1,
      deletions: 0,
    }))
    commits.insertRawCommits([
      {
        hash: "huge",
        authorName: "Bot",
        authorEmail: "bot@example.com",
        committedAt: "2024-03-01T00:00:00Z",
        message: "mass rename",
        files: hugeFiles,
      },
    ])
    commits.updateEnrichment("huge", "chore", "mass rename", "haiku-4.5")

    aggregates.rebuildFileCoupling()

    // Small commits should produce coupling for fileA + fileB
    const coupled = aggregates.getCoupledFiles("fileA.ts")
    expect(coupled).toHaveLength(1)
    expect(coupled[0].co_change_count).toBe(2)

    // Huge commit files should NOT appear in coupling at all
    const bulkCoupled = aggregates.getCoupledFiles("bulk/file0.ts")
    expect(bulkCoupled).toHaveLength(0)
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

  test("getHotspots sorts by complexity", () => {
    seedData()
    // Set complexity measurements
    db.run(
      "UPDATE commit_files SET lines_of_code = 100, indent_complexity = 50, max_indent = 5 WHERE file_path = 'src/main.ts'",
    )
    db.run(
      "UPDATE commit_files SET lines_of_code = 200, indent_complexity = 120, max_indent = 8 WHERE file_path = 'src/new.ts'",
    )
    db.run(
      "UPDATE commit_files SET lines_of_code = 10, indent_complexity = 3, max_indent = 1 WHERE file_path = 'src/utils.ts'",
    )
    aggregates.rebuildFileStats()

    const hotspots = aggregates.getHotspots({
      sort: "complexity",
      limit: 10,
    })
    expect(hotspots.length).toBe(3)
    // src/new.ts has highest complexity (120)
    expect(hotspots[0].file_path).toBe("src/new.ts")
  })

  test("getHotspots sorts by combined score", () => {
    seedData()
    // main.ts: 3 changes, complexity 50 => normalized high
    db.run(
      "UPDATE commit_files SET lines_of_code = 100, indent_complexity = 50, max_indent = 5 WHERE file_path = 'src/main.ts'",
    )
    // new.ts: 1 change, complexity 120 => high complexity but low churn
    db.run(
      "UPDATE commit_files SET lines_of_code = 200, indent_complexity = 120, max_indent = 8 WHERE file_path = 'src/new.ts'",
    )
    // utils.ts: 2 changes, complexity 3 => low complexity
    db.run(
      "UPDATE commit_files SET lines_of_code = 10, indent_complexity = 3, max_indent = 1 WHERE file_path = 'src/utils.ts'",
    )
    aggregates.rebuildFileStats()

    const hotspots = aggregates.getHotspots({
      sort: "combined",
      limit: 10,
    })
    expect(hotspots.length).toBe(3)
    // All should have combined_score
    for (const h of hotspots) {
      expect((h as { combined_score: number }).combined_score).toBeDefined()
    }
    // First result should have highest combined score
    expect(
      (hotspots[0] as { combined_score: number }).combined_score,
    ).toBeGreaterThanOrEqual(
      (hotspots[1] as { combined_score: number }).combined_score,
    )
  })

  test("getHotspots combined with path prefix", () => {
    seedData()
    db.run(
      "UPDATE commit_files SET lines_of_code = 100, indent_complexity = 50, max_indent = 5 WHERE file_path = 'src/main.ts'",
    )
    aggregates.rebuildFileStats()

    const hotspots = aggregates.getHotspots({
      sort: "combined",
      pathPrefix: "src/main",
      limit: 10,
    })
    expect(hotspots.length).toBe(1)
    expect(hotspots[0].file_path).toBe("src/main.ts")
  })

  test("getHotspots combined returns 0 for files without complexity", () => {
    seedData()
    aggregates.rebuildFileStats()

    const hotspots = aggregates.getHotspots({
      sort: "combined",
      limit: 10,
    })
    // No complexity data => all scores should be 0
    for (const h of hotspots) {
      expect((h as { combined_score: number }).combined_score).toBe(0)
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

  test("getTrendsForFile returns correct period breakdown", () => {
    seedData()
    const window = "monthly" as const
    const periods = aggregates.getTrendsForFile("src/main.ts", window, 12)

    expect(periods).toHaveLength(3)
    // Most recent first (2024-03, 2024-02, 2024-01)
    expect(periods[0].period).toBe("2024-03")
    expect(periods[0].total_changes).toBe(1)
    expect(periods[0].feature_count).toBe(1)
    expect(periods[1].period).toBe("2024-02")
    expect(periods[1].total_changes).toBe(1)
    expect(periods[1].bug_fix_count).toBe(1)
    expect(periods[2].period).toBe("2024-01")
    expect(periods[2].total_changes).toBe(1)
    expect(periods[2].feature_count).toBe(1)
  })

  test("getTrendsForFile respects limit", () => {
    seedData()
    const window = "monthly" as const
    const periods = aggregates.getTrendsForFile("src/main.ts", window, 2)

    expect(periods).toHaveLength(2)
    expect(periods[0].period).toBe("2024-03")
    expect(periods[1].period).toBe("2024-02")
  })

  test("getTrendsForFile includes unenriched commits with zero classification counts", () => {
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

    const window = "monthly" as const
    const periods = aggregates.getTrendsForFile("src/foo.ts", window, 12)
    expect(periods).toHaveLength(1)
    expect(periods[0].total_changes).toBe(1)
    expect(periods[0].additions).toBe(10)
    expect(periods[0].bug_fix_count).toBe(0)
    expect(periods[0].feature_count).toBe(0)
  })

  test("getTrendsForFile returns empty for unknown file", () => {
    seedData()
    const window = "monthly" as const
    const periods = aggregates.getTrendsForFile("nonexistent.ts", window, 12)
    expect(periods).toHaveLength(0)
  })

  test("getTrendsForDirectory aggregates across files in prefix", () => {
    seedData()
    const window = "monthly" as const
    const periods = aggregates.getTrendsForDirectory("src/", window, 12)

    expect(periods).toHaveLength(3)
    // 2024-03: ccc touches main.ts + new.ts = 1 distinct commit
    expect(periods[0].period).toBe("2024-03")
    expect(periods[0].total_changes).toBe(1)
    // 2024-02: bbb touches main.ts + utils.ts = 1 distinct commit
    expect(periods[1].period).toBe("2024-02")
    expect(periods[1].total_changes).toBe(1)
    // 2024-01: aaa touches main.ts + utils.ts = 1 distinct commit
    expect(periods[2].period).toBe("2024-01")
    expect(periods[2].total_changes).toBe(1)
  })

  test("getTrendsForDirectory returns empty for no matches", () => {
    seedData()
    const window = "monthly" as const
    const periods = aggregates.getTrendsForDirectory("nonexistent/", window, 12)
    expect(periods).toHaveLength(0)
  })

  test("rebuildFileStatsIncremental produces same results as full rebuild", () => {
    seedData()
    aggregates.rebuildFileStatsIncremental(["aaa", "bbb", "ccc"])

    const main = aggregates.getFileStats("src/main.ts")
    expect(main).not.toBeNull()
    expect(main!.total_changes).toBe(3)
    expect(main!.bug_fix_count).toBe(1)
    expect(main!.feature_count).toBe(2)
    expect(main!.first_seen).toBe("2024-01-01T00:00:00Z")
    expect(main!.last_changed).toBe("2024-03-01T00:00:00Z")
    expect(main!.total_additions).toBe(125)
    expect(main!.total_deletions).toBe(8)

    const utils = aggregates.getFileStats("src/utils.ts")
    expect(utils!.total_changes).toBe(2)

    const newFile = aggregates.getFileStats("src/new.ts")
    expect(newFile!.total_changes).toBe(1)
  })

  test("rebuildFileStatsIncremental updates only affected files", () => {
    seedData()
    // Full rebuild first
    aggregates.rebuildFileStats()

    // Add a 4th commit touching only src/main.ts
    commits.insertRawCommits([
      {
        hash: "ddd",
        authorName: "Carol",
        authorEmail: "carol@example.com",
        committedAt: "2024-04-01T00:00:00Z",
        message: "refactor main",
        files: [
          {
            filePath: "src/main.ts",
            changeType: "M",
            additions: 10,
            deletions: 2,
          },
        ],
      },
    ])
    commits.updateEnrichment("ddd", "refactor", "Refactored main", "haiku-4.5")

    // Incremental update with just the new hash
    aggregates.rebuildFileStatsIncremental(["ddd"])

    // main.ts should be updated
    const main = aggregates.getFileStats("src/main.ts")
    expect(main!.total_changes).toBe(4)
    expect(main!.refactor_count).toBe(1)
    expect(main!.last_changed).toBe("2024-04-01T00:00:00Z")
    expect(main!.total_additions).toBe(135)

    // utils.ts and new.ts should be unchanged from full rebuild
    const utils = aggregates.getFileStats("src/utils.ts")
    expect(utils!.total_changes).toBe(2)
    const newFile = aggregates.getFileStats("src/new.ts")
    expect(newFile!.total_changes).toBe(1)
  })

  test("rebuildFileContributorsIncremental produces same results as full rebuild", () => {
    seedData()
    aggregates.rebuildFileContributorsIncremental(["aaa", "bbb", "ccc"])

    const contributors = aggregates.getTopContributors("src/main.ts")
    expect(contributors).toHaveLength(2)
    expect(contributors[0].author_name).toBe("Alice")
    expect(contributors[0].commit_count).toBe(2)
    expect(contributors[1].author_name).toBe("Bob")
    expect(contributors[1].commit_count).toBe(1)
  })

  test("rebuildFileContributorsIncremental updates only affected files", () => {
    seedData()
    aggregates.rebuildFileContributors()

    commits.insertRawCommits([
      {
        hash: "ddd",
        authorName: "Carol",
        authorEmail: "carol@example.com",
        committedAt: "2024-04-01T00:00:00Z",
        message: "carol change",
        files: [
          {
            filePath: "src/main.ts",
            changeType: "M",
            additions: 5,
            deletions: 1,
          },
        ],
      },
    ])
    commits.updateEnrichment("ddd", "feature", "Carol's change", "haiku-4.5")

    aggregates.rebuildFileContributorsIncremental(["ddd"])

    const contributors = aggregates.getTopContributors("src/main.ts")
    expect(contributors).toHaveLength(3)
    const carol = contributors.find((c) => c.author_name === "Carol")
    expect(carol).toBeDefined()
    expect(carol!.commit_count).toBe(1)

    // utils.ts contributors should be unchanged
    const utilsContribs = aggregates.getTopContributors("src/utils.ts")
    expect(utilsContribs).toHaveLength(2)
  })

  test("rebuildFileCouplingIncremental produces same results as full rebuild", () => {
    seedData()
    aggregates.rebuildFileCouplingIncremental(["aaa", "bbb", "ccc"])

    const coupled = aggregates.getCoupledFiles("src/main.ts")
    const mainUtils = coupled.find(
      (c) =>
        (c.file_a === "src/main.ts" && c.file_b === "src/utils.ts") ||
        (c.file_a === "src/utils.ts" && c.file_b === "src/main.ts"),
    )
    expect(mainUtils).toBeDefined()
    expect(mainUtils!.co_change_count).toBe(2)
  })

  test("rebuildFileCouplingIncremental updates affected pairs", () => {
    seedData()
    aggregates.rebuildFileCoupling()

    // Add a 4th commit touching main.ts and new.ts (creating a new coupling pair)
    commits.insertRawCommits([
      {
        hash: "ddd",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        committedAt: "2024-04-01T00:00:00Z",
        message: "cross change",
        files: [
          {
            filePath: "src/main.ts",
            changeType: "M",
            additions: 5,
            deletions: 1,
          },
          {
            filePath: "src/new.ts",
            changeType: "M",
            additions: 3,
            deletions: 0,
          },
        ],
      },
    ])
    commits.updateEnrichment("ddd", "feature", "Cross change", "haiku-4.5")

    aggregates.rebuildFileCouplingIncremental(["ddd"])

    // main.ts + new.ts should now have 2 co-changes (ccc + ddd)
    const coupled = aggregates.getCoupledFiles("src/main.ts")
    const mainNew = coupled.find(
      (c) =>
        (c.file_a === "src/main.ts" && c.file_b === "src/new.ts") ||
        (c.file_a === "src/new.ts" && c.file_b === "src/main.ts"),
    )
    expect(mainNew).toBeDefined()
    expect(mainNew!.co_change_count).toBe(2)

    // main.ts + utils.ts should still have 2 co-changes
    const mainUtils = coupled.find(
      (c) =>
        (c.file_a === "src/main.ts" && c.file_b === "src/utils.ts") ||
        (c.file_a === "src/utils.ts" && c.file_b === "src/main.ts"),
    )
    expect(mainUtils).toBeDefined()
    expect(mainUtils!.co_change_count).toBe(2)
  })

  test("rebuildFileStats picks most recent non-zero loc and complexity", () => {
    commits.insertRawCommits([
      {
        hash: "old",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "old commit",
        files: [
          {
            filePath: "src/app.ts",
            changeType: "A",
            additions: 50,
            deletions: 0,
          },
        ],
      },
      {
        hash: "new",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        committedAt: "2024-06-01T00:00:00Z",
        message: "new commit",
        files: [
          {
            filePath: "src/app.ts",
            changeType: "M",
            additions: 10,
            deletions: 5,
          },
        ],
      },
    ])
    commits.updateEnrichment("old", "feature", "old", "haiku-4.5")
    commits.updateEnrichment("new", "feature", "new", "haiku-4.5")
    // Old commit has loc=100, complexity=20; new commit has loc=200, complexity=40
    db.run(
      "UPDATE commit_files SET lines_of_code = 100, indent_complexity = 20 WHERE commit_hash = 'old' AND file_path = 'src/app.ts'",
    )
    db.run(
      "UPDATE commit_files SET lines_of_code = 200, indent_complexity = 40 WHERE commit_hash = 'new' AND file_path = 'src/app.ts'",
    )

    aggregates.rebuildFileStats()
    const stats = aggregates.getFileStats("src/app.ts")
    expect(stats).not.toBeNull()
    // Should pick the newer commit's values
    expect(stats!.current_loc).toBe(200)
    expect(stats!.current_complexity).toBe(40)
  })

  test("rebuildFileStatsIncremental picks most recent non-zero loc and complexity", () => {
    commits.insertRawCommits([
      {
        hash: "old",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "old commit",
        files: [
          {
            filePath: "src/app.ts",
            changeType: "A",
            additions: 50,
            deletions: 0,
          },
        ],
      },
      {
        hash: "new",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        committedAt: "2024-06-01T00:00:00Z",
        message: "new commit",
        files: [
          {
            filePath: "src/app.ts",
            changeType: "M",
            additions: 10,
            deletions: 5,
          },
        ],
      },
    ])
    commits.updateEnrichment("old", "feature", "old", "haiku-4.5")
    commits.updateEnrichment("new", "feature", "new", "haiku-4.5")
    db.run(
      "UPDATE commit_files SET lines_of_code = 100, indent_complexity = 20 WHERE commit_hash = 'old' AND file_path = 'src/app.ts'",
    )
    db.run(
      "UPDATE commit_files SET lines_of_code = 200, indent_complexity = 40 WHERE commit_hash = 'new' AND file_path = 'src/app.ts'",
    )

    aggregates.rebuildFileStatsIncremental(["old", "new"])
    const stats = aggregates.getFileStats("src/app.ts")
    expect(stats).not.toBeNull()
    expect(stats!.current_loc).toBe(200)
    expect(stats!.current_complexity).toBe(40)
  })

  test("rebuildFileStatsIncremental with empty hashes is a no-op", () => {
    seedData()
    aggregates.rebuildFileStatsIncremental([])
    // No file_stats should exist
    expect(aggregates.getFileStats("src/main.ts")).toBeNull()
  })

  test("getTrendsForFile throws on invalid window key", () => {
    seedData()
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aggregates.getTrendsForFile("src/main.ts", "invalid" as any, 12),
    ).toThrow('Invalid window "invalid"')
  })

  test("getTrendsForDirectory throws on invalid window key", () => {
    seedData()
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aggregates.getTrendsForDirectory("src/", "invalid" as any, 12),
    ).toThrow('Invalid window "invalid"')
  })

  test("getAllFileStats returns all rows", () => {
    seedData()
    aggregates.rebuildFileStats()

    const allStats = aggregates.getAllFileStats()
    expect(allStats).toHaveLength(3)
    const paths = allStats.map((s) => s.file_path).sort()
    expect(paths).toEqual(["src/main.ts", "src/new.ts", "src/utils.ts"])
  })

  test("getAllFileStats filters by exclusion categories", () => {
    // Seed with a test file path that matches test patterns
    commits.insertRawCommits([
      {
        hash: "tst",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "add test",
        files: [
          {
            filePath: "src/__tests__/foo.test.ts",
            changeType: "A",
            additions: 10,
            deletions: 0,
          },
        ],
      },
    ])
    commits.updateEnrichment("tst", "test", "Added test", "haiku-4.5")
    aggregates.rebuildFileStats()

    // Without exclusion: should include test file
    const all = aggregates.getAllFileStats()
    expect(all.some((s) => s.file_path.includes("test"))).toBe(true)

    // With test exclusion
    const filtered = aggregates.getAllFileStats(["test"])
    expect(filtered.every((s) => !s.file_path.includes("test"))).toBe(true)
  })

  test("getTrendsForFile includes additions and deletions", () => {
    seedData()
    const window = "monthly" as const
    const periods = aggregates.getTrendsForFile("src/main.ts", window, 12)

    // 2024-03: ccc adds 20, deletes 5
    expect(periods[0].additions).toBe(20)
    expect(periods[0].deletions).toBe(5)
    // 2024-02: bbb adds 5, deletes 3
    expect(periods[1].additions).toBe(5)
    expect(periods[1].deletions).toBe(3)
  })
})

describe("computeTrend", () => {
  const makePeriod = (overrides: Partial<TrendPeriod> = {}): TrendPeriod => ({
    period: "2024-01",
    total_changes: 5,
    bug_fix_count: 1,
    feature_count: 2,
    refactor_count: 1,
    docs_count: 0,
    chore_count: 0,
    perf_count: 0,
    test_count: 0,
    style_count: 0,
    additions: 100,
    deletions: 50,
    avg_complexity: null,
    max_complexity: null,
    avg_loc: null,
    ...overrides,
  })

  test("returns null for fewer than 2 periods", () => {
    expect(computeTrend([])).toBeNull()
    expect(computeTrend([makePeriod()])).toBeNull()
  })

  test("returns increasing when recent avg > historical avg * 1.2", () => {
    // 4 periods: recent half = first 2, historical = last 2
    const periods = [
      makePeriod({ period: "2024-04", total_changes: 10 }),
      makePeriod({ period: "2024-03", total_changes: 10 }),
      makePeriod({ period: "2024-02", total_changes: 3 }),
      makePeriod({ period: "2024-01", total_changes: 3 }),
    ]
    const trend = computeTrend(periods)!
    expect(trend.direction).toBe("increasing")
    expect(trend.recent_avg).toBe(10)
    expect(trend.historical_avg).toBe(3)
  })

  test("returns decreasing when recent avg < historical avg * 0.8", () => {
    const periods = [
      makePeriod({ period: "2024-04", total_changes: 2 }),
      makePeriod({ period: "2024-03", total_changes: 2 }),
      makePeriod({ period: "2024-02", total_changes: 10 }),
      makePeriod({ period: "2024-01", total_changes: 10 }),
    ]
    const trend = computeTrend(periods)!
    expect(trend.direction).toBe("decreasing")
    expect(trend.recent_avg).toBe(2)
    expect(trend.historical_avg).toBe(10)
  })

  test("returns stable when averages are similar", () => {
    const periods = [
      makePeriod({ period: "2024-04", total_changes: 5 }),
      makePeriod({ period: "2024-03", total_changes: 5 }),
      makePeriod({ period: "2024-02", total_changes: 5 }),
      makePeriod({ period: "2024-01", total_changes: 5 }),
    ]
    const trend = computeTrend(periods)!
    expect(trend.direction).toBe("stable")
  })

  test("handles zero historical avg", () => {
    const periods = [
      makePeriod({ period: "2024-02", total_changes: 5, bug_fix_count: 3 }),
      makePeriod({ period: "2024-01", total_changes: 0, bug_fix_count: 0 }),
    ]
    const trend = computeTrend(periods)!
    expect(trend.direction).toBe("increasing")
    expect(trend.bug_fix_trend).toBe("increasing")
  })

  test("computes bug_fix_trend independently", () => {
    // Recent: high total but low bugs; historical: low total but high bugs
    const periods = [
      makePeriod({
        period: "2024-04",
        total_changes: 10,
        bug_fix_count: 1,
      }),
      makePeriod({
        period: "2024-03",
        total_changes: 10,
        bug_fix_count: 1,
      }),
      makePeriod({
        period: "2024-02",
        total_changes: 3,
        bug_fix_count: 8,
      }),
      makePeriod({
        period: "2024-01",
        total_changes: 3,
        bug_fix_count: 8,
      }),
    ]
    const trend = computeTrend(periods)!
    expect(trend.direction).toBe("increasing")
    expect(trend.bug_fix_trend).toBe("decreasing")
  })

  test("rounds averages to 1 decimal place", () => {
    const periods = [
      makePeriod({ period: "2024-03", total_changes: 7 }),
      makePeriod({ period: "2024-02", total_changes: 4 }),
      makePeriod({ period: "2024-01", total_changes: 3 }),
    ]
    const trend = computeTrend(periods)!
    // recent = [7], historical = [4, 3] => recent_avg = 7, historical_avg = 3.5
    expect(trend.recent_avg).toBe(7)
    expect(trend.historical_avg).toBe(3.5)
  })

  test("uses 3 recent periods when 6 or more available", () => {
    const periods = [
      makePeriod({ period: "2024-06", total_changes: 10 }),
      makePeriod({ period: "2024-05", total_changes: 10 }),
      makePeriod({ period: "2024-04", total_changes: 10 }),
      makePeriod({ period: "2024-03", total_changes: 2 }),
      makePeriod({ period: "2024-02", total_changes: 2 }),
      makePeriod({ period: "2024-01", total_changes: 2 }),
    ]
    const trend = computeTrend(periods)!
    expect(trend.recent_avg).toBe(10)
    expect(trend.historical_avg).toBe(2)
    expect(trend.direction).toBe("increasing")
  })
})
