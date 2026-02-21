import { describe, expect, test } from "bun:test"

import type { CommitInfo } from "@/types"
import {
  EvalResponseSchema,
  JUDGE_SYSTEM_PROMPT,
  buildJudgeUserMessage,
  parseEvalResponse,
  reconcileClassificationVerdict,
} from "@services/judge-shared"

const commit: CommitInfo = {
  hash: "abc123",
  authorName: "Test",
  authorEmail: "test@example.com",
  committedAt: "2024-01-01",
  message: "fix auth bug",
  files: [
    {
      filePath: "src/auth.ts",
      changeType: "M" as const,
      additions: 5,
      deletions: 2,
    },
    {
      filePath: "src/utils.ts",
      changeType: "M" as const,
      additions: 1,
      deletions: 0,
    },
  ],
}

describe("JUDGE_SYSTEM_PROMPT", () => {
  test("contains all classification types", () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain("bug-fix")
    expect(JUDGE_SYSTEM_PROMPT).toContain("feature")
    expect(JUDGE_SYSTEM_PROMPT).toContain("refactor")
    expect(JUDGE_SYSTEM_PROMPT).toContain("chore")
  })

  test("describes the three evaluation dimensions", () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain("Classification correctness")
    expect(JUDGE_SYSTEM_PROMPT).toContain("Summary accuracy")
    expect(JUDGE_SYSTEM_PROMPT).toContain("Summary completeness")
  })

  test("contains classification guidelines aligned with enrichment prompt", () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain("CHANGELOG and release note updates")
    expect(JUDGE_SYSTEM_PROMPT).toContain("dev tooling")
    expect(JUDGE_SYSTEM_PROMPT).toContain("Moving code for efficiency")
    expect(JUDGE_SYSTEM_PROMPT).toContain(
      "Changing existing error messages, validation messages",
    )
  })

  test("contains accuracy guidance with both pass and fail criteria", () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain("describes the wrong component")
    expect(JUDGE_SYSTEM_PROMPT).toContain("Do not fail for omissions")
    expect(JUDGE_SYSTEM_PROMPT).toContain(
      "correctly describes the change even with different wording",
    )
  })

  test("contains completeness guidance with both pass and fail criteria", () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain("primary purpose")
    expect(JUDGE_SYSTEM_PROMPT).toContain(
      "major change or significant portion of the diff is unmentioned",
    )
    expect(JUDGE_SYSTEM_PROMPT).toContain(
      "do not fail completeness for lack of detail that cannot be inferred",
    )
  })

  test("contains trust-diff-over-message rule", () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain(
      "Always trust the diff over the commit message",
    )
  })

  test("contains scratch files guidance", () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain("Scratch files")
  })

  test("contains scoped broken-link rule with docs exception", () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain(
      "documentation content itself is the deliverable being corrected",
    )
  })

  test("contains evaluator calibration instruction", () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain("reasonable fit")
  })

  test("does not contain JSON format instructions (handled by structured outputs)", () => {
    expect(JUDGE_SYSTEM_PROMPT).not.toContain("Respond with valid JSON only")
    expect(JUDGE_SYSTEM_PROMPT).not.toContain("markdown fences")
  })
})

describe("EvalResponseSchema", () => {
  test("validates valid eval response", () => {
    const result = EvalResponseSchema.safeParse({
      classification: { pass: true, reasoning: "Correct" },
      accuracy: { pass: true, reasoning: "Accurate" },
      completeness: { pass: false, reasoning: "Incomplete" },
    })
    expect(result.success).toBe(true)
  })

  test("validates response with suggestedClassification", () => {
    const result = EvalResponseSchema.safeParse({
      classification: {
        pass: false,
        reasoning: "Wrong",
        suggestedClassification: "bug-fix",
      },
      accuracy: { pass: true, reasoning: "OK" },
      completeness: { pass: true, reasoning: "OK" },
    })
    expect(result.success).toBe(true)
  })

  test("rejects missing fields", () => {
    const result = EvalResponseSchema.safeParse({
      classification: { pass: true, reasoning: "OK" },
    })
    expect(result.success).toBe(false)
  })
})

