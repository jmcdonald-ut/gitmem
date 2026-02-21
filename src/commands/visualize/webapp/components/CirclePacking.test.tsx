/// <reference lib="dom" />
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, mock, test } from "bun:test"
import { hierarchy as d3hierarchy, pack as d3pack } from "d3-hierarchy"

import {
  CirclePacking,
  resolveOverlaps,
} from "@visualize-app/components/CirclePacking"
import "@visualize-app/test-setup"
import type { HierarchyResult } from "@visualize-app/types"
import type { HierarchyNode } from "@visualize-app/types"

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

  test("shows tooltip on mouse over and hides on mouse out", () => {
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
    fireEvent.mouseOver(circle, { clientX: 100, clientY: 100 })
    expect(container.querySelector(".tooltip.visible")).toBeTruthy()

    fireEvent.mouseMove(circle, { clientX: 150, clientY: 150 })

    fireEvent.mouseOut(circle)
    expect(container.querySelector(".tooltip.visible")).toBeNull()
  })
})

describe("resolveOverlaps", () => {
  test("returns empty set when no labels are large enough", () => {
    const h = d3hierarchy<HierarchyNode>({
      name: "",
      path: "",
      indexed: true,
      children: [
        { name: "a.ts", path: "a.ts", indexed: true, loc: 1, score: 0 },
      ],
    })
      .sum((d) => (d.children ? 0 : d.loc || 1))
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    const packed = d3pack<HierarchyNode>().size([100, 100]).padding(3)(h)
    const leaves = packed.descendants().filter((d) => !d.children)

    // k=0.1 makes all circles very small (screenR <= 18)
    const result = resolveOverlaps(leaves, [50, 50, 100], 0.1, 100, 100, null)
    expect(result.size).toBe(0)
  })

  test("keeps non-overlapping labels", () => {
    const h = d3hierarchy<HierarchyNode>({
      name: "",
      path: "",
      indexed: true,
      children: [
        { name: "a.ts", path: "a.ts", indexed: true, loc: 100, score: 0 },
        { name: "b.ts", path: "b.ts", indexed: true, loc: 100, score: 0 },
      ],
    })
      .sum((d) => (d.children ? 0 : d.loc || 1))
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    const packed = d3pack<HierarchyNode>().size([800, 600]).padding(3)(h)
    const leaves = packed.descendants().filter((d) => !d.children)

    // Large k to make circles big enough for labels
    const result = resolveOverlaps(
      leaves,
      [packed.x, packed.y, packed.r * 2],
      10,
      800,
      600,
      null,
    )
    expect(result.size).toBeGreaterThan(0)
  })

  test("prioritizes selected node label", () => {
    const h = d3hierarchy<HierarchyNode>({
      name: "",
      path: "",
      indexed: true,
      children: [
        { name: "a.ts", path: "a.ts", indexed: true, loc: 100, score: 0 },
        { name: "b.ts", path: "b.ts", indexed: true, loc: 100, score: 0 },
      ],
    })
      .sum((d) => (d.children ? 0 : d.loc || 1))
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    const packed = d3pack<HierarchyNode>().size([800, 600]).padding(3)(h)
    const leaves = packed.descendants().filter((d) => !d.children)

    const result = resolveOverlaps(
      leaves,
      [packed.x, packed.y, packed.r * 2],
      10,
      800,
      600,
      "a.ts",
    )
    expect(result.has("a.ts")).toBe(true)
  })
})
