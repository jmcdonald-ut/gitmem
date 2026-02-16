import { describe, test, expect } from "bun:test"
import React from "react"
import { render } from "ink-testing-library"
import { CouplingCommand } from "@commands/coupling-command"
import type { CouplingPairRow, CouplingPairGlobalRow } from "@/types"

describe("CouplingCommand", () => {
  test("renders global mode with file_a and file_b", () => {
    const pairs: CouplingPairGlobalRow[] = [
      { file_a: "src/main.ts", file_b: "src/utils.ts", co_change_count: 15 },
      {
        file_a: "src/db/commits.ts",
        file_b: "src/services/git.ts",
        co_change_count: 8,
      },
    ]
    const { lastFrame } = render(<CouplingCommand path={null} pairs={pairs} />)
    const output = lastFrame()

    expect(output).toContain("src/main.ts")
    expect(output).toContain("src/utils.ts")
    expect(output).toContain("15")
    expect(output).toContain("src/db/commits.ts")
    expect(output).toContain("src/services/git.ts")
    expect(output).toContain("8")
    expect(output).toContain("co-changes")
  })

  test("renders file mode with ratio", () => {
    const pairs: CouplingPairRow[] = [
      { file: "src/utils.ts", co_change_count: 10, coupling_ratio: 0.67 },
      { file: "src/new.ts", co_change_count: 5, coupling_ratio: 0.33 },
    ]
    const { lastFrame } = render(
      <CouplingCommand path="src/main.ts" pairs={pairs} />,
    )
    const output = lastFrame()

    expect(output).toContain("src/utils.ts")
    expect(output).toContain("10")
    expect(output).toContain("67%")
    expect(output).toContain("src/new.ts")
    expect(output).toContain("5")
    expect(output).toContain("33%")
  })

  test("shows empty state message", () => {
    const { lastFrame } = render(<CouplingCommand path={null} pairs={[]} />)
    const output = lastFrame()

    expect(output).toContain("No coupling data found.")
  })

  test("shows path when provided", () => {
    const pairs: CouplingPairRow[] = [
      { file: "src/db/commits.ts", co_change_count: 5, coupling_ratio: 0.25 },
    ]
    const { lastFrame } = render(
      <CouplingCommand path="src/services/" pairs={pairs} />,
    )
    const output = lastFrame()

    expect(output).toContain("Path:")
    expect(output).toContain("src/services/")
  })

  test("does not show path metadata in global mode", () => {
    const pairs: CouplingPairGlobalRow[] = [
      { file_a: "a.ts", file_b: "b.ts", co_change_count: 3 },
    ]
    const { lastFrame } = render(<CouplingCommand path={null} pairs={pairs} />)
    const output = lastFrame()

    expect(output).not.toContain("Path:")
  })

  test("renders empty state with path", () => {
    const { lastFrame } = render(
      <CouplingCommand path="src/main.ts" pairs={[]} />,
    )
    const output = lastFrame()

    expect(output).toContain("Path:")
    expect(output).toContain("src/main.ts")
    expect(output).toContain("No coupling data found.")
  })
})
