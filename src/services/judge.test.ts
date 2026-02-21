import { describe, expect, mock, test } from "bun:test"

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
    {
      filePath: "src/auth.ts",
      changeType: "M" as const,
      additions: 5,
      deletions: 2,
    },
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

  test("evaluateCommit passes output_config in API call", async () => {
    const service = new JudgeService("test-key")
    const client = mockClient(() =>
      Promise.resolve({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              classification: { pass: true, reasoning: "OK" },
              accuracy: { pass: true, reasoning: "OK" },
              completeness: { pass: true, reasoning: "OK" },
            }),
          },
        ],
      }),
    )
    setClient(service, client)

    await service.evaluateCommit(commit, "diff", "feature", "summary")

    const call = client.messages.create.mock.calls[0] as unknown as [
      { output_config: unknown },
    ]
    expect(call[0].output_config).toBeDefined()
    expect(
      (call[0].output_config as { format: { type: string } }).format.type,
    ).toBe("json_schema")
  })

  test("evaluateCommit uses custom model", () => {
    const service = new JudgeService("test-key", "claude-opus-4-6")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((service as any).model).toBe("claude-opus-4-6")
  })
})
