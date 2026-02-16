import { describe, test, expect } from "bun:test"
import {
  JUDGE_SYSTEM_PROMPT,
  buildJudgeUserMessage,
  parseEvalResponse,
} from "@services/judge-shared"
import type { CommitInfo } from "@/types"

const commit: CommitInfo = {
  hash: "abc123",
  authorName: "Test",
  authorEmail: "test@example.com",
  committedAt: "2024-01-01",
  message: "fix auth bug",
  files: [
    { filePath: "src/auth.ts", changeType: "M", additions: 5, deletions: 2 },
    { filePath: "src/utils.ts", changeType: "M", additions: 1, deletions: 0 },
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

  test("includes file paths", () => {
    const msg = buildJudgeUserMessage(
      commit,
      "diff here",
      "bug-fix",
      "Fixed a bug",
    )
    expect(msg).toContain("src/auth.ts, src/utils.ts")
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
    expect(msg).toContain("Files changed: ")
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

  test("strips markdown json fences", () => {
    const result = parseEvalResponse(
      '```json\n{"classification":{"pass":true,"reasoning":"OK"},"accuracy":{"pass":true,"reasoning":"OK"},"completeness":{"pass":true,"reasoning":"OK"}}\n```',
    )
    expect(result.classificationVerdict.pass).toBe(true)
  })

  test("strips markdown fences without language tag", () => {
    const result = parseEvalResponse(
      '```\n{"classification":{"pass":true,"reasoning":"OK"},"accuracy":{"pass":true,"reasoning":"OK"},"completeness":{"pass":true,"reasoning":"OK"}}\n```',
    )
    expect(result.classificationVerdict.pass).toBe(true)
  })

  test("defaults to pass on invalid JSON", () => {
    const result = parseEvalResponse("not json at all")
    expect(result.classificationVerdict.pass).toBe(true)
    expect(result.classificationVerdict.reasoning).toBe("No reasoning provided")
    expect(result.accuracyVerdict.pass).toBe(true)
    expect(result.completenessVerdict.pass).toBe(true)
  })

  test("defaults to pass on missing fields", () => {
    const result = parseEvalResponse("{}")
    expect(result.classificationVerdict.pass).toBe(true)
    expect(result.accuracyVerdict.pass).toBe(true)
    expect(result.completenessVerdict.pass).toBe(true)
  })

  test("defaults non-boolean pass to true", () => {
    const result = parseEvalResponse(
      JSON.stringify({
        classification: { pass: "yes", reasoning: "OK" },
        accuracy: { pass: true, reasoning: "OK" },
        completeness: { pass: true, reasoning: "OK" },
      }),
    )
    expect(result.classificationVerdict.pass).toBe(true)
  })

  test("defaults non-string reasoning", () => {
    const result = parseEvalResponse(
      JSON.stringify({
        classification: { pass: false, reasoning: 123 },
        accuracy: { pass: true, reasoning: "OK" },
        completeness: { pass: true, reasoning: "OK" },
      }),
    )
    expect(result.classificationVerdict.reasoning).toBe("No reasoning provided")
  })

  test("ignores invalid suggested classification", () => {
    const result = parseEvalResponse(
      JSON.stringify({
        classification: {
          pass: false,
          reasoning: "Wrong",
          suggestedClassification: "invalid-type",
        },
        accuracy: { pass: true, reasoning: "OK" },
        completeness: { pass: true, reasoning: "OK" },
      }),
    )
    expect(result.classificationVerdict.suggestedClassification).toBeUndefined()
  })
})
