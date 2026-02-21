/// <reference lib="dom" />
import "@visualize-app/test-setup"
import { describe, test, expect, afterEach } from "bun:test"
import { render, cleanup } from "@testing-library/react"
import { TrendIndicator } from "@visualize-app/components/TrendIndicator"
import type { TrendSummary } from "@/types"

afterEach(cleanup)

describe("TrendIndicator", () => {
  const baseTrend: TrendSummary = {
    direction: "increasing",
    recent_avg: 10,
    historical_avg: 5,
    bug_fix_trend: "decreasing",
    complexity_trend: "stable",
  }

  test("renders trend arrows for increasing direction", () => {
    const { getByText } = render(<TrendIndicator trend={baseTrend} />)
    expect(getByText(/Activity: increasing/)).toBeTruthy()
    expect(getByText(/10 vs 5\/period/)).toBeTruthy()
  })

  test("renders bug fix and complexity trends", () => {
    const { getByText } = render(<TrendIndicator trend={baseTrend} />)
    expect(getByText(/Bug fixes: decreasing/)).toBeTruthy()
    expect(getByText(/Complexity: stable/)).toBeTruthy()
  })

  test("returns null when trend is null", () => {
    const { container } = render(<TrendIndicator trend={null} />)
    expect(container.innerHTML).toBe("")
  })

  test("applies correct CSS classes", () => {
    const { container } = render(<TrendIndicator trend={baseTrend} />)
    expect(container.querySelector(".trend-up")).toBeTruthy()
    expect(container.querySelector(".trend-down")).toBeTruthy()
    expect(container.querySelector(".trend-stable")).toBeTruthy()
  })
})
