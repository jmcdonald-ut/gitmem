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
})
