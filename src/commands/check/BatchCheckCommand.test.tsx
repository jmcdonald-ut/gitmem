import { describe, expect, mock, test } from "bun:test"
import { render } from "ink-testing-library"
import React from "react"

import type { CheckBatchResult, CheckProgress } from "@/types"
import {
  BatchCheckCommand,
  batchCheckPhaseLabel,
} from "@commands/check/BatchCheckCommand"
import { waitForFrame } from "@commands/utils/test-utils"
import type { BatchJobRepository } from "@db/batch-jobs"
import type { BatchJudgeService } from "@services/batch-judge"
import type { CheckerService } from "@services/checker"

function createMockChecker(
  behavior: "submitted" | "in_progress" | "complete" | "empty" | "error",
): CheckerService {
  return {
    checkSampleBatch: mock(
      async (
        _batchJudge: BatchJudgeService,
        _batchJobs: BatchJobRepository,
        _sampleSize: number,
        outputPath: string,
        onProgress: (p: CheckProgress) => void,
      ): Promise<CheckBatchResult> => {
        if (behavior === "error") {
          throw new Error("Batch API failed")
        }

        if (behavior === "submitted") {
          onProgress({
            phase: "submitting",
            current: 0,
            total: 20,
            batchStatus: "submitting",
          })
          return {
            kind: "submitted",
            batchId: "msgbatch_check_test",
          }
        }

        if (behavior === "in_progress") {
          onProgress({
            phase: "evaluating",
            current: 5,
            total: 20,
            batchId: "msgbatch_check_poll",
            batchStatus: "in_progress",
          })
          return {
            kind: "in_progress",
            batchId: "msgbatch_check_poll",
            batchStatus: "in_progress",
          }
        }

        if (behavior === "empty") {
          onProgress({ phase: "done", current: 0, total: 0 })
          return {
            kind: "empty",
            results: [],
            summary: {
              total: 0,
              classificationCorrect: 0,
              summaryAccurate: 0,
              summaryComplete: 0,
            },
          }
        }

        // complete
        onProgress({
          phase: "importing",
          current: 0,
          total: 5,
          batchId: "msgbatch_check_done",
          batchStatus: "importing",
        })
        onProgress({ phase: "done", current: 5, total: 5 })
        return {
          kind: "complete",
          results: Array.from({ length: 5 }, (_, i) => ({
            hash: `hash${i}`,
            classification: "feature",
            summary: `summary ${i}`,
            classificationVerdict: { pass: true, reasoning: "OK" },
            accuracyVerdict: { pass: i < 4, reasoning: "OK" },
            completenessVerdict: { pass: true, reasoning: "OK" },
          })),
          summary: {
            total: 5,
            classificationCorrect: 5,
            summaryAccurate: 4,
            summaryComplete: 5,
          },
          outputPath,
        }
      },
    ),
  } as unknown as CheckerService
}

const mockBatchJudge = {} as BatchJudgeService
const mockBatchJobs = {} as BatchJobRepository

describe("BatchCheckCommand", () => {
  test("shows submitted message", async () => {
    const checker = createMockChecker("submitted")
    const { frames } = render(
      <BatchCheckCommand
        checker={checker}
        batchJudge={mockBatchJudge}
        batchJobs={mockBatchJobs}
        sampleSize={20}
        outputPath="/tmp/claude/check.json"
      />,
    )

    const output = await waitForFrame(frames, (f) =>
      f.includes("Batch submitted!"),
    )
    expect(output).toContain("Batch submitted!")
    expect(output).toContain("msgbatch_check_test")
  })

  test("shows in-progress message", async () => {
    const checker = createMockChecker("in_progress")
    const { frames } = render(
      <BatchCheckCommand
        checker={checker}
        batchJudge={mockBatchJudge}
        batchJobs={mockBatchJobs}
        sampleSize={20}
        outputPath="/tmp/claude/check.json"
      />,
    )

    const output = await waitForFrame(frames, (f) =>
      f.includes("Batch in progress"),
    )
    expect(output).toContain("Batch in progress")
    expect(output).toContain("msgbatch_check_poll")
  })

  test("shows completion message with summary", async () => {
    const checker = createMockChecker("complete")
    const { frames } = render(
      <BatchCheckCommand
        checker={checker}
        batchJudge={mockBatchJudge}
        batchJobs={mockBatchJobs}
        sampleSize={5}
        outputPath="/tmp/claude/check.json"
      />,
    )

    const output = await waitForFrame(frames, (f) =>
      f.includes("Check complete!"),
    )
    expect(output).toContain("Check complete!")
    expect(output).toContain("5/5 correct")
    expect(output).toContain("4/5 accurate")
    expect(output).toContain("5/5 complete")
    expect(output).toContain("/tmp/claude/check.json")
  })

  test("shows error message", async () => {
    const checker = createMockChecker("error")
    const { frames } = render(
      <BatchCheckCommand
        checker={checker}
        batchJudge={mockBatchJudge}
        batchJobs={mockBatchJobs}
        sampleSize={20}
        outputPath="/tmp/claude/check.json"
      />,
    )

    const output = await waitForFrame(frames, (f) => f.includes("Error:"))
    expect(output).toContain("Error:")
    expect(output).toContain("Batch API failed")
  })
})

describe("batchCheckPhaseLabel", () => {
  test("returns submitting label", () => {
    expect(
      batchCheckPhaseLabel({
        phase: "submitting",
        current: 0,
        total: 20,
        batchStatus: "submitting",
      }),
    ).toBe("Submitting batch (20 commits)...")
  })

  test("returns importing label", () => {
    expect(
      batchCheckPhaseLabel({
        phase: "importing",
        current: 0,
        total: 10,
        batchStatus: "importing",
      }),
    ).toBe("Importing 10 results...")
  })

  test("returns batch progress label", () => {
    expect(
      batchCheckPhaseLabel({
        phase: "evaluating",
        current: 5,
        total: 20,
        batchId: "msgbatch_001",
        batchStatus: "in_progress",
      }),
    ).toContain("msgbatch_001")
  })

  test("returns evaluating label without batch info", () => {
    expect(
      batchCheckPhaseLabel({ phase: "evaluating", current: 0, total: 0 }),
    ).toBe("Evaluating commits...")
  })
})
