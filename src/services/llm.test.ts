import { describe, expect, mock, test } from "bun:test"

import { LLMService } from "@services/llm"

function mockClient(createFn: () => Promise<unknown>) {
  return {
    messages: { create: mock(createFn) },
  }
}

function setClient(service: LLMService, client: ReturnType<typeof mockClient>) {
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

describe("LLMService", () => {
  test("enrichCommit parses valid response", async () => {
    const service = new LLMService("test-key")
    setClient(
      service,
      mockClient(() =>
        Promise.resolve({
          content: [
            {
              type: "text",
              text: '{"classification": "bug-fix", "summary": "Fixed null pointer in auth flow"}',
            },
          ],
        }),
      ),
    )

    const result = await service.enrichCommit(commit, "diff content here")

    expect(result.classification).toBe("bug-fix")
    expect(result.summary).toBe("Fixed null pointer in auth flow")
  })

  test("enrichCommit propagates API errors", async () => {
    const service = new LLMService("test-key")
    setClient(
      service,
      mockClient(() => Promise.reject(new Error("API error"))),
    )

    await expect(service.enrichCommit(commit, "")).rejects.toThrow("API error")
  })

  test("enrichCommit passes output_config in API call", async () => {
    const service = new LLMService("test-key")
    const client = mockClient(() =>
      Promise.resolve({
        content: [
          {
            type: "text",
            text: '{"classification": "feature", "summary": "Added feature"}',
          },
        ],
      }),
    )
    setClient(service, client)

    await service.enrichCommit(commit, "diff")

    const call = client.messages.create.mock.calls[0] as unknown as [
      { output_config: unknown },
    ]
    expect(call[0].output_config).toBeDefined()
    expect(
      (call[0].output_config as { format: { type: string } }).format.type,
    ).toBe("json_schema")
  })
})
