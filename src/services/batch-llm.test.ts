import { describe, test, expect, mock } from "bun:test"
import { BatchLLMService } from "@services/batch-llm"
import type { CommitInfo } from "@/types"

function mockClient(overrides: {
  create?: () => Promise<unknown>
  retrieve?: () => Promise<unknown>
  results?: () => Promise<unknown>
}) {
  return {
    messages: {
      batches: {
        create: mock(
          overrides.create ??
            (() =>
              Promise.resolve({
                id: "msgbatch_001",
                processing_status: "in_progress",
              })),
        ),
        retrieve: mock(
          overrides.retrieve ??
            (() =>
              Promise.resolve({
                id: "msgbatch_001",
                processing_status: "ended",
                request_counts: {
                  succeeded: 2,
                  errored: 0,
                  canceled: 0,
                  expired: 0,
                  processing: 0,
                },
              })),
        ),
        results: mock(
          overrides.results ??
            (() =>
              Promise.resolve({
                async *[Symbol.asyncIterator]() {
                  yield {
                    custom_id: "abc123",
                    result: {
                      type: "succeeded",
                      message: {
                        content: [
                          {
                            type: "text",
                            text: '{"classification": "bug-fix", "summary": "Fixed a bug"}',
                          },
                        ],
                      },
                    },
                  }
                },
              })),
        ),
      },
    },
  }
}

function setClient(
  service: BatchLLMService,
  client: ReturnType<typeof mockClient>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(service as any).client = client
}

const commit: CommitInfo = {
  hash: "abc123",
  authorName: "Test",
  authorEmail: "test@example.com",
  committedAt: "2024-01-01",
  message: "fix auth bug",
  files: [
    { filePath: "src/auth.ts", changeType: "M", additions: 5, deletions: 2 },
  ],
}

describe("BatchLLMService", () => {
  test("submitBatch sends requests and returns batch ID", async () => {
    const service = new BatchLLMService("test-key")
    const client = mockClient({
      create: () =>
        Promise.resolve({
          id: "msgbatch_test",
          processing_status: "in_progress",
        }),
    })
    setClient(service, client)

    const result = await service.submitBatch([
      { hash: "abc123", commit, diff: "diff content" },
    ])

    expect(result.batchId).toBe("msgbatch_test")
    expect(result.requestCount).toBe(1)
    expect(client.messages.batches.create).toHaveBeenCalledTimes(1)
  })

  test("submitBatch uses custom_id as commit hash", async () => {
    const service = new BatchLLMService("test-key")
    const client = mockClient({
      create: () => {
        return Promise.resolve({ id: "msgbatch_test" })
      },
    })
    setClient(service, client)

    await service.submitBatch([
      { hash: "abc123", commit, diff: "diff" },
      {
        hash: "def456",
        commit: { ...commit, hash: "def456" },
        diff: "diff2",
      },
    ])

    const call = client.messages.batches.create.mock.calls[0]
    const requests = (call[0] as { requests: { custom_id: string }[] }).requests
    expect(requests[0].custom_id).toBe("abc123")
    expect(requests[1].custom_id).toBe("def456")
  })

  test("getBatchStatus returns processing info", async () => {
    const service = new BatchLLMService("test-key")
    const client = mockClient({
      retrieve: () =>
        Promise.resolve({
          id: "msgbatch_001",
          processing_status: "in_progress",
          request_counts: {
            succeeded: 5,
            errored: 1,
            canceled: 0,
            expired: 0,
            processing: 4,
          },
        }),
    })
    setClient(service, client)

    const status = await service.getBatchStatus("msgbatch_001")

    expect(status.processingStatus).toBe("in_progress")
    expect(status.requestCounts.succeeded).toBe(5)
    expect(status.requestCounts.errored).toBe(1)
    expect(status.requestCounts.processing).toBe(4)
  })

  test("getBatchResults parses succeeded items", async () => {
    const service = new BatchLLMService("test-key")
    const client = mockClient({
      results: () =>
        Promise.resolve({
          async *[Symbol.asyncIterator]() {
            yield {
              custom_id: "abc123",
              result: {
                type: "succeeded",
                message: {
                  content: [
                    {
                      type: "text",
                      text: '{"classification": "bug-fix", "summary": "Fixed auth"}',
                    },
                  ],
                },
              },
            }
            yield {
              custom_id: "def456",
              result: {
                type: "succeeded",
                message: {
                  content: [
                    {
                      type: "text",
                      text: '{"classification": "feature", "summary": "Added login"}',
                    },
                  ],
                },
              },
            }
          },
        }),
    })
    setClient(service, client)

    const results = await service.getBatchResults("msgbatch_001")

    expect(results).toHaveLength(2)
    expect(results[0].hash).toBe("abc123")
    expect(results[0].result?.classification).toBe("bug-fix")
    expect(results[1].hash).toBe("def456")
    expect(results[1].result?.classification).toBe("feature")
  })

  test("getBatchResults handles errored items", async () => {
    const service = new BatchLLMService("test-key")
    const client = mockClient({
      results: () =>
        Promise.resolve({
          async *[Symbol.asyncIterator]() {
            yield {
              custom_id: "abc123",
              result: { type: "errored", error: { message: "Rate limited" } },
            }
          },
        }),
    })
    setClient(service, client)

    const results = await service.getBatchResults("msgbatch_001")

    expect(results).toHaveLength(1)
    expect(results[0].hash).toBe("abc123")
    expect(results[0].error).toContain("errored")
    expect(results[0].result).toBeUndefined()
  })

  test("getBatchResults handles canceled items", async () => {
    const service = new BatchLLMService("test-key")
    const client = mockClient({
      results: () =>
        Promise.resolve({
          async *[Symbol.asyncIterator]() {
            yield {
              custom_id: "abc123",
              result: { type: "canceled" },
            }
          },
        }),
    })
    setClient(service, client)

    const results = await service.getBatchResults("msgbatch_001")

    expect(results).toHaveLength(1)
    expect(results[0].error).toContain("canceled")
  })

  test("getBatchResults handles expired items", async () => {
    const service = new BatchLLMService("test-key")
    const client = mockClient({
      results: () =>
        Promise.resolve({
          async *[Symbol.asyncIterator]() {
            yield {
              custom_id: "abc123",
              result: { type: "expired" },
            }
          },
        }),
    })
    setClient(service, client)

    const results = await service.getBatchResults("msgbatch_001")

    expect(results).toHaveLength(1)
    expect(results[0].error).toContain("expired")
  })

  test("getBatchResults handles parse failures", async () => {
    const service = new BatchLLMService("test-key")
    const client = mockClient({
      results: () =>
        Promise.resolve({
          async *[Symbol.asyncIterator]() {
            yield {
              custom_id: "abc123",
              result: {
                type: "succeeded",
                message: {
                  content: [{ type: "text", text: "not valid json" }],
                },
              },
            }
          },
        }),
    })
    setClient(service, client)

    const results = await service.getBatchResults("msgbatch_001")

    expect(results).toHaveLength(1)
    expect(results[0].hash).toBe("abc123")
    expect(results[0].error).toContain("Failed to parse")
  })
})
