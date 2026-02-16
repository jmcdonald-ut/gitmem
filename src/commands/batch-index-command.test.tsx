import { describe, test, expect, mock } from "bun:test"
import React from "react"
import { render } from "ink-testing-library"
import {
  BatchIndexCommand,
  batchPhaseLabel,
} from "@commands/batch-index-command"
import type { EnricherService } from "@services/enricher"
import type { BatchLLMService } from "@services/batch-llm"
import type { BatchJobRepository } from "@db/batch-jobs"
import type { IndexProgress } from "@/types"

function createMockEnricher(
  behavior: "submitted" | "in_progress" | "complete" | "error",
): EnricherService {
  return {
    runBatch: mock(
      async (
        _batchLLM: BatchLLMService,
        _batchJobs: BatchJobRepository,
        onProgress: (p: IndexProgress) => void,
      ) => {
        if (behavior === "error") {
          throw new Error("Batch API failed")
        }
        onProgress({ phase: "discovering", current: 0, total: 0 })

        if (behavior === "submitted") {
          onProgress({
            phase: "enriching",
            current: 0,
            total: 50,
            batchStatus: "submitted",
            batchId: "msgbatch_test",
          })
          return {
            enrichedThisRun: 0,
            totalEnriched: 0,
            totalCommits: 50,
            batchId: "msgbatch_test",
            batchStatus: "submitted",
          }
        }

        if (behavior === "in_progress") {
          return {
            enrichedThisRun: 0,
            totalEnriched: 10,
            totalCommits: 50,
            batchId: "msgbatch_poll",
            batchStatus: "in_progress",
          }
        }

        // complete
        onProgress({ phase: "aggregating", current: 0, total: 0 })
        onProgress({ phase: "indexing", current: 0, total: 0 })
        onProgress({ phase: "done", current: 50, total: 50 })
        return {
          enrichedThisRun: 50,
          totalEnriched: 50,
          totalCommits: 50,
        }
      },
    ),
  } as unknown as EnricherService
}

const mockBatchLLM = {} as BatchLLMService
const mockBatchJobs = {} as BatchJobRepository

describe("BatchIndexCommand", () => {
  test("shows submitted message", async () => {
    const enricher = createMockEnricher("submitted")
    const { lastFrame } = render(
      <BatchIndexCommand
        enricher={enricher}
        batchLLM={mockBatchLLM}
        batchJobs={mockBatchJobs}
      />,
    )

    await new Promise((r) => setTimeout(r, 50))

    const output = lastFrame()
    expect(output).toContain("Batch submitted!")
    expect(output).toContain("msgbatch_test")
  })

  test("shows in-progress message", async () => {
    const enricher = createMockEnricher("in_progress")
    const { lastFrame } = render(
      <BatchIndexCommand
        enricher={enricher}
        batchLLM={mockBatchLLM}
        batchJobs={mockBatchJobs}
      />,
    )

    await new Promise((r) => setTimeout(r, 50))

    const output = lastFrame()
    expect(output).toContain("Batch in progress")
    expect(output).toContain("msgbatch_poll")
  })

  test("shows completion message", async () => {
    const enricher = createMockEnricher("complete")
    const { lastFrame } = render(
      <BatchIndexCommand
        enricher={enricher}
        batchLLM={mockBatchLLM}
        batchJobs={mockBatchJobs}
      />,
    )

    await new Promise((r) => setTimeout(r, 50))

    const output = lastFrame()
    expect(output).toContain("Indexing complete!")
    expect(output).toContain("Enriched this run: 50")
    expect(output).toContain("100%")
  })

  test("shows error message", async () => {
    const enricher = createMockEnricher("error")
    const { lastFrame } = render(
      <BatchIndexCommand
        enricher={enricher}
        batchLLM={mockBatchLLM}
        batchJobs={mockBatchJobs}
      />,
    )

    await new Promise((r) => setTimeout(r, 50))

    const output = lastFrame()
    expect(output).toContain("Error:")
    expect(output).toContain("Batch API failed")
  })
})

describe("batchPhaseLabel", () => {
  test("returns submitting label", () => {
    expect(
      batchPhaseLabel({
        phase: "enriching",
        current: 0,
        total: 100,
        batchStatus: "submitting",
      }),
    ).toBe("Submitting batch (100 commits)...")
  })

  test("returns importing label", () => {
    expect(
      batchPhaseLabel({
        phase: "enriching",
        current: 0,
        total: 50,
        batchStatus: "importing",
      }),
    ).toBe("Importing 50 results...")
  })

  test("returns batch progress label", () => {
    expect(
      batchPhaseLabel({
        phase: "enriching",
        current: 10,
        total: 50,
        batchId: "msgbatch_001",
        batchStatus: "in_progress",
      }),
    ).toContain("msgbatch_001")
  })

  test("returns enriching label without batch info", () => {
    expect(batchPhaseLabel({ phase: "enriching", current: 1, total: 10 })).toBe(
      "Enriching commits...",
    )
  })

  test("returns standard labels for non-batch phases", () => {
    expect(
      batchPhaseLabel({ phase: "discovering", current: 0, total: 0 }),
    ).toBe("Discovering commits...")
    expect(
      batchPhaseLabel({ phase: "aggregating", current: 0, total: 0 }),
    ).toBe("Rebuilding aggregates...")
    expect(batchPhaseLabel({ phase: "indexing", current: 0, total: 0 })).toBe(
      "Rebuilding search index...",
    )
    expect(batchPhaseLabel({ phase: "done", current: 0, total: 0 })).toBe(
      "Done",
    )
  })
})
