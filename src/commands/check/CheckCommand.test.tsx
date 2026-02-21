import { describe, expect, mock, test } from "bun:test"
import { render } from "ink-testing-library"
import React from "react"

import type { CheckProgress, EvalResult, EvalSummary } from "@/types"
import { CheckCommand } from "@commands/check/CheckCommand"
import { waitForFrame } from "@commands/utils/test-utils"
import type { CheckerService } from "@services/checker"

function createMockChecker(
  behavior:
    | "single-pass"
    | "single-fail"
    | "single-not-found"
    | "single-ambiguous"
    | "batch"
    | "error" = "single-pass",
): CheckerService {
  return {
    checkOne: mock(
      async (hash: string, onProgress: (p: CheckProgress) => void) => {
        if (behavior === "error") throw new Error("Judge API failed")
        if (behavior === "single-ambiguous")
          throw new Error(
            `Ambiguous hash prefix "${hash}" matches 2 commits: abc1234aaa, abc1234bbb. Please provide more characters.`,
          )
        if (behavior === "single-not-found") return null
        onProgress({
          phase: "evaluating",
          current: 0,
          total: 1,
          currentHash: hash,
        })
        onProgress({ phase: "done", current: 1, total: 1 })
        if (behavior === "single-fail") {
          return {
            hash,
            classification: "feature",
            summary: "Added new feature",
            classificationVerdict: {
              pass: false,
              reasoning: "Should be bug-fix",
              suggestedClassification: "bug-fix",
            },
            accuracyVerdict: { pass: true, reasoning: "Accurate summary" },
            completenessVerdict: {
              pass: false,
              reasoning: "Missing rate limiting details",
            },
          } as EvalResult
        }
        return {
          hash,
          classification: "feature",
          summary: "Added new auth middleware",
          classificationVerdict: {
            pass: true,
            reasoning: "Correct classification",
          },
          accuracyVerdict: { pass: true, reasoning: "Accurate summary" },
          completenessVerdict: { pass: true, reasoning: "Complete summary" },
        } as EvalResult
      },
    ),
    checkSample: mock(
      async (sampleSize: number, onProgress: (p: CheckProgress) => void) => {
        if (behavior === "error") throw new Error("Judge API failed")
        onProgress({
          phase: "evaluating",
          current: 1,
          total: sampleSize,
        })
        onProgress({ phase: "done", current: sampleSize, total: sampleSize })
        const results: EvalResult[] = Array.from(
          { length: sampleSize },
          (_, i) => ({
            hash: `hash${i}`,
            classification: "feature",
            summary: `summary ${i}`,
            classificationVerdict: {
              pass: i < sampleSize - 1,
              reasoning: "reason",
            },
            accuracyVerdict: { pass: true, reasoning: "reason" },
            completenessVerdict: {
              pass: i < sampleSize - 2,
              reasoning: "reason",
            },
          }),
        )
        const summary: EvalSummary = {
          total: sampleSize,
          classificationCorrect: sampleSize - 1,
          summaryAccurate: sampleSize,
          summaryComplete: sampleSize - 2,
        }
        return { results, summary }
      },
    ),
  } as unknown as CheckerService
}

describe("CheckCommand", () => {
  test("shows single commit pass results", async () => {
    const checker = createMockChecker("single-pass")
    const { frames } = render(
      <CheckCommand checker={checker} hash="abc1234def" />,
    )

    const output = await waitForFrame(frames, (f) => f.includes("[PASS]"))
    expect(output).toContain("abc1234")
    expect(output).toContain("[feature]")
    expect(output).toContain("[PASS]")
    expect(output).toContain("Classification")
    expect(output).toContain("Summary accuracy")
    expect(output).toContain("Summary completeness")
  })

  test("shows single commit fail results", async () => {
    const checker = createMockChecker("single-fail")
    const { frames } = render(
      <CheckCommand checker={checker} hash="abc1234def" />,
    )

    const output = await waitForFrame(frames, (f) => f.includes("[FAIL]"))
    expect(output).toContain("[FAIL]")
    expect(output).toContain("Should be bug-fix")
    expect(output).toContain("Missing rate limiting details")
  })

  test("shows not found message for unenriched commit", async () => {
    const checker = createMockChecker("single-not-found")
    const { frames } = render(
      <CheckCommand checker={checker} hash="nonexistent" />,
    )

    const output = await waitForFrame(frames, (f) => f.includes("not found"))
    expect(output).toContain("not found or not yet enriched")
  })

  test("shows batch summary", async () => {
    const checker = createMockChecker("batch")
    const outputPath = "/tmp/claude/check-test.json"
    const { frames } = render(
      <CheckCommand checker={checker} sampleSize={5} outputPath={outputPath} />,
    )

    const output = await waitForFrame(frames, (f) =>
      f.includes("Evaluation Summary"),
    )
    expect(output).toContain("Evaluation Summary (5 commits)")
    expect(output).toContain("4/5 correct")
    expect(output).toContain("5/5 accurate")
    expect(output).toContain("3/5 complete")
    expect(output).toContain(outputPath)
  })

  test("shows ambiguous hash error with matching hashes", async () => {
    const checker = createMockChecker("single-ambiguous")
    const { frames } = render(<CheckCommand checker={checker} hash="abc1234" />)

    const output = await waitForFrame(frames, (f) =>
      f.includes("Ambiguous hash prefix"),
    )
    expect(output).toContain("Ambiguous hash prefix")
    expect(output).toContain("abc1234aaa")
    expect(output).toContain("abc1234bbb")
    expect(output).toContain("more characters")
  })

  test("shows error message for single check", async () => {
    const checker = createMockChecker("error")
    const { frames } = render(<CheckCommand checker={checker} hash="abc123" />)

    const output = await waitForFrame(frames, (f) => f.includes("Error:"))
    expect(output).toContain("Error:")
    expect(output).toContain("Judge API failed")
  })

  test("shows error message for batch check", async () => {
    const checker = createMockChecker("error")
    const { frames } = render(
      <CheckCommand
        checker={checker}
        sampleSize={5}
        outputPath="/tmp/claude/check-err.json"
      />,
    )

    const output = await waitForFrame(frames, (f) => f.includes("Error:"))
    expect(output).toContain("Error:")
    expect(output).toContain("Judge API failed")
  })
})
