import { describe, test, expect } from "bun:test"
import React from "react"
import { render } from "ink-testing-library"
import { QueryCommand } from "@commands/query-command"
import type { SearchResult, FileStatsRow } from "@/types"

describe("QueryCommand", () => {
  const mockResults: SearchResult[] = [
    {
      hash: "abc1234567890",
      message: "fix auth bug",
      classification: "bug-fix",
      summary: "Fixed authentication bypass vulnerability",
      rank: -1.5,
    },
    {
      hash: "def4567890123",
      message: "add login page",
      classification: "feature",
      summary: "Added new login page with OAuth support",
      rank: -1.2,
    },
  ]

  const mockHotspots: FileStatsRow[] = [
    {
      file_path: "src/auth.ts",
      total_changes: 42,
      bug_fix_count: 12,
      feature_count: 15,
      refactor_count: 5,
      docs_count: 2,
      chore_count: 3,
      perf_count: 1,
      test_count: 3,
      style_count: 1,
      first_seen: "2023-01-01",
      last_changed: "2024-06-01",
      total_additions: 1000,
      total_deletions: 500,
    },
  ]

  test("displays search results", () => {
    const { lastFrame } = render(
      <QueryCommand
        query="auth"
        results={mockResults}
        hotspots={mockHotspots}
        coveragePct={100}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("Query: auth")
    expect(output).toContain("abc1234")
    expect(output).toContain("bug-fix")
    expect(output).toContain("Fixed authentication bypass vulnerability")
    expect(output).toContain("def4567")
    expect(output).toContain("feature")
  })

  test("shows coverage warning when incomplete", () => {
    const { lastFrame } = render(
      <QueryCommand
        query="auth"
        results={mockResults}
        hotspots={[]}
        coveragePct={45}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("Warning")
    expect(output).toContain("45%")
  })

  test("no warning at 100% coverage", () => {
    const { lastFrame } = render(
      <QueryCommand
        query="auth"
        results={mockResults}
        hotspots={[]}
        coveragePct={100}
      />,
    )
    const output = lastFrame()

    expect(output).not.toContain("Warning")
  })

  test("shows no results message", () => {
    const { lastFrame } = render(
      <QueryCommand
        query="nonexistent"
        results={[]}
        hotspots={[]}
        coveragePct={100}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("No matching commits found")
  })

  test("shows hotspots", () => {
    const { lastFrame } = render(
      <QueryCommand
        query="auth"
        results={mockResults}
        hotspots={mockHotspots}
        coveragePct={100}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("Top hotspots")
    expect(output).toContain("src/auth.ts")
    expect(output).toContain("42 changes")
    expect(output).toContain("12 bug fixes")
  })
})
