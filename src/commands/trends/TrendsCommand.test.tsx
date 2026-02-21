import { describe, expect, test } from "bun:test"
import { render } from "ink-testing-library"
import React from "react"

import type { AiCoverage } from "@/config"
import type { TrendPeriod, TrendSummary } from "@/types"
import { TrendsCommand } from "@commands/trends/TrendsCommand"

const makePeriod = (overrides: Partial<TrendPeriod> = {}): TrendPeriod => ({
  period: "2025-03",
  total_changes: 5,
  bug_fix_count: 2,
  feature_count: 2,
  refactor_count: 1,
  docs_count: 0,
  chore_count: 0,
  perf_count: 0,
  test_count: 0,
  style_count: 0,
  additions: 120,
  deletions: 45,
  avg_complexity: null,
  max_complexity: null,
  avg_loc: null,
  ...overrides,
})

const makeTrend = (overrides: Partial<TrendSummary> = {}): TrendSummary => ({
  direction: "increasing",
  recent_avg: 4.5,
  historical_avg: 2.1,
  bug_fix_trend: "stable",
  complexity_trend: "stable",
  ...overrides,
})

describe("TrendsCommand", () => {
  test("renders file header with path, type, and window", () => {
    const { lastFrame } = render(
      <TrendsCommand
        path="src/services/enricher.ts"
        type="file"
        window="monthly"
        periods={[makePeriod()]}
        trend={null}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("src/services/enricher.ts")
    expect(output).toContain("(file, monthly)")
  })

  test("renders directory header with type", () => {
    const { lastFrame } = render(
      <TrendsCommand
        path="src/services/"
        type="directory"
        window="weekly"
        periods={[makePeriod()]}
        trend={null}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("src/services/")
    expect(output).toContain("(directory, weekly)")
  })

  test("renders trend summary with direction arrow", () => {
    const { lastFrame } = render(
      <TrendsCommand
        path="src/main.ts"
        type="file"
        window="monthly"
        periods={[makePeriod(), makePeriod({ period: "2025-02" })]}
        trend={makeTrend()}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("Trend:")
    expect(output).toContain("\u2191")
    expect(output).toContain("increasing")
    expect(output).toContain("recent: 4.5 avg")
    expect(output).toContain("historical: 2.1 avg")
  })

  test("renders increasing trend with correct content", () => {
    const { lastFrame } = render(
      <TrendsCommand
        path="src/main.ts"
        type="file"
        window="monthly"
        periods={[makePeriod(), makePeriod({ period: "2025-02" })]}
        trend={makeTrend({ direction: "increasing" })}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("\u2191")
    expect(output).toContain("increasing")
  })

  test("renders decreasing trend with correct content", () => {
    const { lastFrame } = render(
      <TrendsCommand
        path="src/main.ts"
        type="file"
        window="monthly"
        periods={[makePeriod(), makePeriod({ period: "2025-02" })]}
        trend={makeTrend({ direction: "decreasing" })}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("\u2193")
    expect(output).toContain("decreasing")
  })

  test("renders stable trend with correct content", () => {
    const { lastFrame } = render(
      <TrendsCommand
        path="src/main.ts"
        type="file"
        window="monthly"
        periods={[makePeriod(), makePeriod({ period: "2025-02" })]}
        trend={makeTrend({ direction: "stable" })}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("\u2192")
    expect(output).toContain("stable")
  })

  test("renders period rows with change counts", () => {
    const periods = [
      makePeriod({ period: "2025-03", total_changes: 5 }),
      makePeriod({ period: "2025-02", total_changes: 3 }),
    ]
    const { lastFrame } = render(
      <TrendsCommand
        path="src/main.ts"
        type="file"
        window="monthly"
        periods={periods}
        trend={null}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("2025-03")
    expect(output).toContain("5 changes")
    expect(output).toContain("2025-02")
    expect(output).toContain("3 changes")
  })

  test("renders classification breakdown in period rows", () => {
    const { lastFrame } = render(
      <TrendsCommand
        path="src/main.ts"
        type="file"
        window="monthly"
        periods={[
          makePeriod({
            feature_count: 2,
            bug_fix_count: 1,
            refactor_count: 0,
          }),
        ]}
        trend={null}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("feature: 2")
    expect(output).toContain("bug-fix: 1")
    expect(output).not.toContain("refactor:")
  })

  test("renders additions/deletions with colors", () => {
    const { lastFrame } = render(
      <TrendsCommand
        path="src/main.ts"
        type="file"
        window="monthly"
        periods={[makePeriod({ additions: 120, deletions: 45 })]}
        trend={null}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("+120")
    expect(output).toContain("-45")
  })

  test("shows empty state when no periods", () => {
    const { lastFrame } = render(
      <TrendsCommand
        path="src/main.ts"
        type="file"
        window="monthly"
        periods={[]}
        trend={null}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("No trend data found.")
  })

  test("omits trend section when trend is null", () => {
    const { lastFrame } = render(
      <TrendsCommand
        path="src/main.ts"
        type="file"
        window="monthly"
        periods={[makePeriod()]}
        trend={null}
      />,
    )
    const output = lastFrame()

    expect(output).not.toContain("Trend:")
    expect(output).not.toContain("Bug-fix trend:")
  })

  test("renders bug-fix trend label", () => {
    const { lastFrame } = render(
      <TrendsCommand
        path="src/main.ts"
        type="file"
        window="monthly"
        periods={[makePeriod(), makePeriod({ period: "2025-02" })]}
        trend={makeTrend({ bug_fix_trend: "decreasing" })}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("Bug-fix trend:")
    expect(output).toContain("decreasing")
  })

  test("shows disclaimer when AI is disabled", () => {
    const aiCoverage: AiCoverage = { status: "disabled" }
    const { lastFrame } = render(
      <TrendsCommand
        path="src/main.ts"
        type="file"
        window="monthly"
        periods={[makePeriod()]}
        trend={null}
        aiCoverage={aiCoverage}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("AI enrichment is disabled")
    expect(output).toContain("Classification data is not available")
  })

  test("shows disclaimer when AI coverage is partial", () => {
    const aiCoverage: AiCoverage = {
      status: "partial",
      enriched: 75,
      total: 200,
      aiConfig: "2024-06-01",
    }
    const { lastFrame } = render(
      <TrendsCommand
        path="src/main.ts"
        type="file"
        window="monthly"
        periods={[makePeriod()]}
        trend={null}
        aiCoverage={aiCoverage}
      />,
    )
    const output = lastFrame()

    expect(output).toContain("AI classifications reflect 75 of 200")
    expect(output).toContain("38%")
  })

  test("shows no disclaimer when AI coverage is full", () => {
    const aiCoverage: AiCoverage = { status: "full" }
    const { lastFrame } = render(
      <TrendsCommand
        path="src/main.ts"
        type="file"
        window="monthly"
        periods={[makePeriod()]}
        trend={null}
        aiCoverage={aiCoverage}
      />,
    )
    const output = lastFrame()

    expect(output).not.toContain("AI enrichment is disabled")
    expect(output).not.toContain("AI classifications reflect")
  })
})
