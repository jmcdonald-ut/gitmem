import { describe, test, expect } from "bun:test"
import React from "react"
import { render } from "ink-testing-library"
import { QueryCommand } from "@commands/query-command"
import type { SearchResult } from "@/types"

describe("QueryCommand", () => {
  const mockResults: SearchResult[] = [
    {
      hash: "abc1234567890",
      message: "fix auth bug",
      classification: "bug-fix",
      summary: "Fixed authentication bypass vulnerability",
      rank: -1.5,
    },
    {
      hash: "def4567890123",
      message: "add login page",
      classification: "feature",
      summary: "Added new login page with OAuth support",
      rank: -1.2,
    },
  ]

  test("displays search results", () => {
    const { lastFrame } = render(
      <QueryCommand query="auth" results={mockResults} coveragePct={100} />,
    )
    const output = lastFrame()

    expect(output).toContain("Query: auth")
    expect(output).toContain("abc1234")
    expect(output).toContain("bug-fix")
    expect(output).toContain("Fixed authentication bypass vulnerability")
    expect(output).toContain("def4567")
    expect(output).toContain("feature")
  })

  test("shows coverage warning when incomplete", () => {
    const { lastFrame } = render(
      <QueryCommand query="auth" results={mockResults} coveragePct={45} />,
    )
    const output = lastFrame()

    expect(output).toContain("Warning")
    expect(output).toContain("45%")
  })

  test("no warning at 100% coverage", () => {
    const { lastFrame } = render(
      <QueryCommand query="auth" results={mockResults} coveragePct={100} />,
    )
    const output = lastFrame()

    expect(output).not.toContain("Warning")
  })

  test("shows no results message", () => {
    const { lastFrame } = render(
      <QueryCommand query="nonexistent" results={[]} coveragePct={100} />,
    )
    const output = lastFrame()

    expect(output).toContain("No matching commits found")
  })
})
