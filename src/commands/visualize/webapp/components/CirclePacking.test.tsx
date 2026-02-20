/// <reference lib="dom" />
import "../test-setup"
import { describe, test, expect, mock, afterEach } from "bun:test"
import { render, fireEvent, cleanup } from "@testing-library/react"
import { CirclePacking } from "./CirclePacking"
import type { HierarchyResult } from "../types"

afterEach(cleanup)

describe("CirclePacking", () => {
  const hierarchy: HierarchyResult = {
    root: {
      name: "",
      path: "",
      indexed: true,
      children: [
        { name: "a.ts", path: "a.ts", indexed: true, loc: 100, score: 0.5 },
        { name: "b.ts", path: "b.ts", indexed: true, loc: 200, score: 0.8 },
        {
          name: "src",
          path: "src/",
          indexed: true,
          children: [
            {
              name: "c.ts",
              path: "src/c.ts",
              indexed: false,
              loc: 50,
              score: 0,
            },
          ],
        },
      ],
    },
    totalTracked: 3,
    totalIndexed: 2,
    unindexedCount: 1,
  }

  test("renders SVG with circles for all nodes", () => {
    const onSelect = mock(() => {})
    const onFocusChange = mock(() => {})
    const { container } = render(
      <CirclePacking
        hierarchy={hierarchy}
        onSelect={onSelect}
        selectedPath={null}
        focusPath=""
        onFocusChange={onFocusChange}
      />,
    )
    const circles = container.querySelectorAll("circle")
    // root + src/ + a.ts + b.ts + src/c.ts = 5 nodes
    expect(circles.length).toBe(5)
  })

  test("renders text labels for leaf nodes", () => {
    const onSelect = mock(() => {})
    const onFocusChange = mock(() => {})
    const { container } = render(
      <CirclePacking
        hierarchy={hierarchy}
        onSelect={onSelect}
        selectedPath={null}
        focusPath=""
        onFocusChange={onFocusChange}
      />,
    )
    const texts = container.querySelectorAll("text")
    // 3 leaf nodes: a.ts, b.ts, src/c.ts
    expect(texts.length).toBe(3)
  })

  test("renders tooltip container", () => {
    const onSelect = mock(() => {})
    const onFocusChange = mock(() => {})
    const { container } = render(
      <CirclePacking
        hierarchy={hierarchy}
        onSelect={onSelect}
        selectedPath={null}
        focusPath=""
        onFocusChange={onFocusChange}
      />,
    )
    expect(container.querySelector(".tooltip")).toBeTruthy()
  })

  test("calls onSelect when root circle is clicked at root focus", () => {
    const onSelect = mock(() => {})
    const onFocusChange = mock(() => {})
    const { container } = render(
      <CirclePacking
        hierarchy={hierarchy}
        onSelect={onSelect}
        selectedPath={null}
        focusPath=""
        onFocusChange={onFocusChange}
      />,
    )
    // First circle in the DOM is the root node (d3 descendants() starts with root)
    const circles = container.querySelectorAll("circle")
    fireEvent.click(circles[0])
    expect(onSelect).toHaveBeenCalledWith("")
  })

  test("zooms into directory on click", () => {
    const onSelect = mock(() => {})
    const onFocusChange = mock(() => {})
    const { getByTestId } = render(
      <CirclePacking
        hierarchy={hierarchy}
        onSelect={onSelect}
        selectedPath={null}
        focusPath=""
        onFocusChange={onFocusChange}
      />,
    )
    fireEvent.click(getByTestId("circle-src/"))
    expect(onFocusChange).toHaveBeenCalledWith("src/")
    expect(onSelect).toHaveBeenCalledWith("src/")
  })

  test("zooms out when clicking focused directory", () => {
    const onSelect = mock(() => {})
    const onFocusChange = mock(() => {})
    const { getByTestId } = render(
      <CirclePacking
        hierarchy={hierarchy}
        onSelect={onSelect}
        selectedPath={null}
        focusPath="src/"
        onFocusChange={onFocusChange}
      />,
    )
    fireEvent.click(getByTestId("circle-src/"))
    expect(onFocusChange).toHaveBeenCalledWith("")
    expect(onSelect).toHaveBeenCalledWith("")
  })

  test("zooms out on SVG background click when not at root", () => {
    const onSelect = mock(() => {})
    const onFocusChange = mock(() => {})
    const { container } = render(
      <CirclePacking
        hierarchy={hierarchy}
        onSelect={onSelect}
        selectedPath={null}
        focusPath="src/"
        onFocusChange={onFocusChange}
      />,
    )
    const svg = container.querySelector("svg")!
    fireEvent.click(svg)
    expect(onFocusChange).toHaveBeenCalledWith("")
    expect(onSelect).toHaveBeenCalledWith("")
  })

  test("shows tooltip on mouse enter and hides on mouse leave", () => {
    const onSelect = mock(() => {})
    const onFocusChange = mock(() => {})
    const { getByTestId, container } = render(
      <CirclePacking
        hierarchy={hierarchy}
        onSelect={onSelect}
        selectedPath={null}
        focusPath=""
        onFocusChange={onFocusChange}
      />,
    )

    const circle = getByTestId("circle-a.ts")
    fireEvent.mouseEnter(circle, { clientX: 100, clientY: 100 })
    expect(container.querySelector(".tooltip.visible")).toBeTruthy()

    fireEvent.mouseMove(circle, { clientX: 150, clientY: 150 })

    fireEvent.mouseLeave(circle)
    expect(container.querySelector(".tooltip.visible")).toBeNull()
  })
})
