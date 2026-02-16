import { describe, test, expect, mock } from "bun:test"
import React from "react"
import { render } from "ink-testing-library"
import { CheckCommand } from "@commands/check-command"
import type { CheckerService } from "@services/checker"
import type { CheckProgress, EvalResult, EvalSummary } from "@/types"

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
    const { lastFrame } = render(
      <CheckCommand checker={checker} hash="abc1234def" />,
    )

    await new Promise((r) => setTimeout(r, 50))

    const output = lastFrame()
    expect(output).toContain("abc1234")
    expect(output).toContain("[feature]")
    expect(output).toContain("[PASS]")
    expect(output).toContain("Classification")
    expect(output).toContain("Summary accuracy")
    expect(output).toContain("Summary completeness")
  })

  test("shows single commit fail results", async () => {
    const checker = createMockChecker("single-fail")
    const { lastFrame } = render(
      <CheckCommand checker={checker} hash="abc1234def" />,
    )

    await new Promise((r) => setTimeout(r, 50))

    const output = lastFrame()
    expect(output).toContain("[FAIL]")
    expect(output).toContain("Should be bug-fix")
    expect(output).toContain("Missing rate limiting details")
  })

  test("shows not found message for unenriched commit", async () => {
    const checker = createMockChecker("single-not-found")
    const { lastFrame } = render(
      <CheckCommand checker={checker} hash="nonexistent" />,
    )

    await new Promise((r) => setTimeout(r, 50))

    const output = lastFrame()
    expect(output).toContain("not found or not yet enriched")
  })

  test("shows batch summary", async () => {
    const checker = createMockChecker("batch")
    const outputPath = "/tmp/claude/check-test.json"
    const { lastFrame } = render(
      <CheckCommand checker={checker} sampleSize={5} outputPath={outputPath} />,
    )

    await new Promise((r) => setTimeout(r, 50))

    const output = lastFrame()
    expect(output).toContain("Evaluation Summary (5 commits)")
    expect(output).toContain("4/5 correct")
    expect(output).toContain("5/5 accurate")
    expect(output).toContain("3/5 complete")
    expect(output).toContain(outputPath)
  })

  test("shows ambiguous hash error with matching hashes", async () => {
    const checker = createMockChecker("single-ambiguous")
    const { lastFrame } = render(
      <CheckCommand checker={checker} hash="abc1234" />,
    )

    await new Promise((r) => setTimeout(r, 50))

    const output = lastFrame()
    expect(output).toContain("Ambiguous hash prefix")
    expect(output).toContain("abc1234aaa")
    expect(output).toContain("abc1234bbb")
    expect(output).toContain("more characters")
  })

  test("shows error message for single check", async () => {
    const checker = createMockChecker("error")
    const { lastFrame } = render(
      <CheckCommand checker={checker} hash="abc123" />,
    )

    await new Promise((r) => setTimeout(r, 50))

    const output = lastFrame()
    expect(output).toContain("Error:")
    expect(output).toContain("Judge API failed")
  })

  test("shows error message for batch check", async () => {
    const checker = createMockChecker("error")
    const { lastFrame } = render(
      <CheckCommand
        checker={checker}
        sampleSize={5}
        outputPath="/tmp/claude/check-err.json"
      />,
    )

    await new Promise((r) => setTimeout(r, 50))

    const output = lastFrame()
    expect(output).toContain("Error:")
    expect(output).toContain("Judge API failed")
  })
})
