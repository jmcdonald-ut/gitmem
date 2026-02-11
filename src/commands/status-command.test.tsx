import { describe, test, expect } from "bun:test"
import React from "react"
import { render } from "ink-testing-library"
import { StatusCommand } from "@commands/status-command"
import type { StatusInfo } from "@/types"

describe("StatusCommand", () => {
  test("displays full status info", () => {
    const status: StatusInfo = {
      totalCommits: 1000,
      indexedCommits: 500,
      enrichedCommits: 300,
      lastRun: "2024-06-01T12:00:00Z",
      modelUsed: "claude-haiku-4-5-20251001",
      dbPath: "/path/to/.gitmem/index.db",
      dbSize: 1024 * 512,
    }

    const { lastFrame } = render(<StatusCommand status={status} />)
    const output = lastFrame()

    expect(output).toContain("gitmem status")
    expect(output).toContain("500")
    expect(output).toContain("1,000")
    expect(output).toContain("300")
    expect(output).toContain("2024-06-01T12:00:00Z")
    expect(output).toContain("claude-haiku-4-5-20251001")
    expect(output).toContain("512.0 KB")
  })

  test("displays never when no last run", () => {
    const status: StatusInfo = {
      totalCommits: 0,
      indexedCommits: 0,
      enrichedCommits: 0,
      lastRun: null,
      modelUsed: null,
      dbPath: "/path/to/db",
      dbSize: 100,
    }

    const { lastFrame } = render(<StatusCommand status={status} />)
    const output = lastFrame()

    expect(output).toContain("never")
    expect(output).toContain("none")
    expect(output).toContain("100 B")
  })

  test("displays MB for large databases", () => {
    const status: StatusInfo = {
      totalCommits: 100,
      indexedCommits: 100,
      enrichedCommits: 100,
      lastRun: "2024-01-01",
      modelUsed: "haiku",
      dbPath: "/db",
      dbSize: 2 * 1024 * 1024,
    }

    const { lastFrame } = render(<StatusCommand status={status} />)
    expect(lastFrame()).toContain("2.0 MB")
  })
})