describe("buildJudgeUserMessage", () => {
  test("includes commit message", () => {
    const msg = buildJudgeUserMessage(
      commit,
      "diff here",
      "bug-fix",
      "Fixed a bug",
    )
    expect(msg).toContain("Commit message: fix auth bug")
  })

  test("includes file paths with change types and line counts", () => {
    const msg = buildJudgeUserMessage(
      commit,
      "diff here",
      "bug-fix",
      "Fixed a bug",
    )
    expect(msg).toContain("M src/auth.ts (+5 -2)")
    expect(msg).toContain("M src/utils.ts (+1 -0)")
  })

  test("includes diff content", () => {
    const msg = buildJudgeUserMessage(
      commit,
      "+const x = 1",
      "bug-fix",
      "Fixed a bug",
    )
    expect(msg).toContain("+const x = 1")
  })

  test("includes enrichment to evaluate", () => {
    const msg = buildJudgeUserMessage(commit, "diff", "feature", "Added login")
    expect(msg).toContain("Classification: feature")
    expect(msg).toContain("Summary: Added login")
  })

  test("handles empty files list", () => {
    const emptyCommit: CommitInfo = { ...commit, files: [] }
    const msg = buildJudgeUserMessage(emptyCommit, "diff", "chore", "Cleanup")
    expect(msg).toContain("Files changed:")
  })
})

describe("parseEvalResponse", () => {
  test("parses valid all-pass response", () => {
    const result = parseEvalResponse(
      JSON.stringify({
        classification: { pass: true, reasoning: "Correct classification" },
        accuracy: { pass: true, reasoning: "Accurate summary" },
        completeness: { pass: true, reasoning: "Complete summary" },
      }),
    )
    expect(result.classificationVerdict.pass).toBe(true)
    expect(result.classificationVerdict.reasoning).toBe(
      "Correct classification",
    )
    expect(result.accuracyVerdict.pass).toBe(true)
    expect(result.completenessVerdict.pass).toBe(true)
  })

  test("parses fail response with suggested classification", () => {
    const result = parseEvalResponse(
      JSON.stringify({
        classification: {
          pass: false,
          reasoning: "Should be bug-fix",
          suggestedClassification: "bug-fix",
        },
        accuracy: { pass: true, reasoning: "OK" },
        completeness: { pass: false, reasoning: "Missing details" },
      }),
    )
    expect(result.classificationVerdict.pass).toBe(false)
    expect(result.classificationVerdict.suggestedClassification).toBe("bug-fix")
    expect(result.completenessVerdict.pass).toBe(false)
    expect(result.completenessVerdict.reasoning).toBe("Missing details")
  })

  test("throws on invalid JSON", () => {
    expect(() => parseEvalResponse("not json at all")).toThrow()
  })
})

describe("reconcileClassificationVerdict", () => {
  test("flips self-contradictory verdict to pass", () => {
    const verdict = reconcileClassificationVerdict("feature", {
      pass: false,
      reasoning: "Should be feature",
      suggestedClassification: "feature",
    })
    expect(verdict.pass).toBe(true)
    expect(verdict.reasoning).toBe("Should be feature")
    expect(verdict.suggestedClassification).toBeUndefined()
  })

  test("preserves legitimate failure", () => {
    const verdict = reconcileClassificationVerdict("feature", {
      pass: false,
      reasoning: "Should be bug-fix",
      suggestedClassification: "bug-fix",
    })
    expect(verdict.pass).toBe(false)
    expect(verdict.suggestedClassification).toBe("bug-fix")
  })

  test("leaves pass verdict unchanged", () => {
    const verdict = reconcileClassificationVerdict("feature", {
      pass: true,
      reasoning: "Correct",
    })
    expect(verdict.pass).toBe(true)
    expect(verdict.reasoning).toBe("Correct")
  })
})
