import { describe, test, expect, beforeEach } from "bun:test"
import { createDatabase } from "@db/database"
import { CommitRepository } from "@db/commits"
import { AggregateRepository } from "@db/aggregates"
import { AggregatorService } from "@services/aggregator"
import type { CommitInfo } from "@/types"
import { Database } from "bun:sqlite"

describe("AggregatorService", () => {
  let db: Database
  let commits: CommitRepository
  let aggregates: AggregateRepository
  let aggregator: AggregatorService

  beforeEach(() => {
    db = createDatabase(":memory:")
    commits = new CommitRepository(db)
    aggregates = new AggregateRepository(db)
    aggregator = new AggregatorService(aggregates)
  })

  const seedCommits = () => {
    const data: CommitInfo[] = [
      {
        hash: "aaa",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "initial",
        files: [
          {
            filePath: "src/app.ts",
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
            filePath: "src/app.ts",
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
            filePath: "src/app.ts",
            changeType: "M",
            additions: 20,
            deletions: 5,
          },
        ],
      },
    ]
    commits.insertRawCommits(data)
    commits.updateEnrichment("aaa", "feature", "Initial setup", "haiku-4.5")
    commits.updateEnrichment("bbb", "bug-fix", "Fixed bug", "haiku-4.5")
    commits.updateEnrichment("ccc", "feature", "New feature", "haiku-4.5")
  }

  test("rebuild computes file stats", () => {
    seedCommits()
    aggregator.rebuild()

    const stats = aggregates.getFileStats("src/app.ts")
    expect(stats).not.toBeNull()
    expect(stats!.total_changes).toBe(3)
    expect(stats!.bug_fix_count).toBe(1)
    expect(stats!.feature_count).toBe(2)
  })

  test("rebuild computes contributors", () => {
    seedCommits()
    aggregator.rebuild()

    const contributors = aggregates.getTopContributors("src/app.ts")
    expect(contributors).toHaveLength(2)
    expect(contributors[0].author_name).toBe("Alice")
    expect(contributors[0].commit_count).toBe(2)
  })

  test("rebuild computes coupling", () => {
    seedCommits()
    aggregator.rebuild()

    const coupled = aggregates.getCoupledFiles("src/app.ts")
    const pair = coupled.find(
      (c) =>
        (c.file_a === "src/app.ts" && c.file_b === "src/utils.ts") ||
        (c.file_a === "src/utils.ts" && c.file_b === "src/app.ts"),
    )
    expect(pair).toBeDefined()
    expect(pair!.co_change_count).toBe(2)
  })

  test("rebuild with no enriched commits produces empty stats", () => {
    commits.insertRawCommits([
      {
        hash: "xyz",
        authorName: "Test",
        authorEmail: "test@example.com",
        committedAt: "2024-01-01T00:00:00Z",
        message: "test",
        files: [
          { filePath: "foo.ts", changeType: "A", additions: 10, deletions: 0 },
        ],
      },
    ])
    aggregator.rebuild()

    const hotspots = aggregates.getHotspots(10)
    expect(hotspots).toHaveLength(0)
  })

  test("rebuild is idempotent", () => {
    seedCommits()
    aggregator.rebuild()
    aggregator.rebuild()

    const hotspots = aggregates.getHotspots(10)
    expect(hotspots.length).toBe(2)
    expect(hotspots[0].file_path).toBe("src/app.ts")
  })

  test("single-commit file has correct stats", () => {
    commits.insertRawCommits([
      {
        hash: "solo",
        authorName: "Solo",
        authorEmail: "solo@example.com",
        committedAt: "2024-06-01T00:00:00Z",
        message: "one-off",
        files: [
          {
            filePath: "lonely.ts",
            changeType: "A",
            additions: 5,
            deletions: 0,
          },
        ],
      },
    ])
    commits.updateEnrichment("solo", "chore", "One-off", "haiku-4.5")
    aggregator.rebuild()

    const stats = aggregates.getFileStats("lonely.ts")
    expect(stats!.total_changes).toBe(1)
    expect(stats!.chore_count).toBe(1)
    expect(stats!.first_seen).toBe("2024-06-01T00:00:00Z")
    expect(stats!.last_changed).toBe("2024-06-01T00:00:00Z")
  })
})
