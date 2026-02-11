import { describe, test, expect, mock } from "bun:test"
import React from "react"
import { render } from "ink-testing-library"
import { IndexCommand, phaseLabel } from "@commands/index-command"
import type { EnricherService } from "@services/enricher"
import type { IndexProgress } from "@/types"

function createMockEnricher(
  behavior: "success" | "error" | "empty" = "success",
): EnricherService {
  return {
    run: mock(async (onProgress: (p: IndexProgress) => void) => {
      if (behavior === "error") {
        throw new Error("LLM API failed")
      }
      onProgress({ phase: "discovering", current: 0, total: 0 })
      if (behavior === "empty") {
        onProgress({ phase: "done", current: 0, total: 0 })
        return { enrichedThisRun: 0, totalEnriched: 0, totalCommits: 0 }
      }
      onProgress({
        phase: "enriching",
        current: 1,
        total: 5,
        currentHash: "abc1234def",
      })
      onProgress({ phase: "aggregating", current: 0, total: 0 })
      onProgress({ phase: "indexing", current: 0, total: 0 })
      onProgress({ phase: "done", current: 5, total: 10 })
      return { enrichedThisRun: 5, totalEnriched: 5, totalCommits: 10 }
    }),
  } as unknown as EnricherService
}

describe("IndexCommand", () => {
  test("shows completion message", async () => {
    const enricher = createMockEnricher("success")
    const { lastFrame } = render(<IndexCommand enricher={enricher} />)

    // Wait for async effect
    await new Promise((r) => setTimeout(r, 50))

    const output = lastFrame()
    expect(output).toContain("Indexing complete!")
    expect(output).toContain("Enriched this run: 5")
    expect(output).toContain("50%")
  })

  test("shows error message", async () => {
    const enricher = createMockEnricher("error")
    const { lastFrame } = render(<IndexCommand enricher={enricher} />)

    await new Promise((r) => setTimeout(r, 50))

    const output = lastFrame()
    expect(output).toContain("Error:")
    expect(output).toContain("LLM API failed")
  })

  test("shows zero results for empty repo", async () => {
    const enricher = createMockEnricher("empty")
    const { lastFrame } = render(<IndexCommand enricher={enricher} />)

    await new Promise((r) => setTimeout(r, 50))

    const output = lastFrame()
    expect(output).toContain("Enriched this run: 0")
    expect(output).toContain("0%")
  })

  test("cleanup aborts on unmount", async () => {
    let resolveRun: () => void
    const enricher = {
      run: mock(
        () =>
          new Promise<{
            enrichedThisRun: number
            totalEnriched: number
            totalCommits: number
          }>((resolve) => {
            resolveRun = () =>
              resolve({ enrichedThisRun: 0, totalEnriched: 0, totalCommits: 0 })
          }),
      ),
    } as unknown as EnricherService

    const { unmount } = render(<IndexCommand enricher={enricher} />)
    // Unmount while still running triggers useEffect cleanup
    unmount()
    // Resolve to avoid unhandled promise
    resolveRun!()
  })
})

describe("phaseLabel", () => {
  test("returns correct labels for all phases", () => {
    expect(phaseLabel({ phase: "discovering", current: 0, total: 0 })).toBe(
      "Discovering commits...",
    )
    expect(phaseLabel({ phase: "enriching", current: 1, total: 5 })).toBe(
      "Enriching commits...",
    )
    expect(phaseLabel({ phase: "aggregating", current: 0, total: 0 })).toBe(
      "Rebuilding aggregates...",
    )
    expect(phaseLabel({ phase: "indexing", current: 0, total: 0 })).toBe(
      "Rebuilding search index...",
    )
    expect(phaseLabel({ phase: "done", current: 5, total: 5 })).toBe("Done")
  })
})
