import { describe, test, expect } from "bun:test"
import React from "react"
import { render } from "ink-testing-library"
import { HotspotsCommand } from "@commands/hotspots/HotspotsCommand"
import type { FileStatsRow } from "@/types"

const makeRow = (overrides: Partial<FileStatsRow> = {}): FileStatsRow => ({
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
  current_loc: null,
  current_complexity: null,
  avg_complexity: null,
  max_complexity: null,
  ...overrides,
})

describe("HotspotsCommand", () => {
  test("renders file paths and change counts", () => {
    const hotspots = [
      makeRow({ file_path: "src/main.ts", total_changes: 10 }),
      makeRow({ file_path: "src/utils.ts", total_changes: 5 }),
    ]
    const { lastFrame } = render(
      <HotspotsCommand hotspots={hotspots} sort="total" />,
    )
    const output = lastFrame()

    expect(output).toContain("src/main.ts")
    expect(output).toContain("10")
    expect(output).toContain("src/utils.ts")
    expect(output).toContain("5")
  })

  test("shows classification breakdown tags", () => {
    const hotspots = [
      makeRow({
        bug_fix_count: 4,
        feature_count: 3,
        refactor_count: 2,
        docs_count: 1,
      }),
    ]
    const { lastFrame } = render(
      <HotspotsCommand hotspots={hotspots} sort="total" />,
    )
    const output = lastFrame()

    // Top 3 non-zero tags should appear
    expect(output).toContain("[bug-fix: 4]")
    expect(output).toContain("[feature: 3]")
    expect(output).toContain("[refactor: 2]")
    // 4th classification should not appear (limit 3)
    expect(output).not.toContain("[docs: 1]")
  })

  test("shows empty state message", () => {
    const { lastFrame } = render(<HotspotsCommand hotspots={[]} sort="total" />)
    const output = lastFrame()

    expect(output).toContain("No hotspots found.")
  })

  test("shows sort metadata when non-default", () => {
    const { lastFrame } = render(
      <HotspotsCommand hotspots={[makeRow()]} sort="bug-fix" />,
    )
    const output = lastFrame()

    expect(output).toContain("Sort:")
    expect(output).toContain("bug-fix")
  })

  test("shows path metadata when provided", () => {
    const { lastFrame } = render(
      <HotspotsCommand
        hotspots={[makeRow()]}
        sort="total"
        pathPrefix="src/services/"
      />,
    )
    const output = lastFrame()

    expect(output).toContain("Path:")
    expect(output).toContain("src/services/")
  })

  test("hides metadata when sort is default and no path", () => {
    const { lastFrame } = render(
      <HotspotsCommand hotspots={[makeRow()]} sort="total" />,
    )
    const output = lastFrame()

    expect(output).not.toContain("Sort:")
    expect(output).not.toContain("Path:")
  })
})
