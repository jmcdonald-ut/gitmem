import { describe, test, expect, mock } from "bun:test"
import { JudgeService } from "@services/judge"

function mockClient(createFn: () => Promise<unknown>) {
  return {
    messages: { create: mock(createFn) },
  }
}

function setClient(
  service: JudgeService,
  client: ReturnType<typeof mockClient>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(service as any).client = client
}

const commit = {
  hash: "abc123",
  authorName: "Test",
  authorEmail: "test@example.com",
  committedAt: "2024-01-01",
  message: "test commit",
  files: [
    { filePath: "src/auth.ts", changeType: "M", additions: 5, deletions: 2 },
  ],
}

describe("JudgeService", () => {
  test("evaluateCommit parses valid response", async () => {
    const service = new JudgeService("test-key")
    setClient(
      service,
      mockClient(() =>
        Promise.resolve({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                classification: {
                  pass: true,
                  reasoning: "Correct classification",
                },
                accuracy: { pass: true, reasoning: "Accurate summary" },
                completeness: { pass: false, reasoning: "Missing details" },
              }),
            },
          ],
        }),
      ),
    )

    const result = await service.evaluateCommit(
      commit,
      "diff content",
      "bug-fix",
      "Fixed a bug",
    )

    expect(result.classificationVerdict.pass).toBe(true)
    expect(result.classificationVerdict.reasoning).toBe(
      "Correct classification",
    )
    expect(result.accuracyVerdict.pass).toBe(true)
    expect(result.completenessVerdict.pass).toBe(false)
    expect(result.completenessVerdict.reasoning).toBe("Missing details")
  })

  test("evaluateCommit defaults malformed response to fail", async () => {
    const service = new JudgeService("test-key")
    setClient(
      service,
      mockClient(() =>
        Promise.resolve({
          content: [{ type: "text", text: "not valid json" }],
        }),
      ),
    )

    const result = await service.evaluateCommit(
      commit,
      "diff",
      "feature",
      "Added feature",
    )

    expect(result.classificationVerdict.pass).toBe(false)
    expect(result.accuracyVerdict.pass).toBe(false)
    expect(result.completenessVerdict.pass).toBe(false)
  })

  test("evaluateCommit propagates API errors", async () => {
    const service = new JudgeService("test-key")
    setClient(
      service,
      mockClient(() => Promise.reject(new Error("API error"))),
    )

    await expect(
      service.evaluateCommit(commit, "diff", "feature", "summary"),
    ).rejects.toThrow("API error")
  })

  test("evaluateCommit strips markdown fences from response", async () => {
    const service = new JudgeService("test-key")
    setClient(
      service,
      mockClient(() =>
        Promise.resolve({
          content: [
            {
              type: "text",
              text: '```json\n{"classification":{"pass":true,"reasoning":"OK"},"accuracy":{"pass":true,"reasoning":"OK"},"completeness":{"pass":true,"reasoning":"OK"}}\n```',
            },
          ],
        }),
      ),
    )

    const result = await service.evaluateCommit(
      commit,
      "diff",
      "feature",
      "summary",
    )
    expect(result.classificationVerdict.pass).toBe(true)
  })

  test("evaluateCommit uses custom model", () => {
    const service = new JudgeService("test-key", "claude-opus-4-6")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((service as any).model).toBe("claude-opus-4-6")
  })
})
