import { describe, test, expect } from "bun:test"
import React from "react"
import { render } from "ink-testing-library"
import { StatsCommand } from "@commands/stats-command"
import type { FileStatsRow, FileContributorRow, RecentCommit } from "@/types"

const makeStats = (overrides: Partial<FileStatsRow> = {}): FileStatsRow => ({
  file_path: "src/main.ts",
  total_changes: 10,
  bug_fix_count: 3,
  feature_count: 5,
  refactor_count: 2,
  docs_count: 0,
  chore_count: 0,
  perf_count: 0,
  test_count: 0,
  style_count: 0,
  first_seen: "2024-01-01T00:00:00Z",
  last_changed: "2024-06-01T00:00:00Z",
  total_additions: 500,
  total_deletions: 100,
  ...overrides,
})

const makeContributor = (
  overrides: Partial<FileContributorRow> = {},
): FileContributorRow => ({
  file_path: "src/main.ts",
  author_name: "Alice",
  author_email: "alice@example.com",
  commit_count: 5,
  ...overrides,
})

const makeRecentCommit = (
  overrides: Partial<RecentCommit> = {},
): RecentCommit => ({
  hash: "abc1234def5678",
  classification: "bug-fix",
  summary: "Fix null check in handler",
  committed_at: "2024-06-01T00:00:00Z",
  ...overrides,
})

describe("StatsCommand", () => {
  test("renders file stats with path and type", () => {
    const { lastFrame } = render(
      <StatsCommand
        path="src/main.ts"
        type="file"
        stats={makeStats()}
        contributors={[makeContributor()]}
        recentCommits={[]}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("src/main.ts")
    expect(output).toContain("(file)")
    expect(output).toContain("10")
    expect(output).toContain("+500")
    expect(output).toContain("-100")
  })

  test("renders date range", () => {
    const { lastFrame } = render(
      <StatsCommand
        path="src/main.ts"
        type="file"
        stats={makeStats()}
        contributors={[]}
        recentCommits={[]}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("2024-01-01")
    expect(output).toContain("2024-06-01")
  })

  test("renders classification breakdown", () => {
    const { lastFrame } = render(
      <StatsCommand
        path="src/main.ts"
        type="file"
        stats={makeStats({
          bug_fix_count: 3,
          feature_count: 5,
          refactor_count: 2,
        })}
        contributors={[]}
        recentCommits={[]}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("Classification breakdown:")
    expect(output).toContain("feature: 5")
    expect(output).toContain("bug-fix: 3")
    expect(output).toContain("refactor: 2")
  })

  test("renders contributors", () => {
    const { lastFrame } = render(
      <StatsCommand
        path="src/main.ts"
        type="file"
        stats={makeStats()}
        contributors={[
          makeContributor({ author_name: "Alice", commit_count: 5 }),
          makeContributor({
            author_name: "Bob",
            author_email: "bob@example.com",
            commit_count: 3,
          }),
        ]}
        recentCommits={[]}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("Contributors:")
    expect(output).toContain("Alice (5)")
    expect(output).toContain("Bob (3)")
  })

  test("renders recent commits for file", () => {
    const { lastFrame } = render(
      <StatsCommand
        path="src/main.ts"
        type="file"
        stats={makeStats()}
        contributors={[]}
        recentCommits={[
          makeRecentCommit({
            hash: "abc1234def5678",
            classification: "bug-fix",
            summary: "Fix null check",
          }),
          makeRecentCommit({
            hash: "def5678abc1234",
            classification: "feature",
            summary: "Add login page",
          }),
        ]}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("Recent commits:")
    expect(output).toContain("abc1234")
    expect(output).toContain("[bug-fix]")
    expect(output).toContain("Fix null check")
    expect(output).toContain("def5678")
    expect(output).toContain("[feature]")
    expect(output).toContain("Add login page")
  })

  test("renders directory stats with file count", () => {
    const { lastFrame } = render(
      <StatsCommand
        path="src/services/"
        type="directory"
        fileCount={5}
        stats={makeStats({ total_changes: 42 })}
        contributors={[makeContributor()]}
        topFiles={[]}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("src/services/")
    expect(output).toContain("(directory, 5 files)")
    expect(output).toContain("42")
  })

  test("renders top files for directory", () => {
    const { lastFrame } = render(
      <StatsCommand
        path="src/services/"
        type="directory"
        fileCount={2}
        stats={makeStats()}
        contributors={[]}
        topFiles={[
          makeStats({ file_path: "src/services/git.ts", total_changes: 28 }),
          makeStats({
            file_path: "src/services/llm.ts",
            total_changes: 15,
          }),
        ]}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("Top files:")
    expect(output).toContain("src/services/git.ts")
    expect(output).toContain("28")
    expect(output).toContain("src/services/llm.ts")
    expect(output).toContain("15")
  })

  test("does not show recent commits for directory", () => {
    const { lastFrame } = render(
      <StatsCommand
        path="src/"
        type="directory"
        fileCount={3}
        stats={makeStats()}
        contributors={[]}
        topFiles={[]}
      />,
    )
    const output = lastFrame()

    expect(output).not.toContain("Recent commits:")
  })

  test("does not show top files for file", () => {
    const { lastFrame } = render(
      <StatsCommand
        path="src/main.ts"
        type="file"
        stats={makeStats()}
        contributors={[]}
        recentCommits={[]}
      />,
    )
    const output = lastFrame()

    expect(output).not.toContain("Top files:")
  })

  test("shows empty state for contributors", () => {
    const { lastFrame } = render(
      <StatsCommand
        path="src/main.ts"
        type="file"
        stats={makeStats()}
        contributors={[]}
        recentCommits={[]}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("No contributors")
  })

  test("shows empty state for recent commits", () => {
    const { lastFrame } = render(
      <StatsCommand
        path="src/main.ts"
        type="file"
        stats={makeStats()}
        contributors={[]}
        recentCommits={[]}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("No recent commits")
  })

  test("shows empty state for top files", () => {
    const { lastFrame } = render(
      <StatsCommand
        path="src/"
        type="directory"
        fileCount={0}
        stats={makeStats()}
        contributors={[]}
        topFiles={[]}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("No files found")
  })
})
