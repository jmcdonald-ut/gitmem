import { describe, expect, test } from "bun:test"

import { buildHierarchy } from "@commands/visualize/hierarchy"
import type { FileStatsRow } from "@db/types"

function makeStats(
  filePath: string,
  overrides: Partial<FileStatsRow> = {},
): FileStatsRow {
  return {
    file_path: filePath,
    total_changes: 5,
    bug_fix_count: 1,
    feature_count: 2,
    refactor_count: 1,
    docs_count: 0,
    chore_count: 1,
    perf_count: 0,
    test_count: 0,
    style_count: 0,
    first_seen: "2025-01-01T00:00:00Z",
    last_changed: "2025-06-01T00:00:00Z",
    total_additions: 100,
    total_deletions: 50,
    current_loc: 200,
    current_complexity: 10,
    avg_complexity: 8,
    max_complexity: 15,
    ...overrides,
  }
}

describe("buildHierarchy", () => {
  test("empty input produces root with no children", () => {
    const result = buildHierarchy([], new Map())
    expect(result.root.children).toEqual([])
    expect(result.totalTracked).toBe(0)
    expect(result.totalIndexed).toBe(0)
    expect(result.unindexedCount).toBe(0)
  })

  test("single file creates correct single-child hierarchy", () => {
    const stats = makeStats("readme.md")
    const result = buildHierarchy(
      ["readme.md"],
      new Map([["readme.md", stats]]),
    )

    expect(result.root.children).toHaveLength(1)
    const leaf = result.root.children![0]
    expect(leaf.name).toBe("readme.md")
    expect(leaf.path).toBe("readme.md")
    expect(leaf.loc).toBe(200)
    expect(leaf.indexed).toBe(true)
    expect(leaf.children).toBeUndefined()
  })

  test("nested paths build correct directory structure", () => {
    const stats = makeStats("src/services/git.ts")
    const result = buildHierarchy(
      ["src/services/git.ts"],
      new Map([["src/services/git.ts", stats]]),
    )

    const src = result.root.children![0]
    expect(src.name).toBe("src")
    expect(src.path).toBe("src/")
    expect(src.children).toHaveLength(1)

    const services = src.children![0]
    expect(services.name).toBe("services")
    expect(services.path).toBe("src/services/")
    expect(services.children).toHaveLength(1)

    const file = services.children![0]
    expect(file.name).toBe("git.ts")
    expect(file.path).toBe("src/services/git.ts")
  })

  test("combined score normalization: max changes and max complexity gets score 1.0", () => {
    const stats = makeStats("hot.ts", {
      total_changes: 100,
      current_complexity: 50,
    })
    const result = buildHierarchy(["hot.ts"], new Map([["hot.ts", stats]]))

    const leaf = result.root.children![0]
    // Only one file, so it's both the max changes and max complexity => score = 1.0
    expect(leaf.score).toBe(1)
  })

  test("files with no stats get indexed: false, score: 0, loc: 1", () => {
    const result = buildHierarchy(["unknown.ts"], new Map())

    const leaf = result.root.children![0]
    expect(leaf.indexed).toBe(false)
    expect(leaf.score).toBe(0)
    expect(leaf.loc).toBe(1)
  })

  test("mixed indexed/unindexed files", () => {
    const stats = makeStats("a.ts", {
      total_changes: 10,
      current_complexity: 20,
    })
    const result = buildHierarchy(["a.ts", "b.ts"], new Map([["a.ts", stats]]))

    const a = result.root.children!.find((c) => c.name === "a.ts")!
    const b = result.root.children!.find((c) => c.name === "b.ts")!
    expect(a.indexed).toBe(true)
    expect(a.score).toBe(1)
    expect(b.indexed).toBe(false)
    expect(b.score).toBe(0)
  })

  test("counts are correct", () => {
    const stats = makeStats("a.ts")
    const result = buildHierarchy(
      ["a.ts", "b.ts", "c.ts"],
      new Map([["a.ts", stats]]),
    )

    expect(result.totalTracked).toBe(3)
    expect(result.totalIndexed).toBe(1)
    expect(result.unindexedCount).toBe(2)
  })

  test("directory nodes are marked indexed when any child is indexed", () => {
    const stats = makeStats("src/a.ts")
    const result = buildHierarchy(
      ["src/a.ts", "src/b.ts"],
      new Map([["src/a.ts", stats]]),
    )

    const src = result.root.children![0]
    expect(src.indexed).toBe(true)
    expect(src.children).toHaveLength(2)
  })

  test("directory nodes are not indexed when no children are indexed", () => {
    const result = buildHierarchy(["src/a.ts"], new Map())

    const src = result.root.children![0]
    expect(src.indexed).toBe(false)
  })

  test("files with null complexity get score 0", () => {
    const s1 = makeStats("a.ts", {
      total_changes: 10,
      current_complexity: null,
    })
    const s2 = makeStats("b.ts", {
      total_changes: 10,
      current_complexity: 20,
    })
    const result = buildHierarchy(
      ["a.ts", "b.ts"],
      new Map([
        ["a.ts", s1],
        ["b.ts", s2],
      ]),
    )

    const a = result.root.children!.find((c) => c.name === "a.ts")!
    const b = result.root.children!.find((c) => c.name === "b.ts")!
    expect(a.score).toBe(0)
    expect(b.score).toBe(1) // max of both changes and complexity
  })

  test("multiple files in same directory share the directory node", () => {
    const result = buildHierarchy(
      ["src/a.ts", "src/b.ts", "src/c.ts"],
      new Map(),
    )

    expect(result.root.children).toHaveLength(1)
    const src = result.root.children![0]
    expect(src.children).toHaveLength(3)
  })
})
