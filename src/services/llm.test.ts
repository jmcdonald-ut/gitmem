import { describe, test, expect, mock } from "bun:test"
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

  test("enrichCommit defaults unknown classification to chore", async () => {
    const service = new LLMService("test-key")
    setClient(
      service,
      mockClient(() =>
        Promise.resolve({
          content: [
            {
              type: "text",
              text: '{"classification": "unknown-type", "summary": "Did something"}',
            },
          ],
        }),
      ),
    )

    const result = await service.enrichCommit(commit, "")
    expect(result.classification).toBe("chore")
  })

  test("enrichCommit propagates API errors", async () => {
    const service = new LLMService("test-key")
    setClient(
      service,
      mockClient(() => Promise.reject(new Error("API error"))),
    )

    await expect(service.enrichCommit(commit, "")).rejects.toThrow("API error")
  })

  test("enrichCommit strips markdown fences from response", async () => {
    const service = new LLMService("test-key")
    setClient(
      service,
      mockClient(() =>
        Promise.resolve({
          content: [
            {
              type: "text",
              text: '```json\n{"classification": "bug-fix", "summary": "Fixed a bug"}\n```',
            },
          ],
        }),
      ),
    )

    const result = await service.enrichCommit(commit, "")
    expect(result.classification).toBe("bug-fix")
    expect(result.summary).toBe("Fixed a bug")
  })

  test("enrichCommit strips fences without language tag", async () => {
    const service = new LLMService("test-key")
    setClient(
      service,
      mockClient(() =>
        Promise.resolve({
          content: [
            {
              type: "text",
              text: '```\n{"classification": "feature", "summary": "New feature"}\n```',
            },
          ],
        }),
      ),
    )

    const result = await service.enrichCommit(commit, "")
    expect(result.classification).toBe("feature")
    expect(result.summary).toBe("New feature")
  })

  test("enrichCommit handles missing summary", async () => {
    const service = new LLMService("test-key")
    setClient(
      service,
      mockClient(() =>
        Promise.resolve({
          content: [
            {
              type: "text",
              text: '{"classification": "chore", "summary": 123}',
            },
          ],
        }),
      ),
    )

    const result = await service.enrichCommit(commit, "")
    expect(result.summary).toBe("No summary")
  })
})
