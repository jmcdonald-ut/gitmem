import { describe, test, expect } from "bun:test"
import React from "react"
import { render } from "ink-testing-library"
import { InitCommand } from "@commands/init/InitCommand"
import { DEFAULTS, type GitmemConfig } from "@/config"

describe("InitCommand", () => {
  test("displays initialized header", () => {
    const { lastFrame } = render(<InitCommand config={{ ...DEFAULTS }} />)
    expect(lastFrame()).toContain("Initialized gitmem")
  })

  test("displays default config values", () => {
    const { lastFrame } = render(<InitCommand config={{ ...DEFAULTS }} />)
    const output = lastFrame()

    expect(output).toContain("AI: enabled")
    expect(output).toContain("all history")
    expect(output).toContain(DEFAULTS.indexModel)
    expect(output).toContain(DEFAULTS.checkModel)
  })

  test("displays AI disabled", () => {
    const config: GitmemConfig = { ...DEFAULTS, ai: false }
    const { lastFrame } = render(<InitCommand config={config} />)
    expect(lastFrame()).toContain("AI: disabled")
  })

  test("displays AI date", () => {
    const config: GitmemConfig = { ...DEFAULTS, ai: "2024-06-01" }
    const { lastFrame } = render(<InitCommand config={config} />)
    expect(lastFrame()).toContain("enabled for commits after 2024-06-01")
  })

  test("displays index start date", () => {
    const config: GitmemConfig = { ...DEFAULTS, indexStartDate: "2024-01-01" }
    const { lastFrame } = render(<InitCommand config={config} />)
    expect(lastFrame()).toContain("Index start date: 2024-01-01")
  })

  test("displays next-step guidance", () => {
    const { lastFrame } = render(<InitCommand config={{ ...DEFAULTS }} />)
    expect(lastFrame()).toContain(
      "Run `gitmem index` to analyze your commit history.",
    )
  })
})
