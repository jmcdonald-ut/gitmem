/// <reference lib="dom" />
import "@visualize-app/test-setup"
import { describe, test, expect, afterEach } from "bun:test"
import { render, cleanup } from "@testing-library/react"
import { ClassificationBar } from "@visualize-app/components/ClassificationBar"

afterEach(cleanup)

describe("ClassificationBar", () => {
  test("renders bar segments for non-zero counts", () => {
    const stats = {
      bug_fix_count: 3,
      feature_count: 5,
      refactor_count: 2,
      docs_count: 0,
      chore_count: 0,
      perf_count: 0,
      test_count: 0,
      style_count: 0,
    }
    const { container } = render(<ClassificationBar stats={stats} />)
    const bar = container.querySelector(".class-bar")
    expect(bar).toBeTruthy()
    // Should have 3 segments (bug-fix, feature, refactor)
    expect(bar!.children.length).toBe(3)
  })

  test("renders legend items for non-zero counts", () => {
    const stats = {
      bug_fix_count: 3,
      feature_count: 5,
      refactor_count: 0,
      docs_count: 0,
      chore_count: 0,
      perf_count: 0,
      test_count: 0,
      style_count: 0,
    }
    const { getByText } = render(<ClassificationBar stats={stats} />)
    expect(getByText(/bug-fix 3/)).toBeTruthy()
    expect(getByText(/feature 5/)).toBeTruthy()
  })

  test("returns null when all counts are zero", () => {
    const stats = {
      bug_fix_count: 0,
      feature_count: 0,
      refactor_count: 0,
      docs_count: 0,
      chore_count: 0,
      perf_count: 0,
      test_count: 0,
      style_count: 0,
    }
    const { container } = render(<ClassificationBar stats={stats} />)
    expect(container.querySelector(".class-bar")).toBeNull()
  })
})
