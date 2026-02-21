/// <reference lib="dom" />
import "@visualize-app/test-setup"
import { describe, test, expect, afterEach } from "bun:test"
import { render, cleanup } from "@testing-library/react"
import { StatGrid } from "@visualize-app/components/StatGrid"

afterEach(cleanup)

describe("StatGrid", () => {
  test("renders stat items with correct values and labels", () => {
    const { getByText } = render(
      <StatGrid
        items={[
          { value: "42", label: "Commits" },
          { value: "100%", label: "Coverage" },
        ]}
      />,
    )

    expect(getByText("42")).toBeTruthy()
    expect(getByText("Commits")).toBeTruthy()
    expect(getByText("100%")).toBeTruthy()
    expect(getByText("Coverage")).toBeTruthy()
  })

  test("renders empty grid when no items", () => {
    const { container } = render(<StatGrid items={[]} />)
    const grid = container.querySelector(".stat-grid")
    expect(grid).toBeTruthy()
    expect(grid!.children.length).toBe(0)
  })
})
