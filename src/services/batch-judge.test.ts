import { describe, expect, mock, test } from "bun:test"

import type { CommitInfo } from "@/types"
import { BatchJudgeService } from "@services/batch-judge"

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
                            text: JSON.stringify({
                              classification: {
                                pass: true,
                                reasoning: "Correct",
                              },
                              accuracy: { pass: true, reasoning: "Accurate" },
                              completeness: {
                                pass: true,
                                reasoning: "Complete",
                              },
                            }),
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
  service: BatchJudgeService,
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

describe("BatchJudgeService", () => {
  test("submitBatch sends requests and returns batch ID", async () => {
    const service = new BatchJudgeService("test-key")
    const client = mockClient({
      create: () =>
        Promise.resolve({
          id: "msgbatch_test",
          processing_status: "in_progress",
        }),
    })
    setClient(service, client)

    const result = await service.submitBatch([
      {
        hash: "abc123",
        commit,
        diff: "diff content",
        classification: "bug-fix",
        summary: "Fixed auth bug",
      },
    ])

    expect(result.batchId).toBe("msgbatch_test")
    expect(result.requestCount).toBe(1)
    expect(client.messages.batches.create).toHaveBeenCalledTimes(1)
  })

  test("submitBatch uses custom_id as commit hash", async () => {
    const service = new BatchJudgeService("test-key")
    const client = mockClient({
      create: () => Promise.resolve({ id: "msgbatch_test" }),
    })
    setClient(service, client)

    await service.submitBatch([
      {
        hash: "abc123",
        commit,
        diff: "diff",
        classification: "bug-fix",
        summary: "Fixed bug",
      },
      {
        hash: "def456",
        commit: { ...commit, hash: "def456" },
        diff: "diff2",
        classification: "feature",
        summary: "Added feature",
      },
    ])

    const call = client.messages.batches.create.mock.calls[0] as unknown as [
      { requests: { custom_id: string }[] },
    ]
    const requests = call[0].requests
    expect(requests[0].custom_id).toBe("abc123")
    expect(requests[1].custom_id).toBe("def456")
  })

  test("submitBatch includes output_config in each request params", async () => {
    const service = new BatchJudgeService("test-key")
    const client = mockClient({
      create: () => Promise.resolve({ id: "msgbatch_test" }),
    })
    setClient(service, client)

    await service.submitBatch([
      {
        hash: "abc123",
        commit,
        diff: "diff",
        classification: "bug-fix",
        summary: "Fixed bug",
      },
    ])

    const call = client.messages.batches.create.mock.calls[0] as unknown as [
      { requests: { params: { output_config: unknown } }[] },
    ]
    const params = call[0].requests[0].params
    expect(params.output_config).toBeDefined()
    expect(
      (params.output_config as { format: { type: string } }).format.type,
    ).toBe("json_schema")
  })

  test("getBatchStatus returns processing info", async () => {
    const service = new BatchJudgeService("test-key")
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
    const service = new BatchJudgeService("test-key")
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
                      text: JSON.stringify({
                        classification: { pass: true, reasoning: "Correct" },
                        accuracy: { pass: false, reasoning: "Inaccurate" },
                        completeness: { pass: true, reasoning: "Complete" },
                      }),
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

    expect(results).toHaveLength(1)
    expect(results[0].hash).toBe("abc123")
    expect(results[0].result?.classificationVerdict.pass).toBe(true)
    expect(results[0].result?.accuracyVerdict.pass).toBe(false)
    expect(results[0].result?.completenessVerdict.pass).toBe(true)
  })

  test("getBatchResults handles errored items", async () => {
    const service = new BatchJudgeService("test-key")
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
    const service = new BatchJudgeService("test-key")
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

  test("getBatchResults handles parse failures", async () => {
    const service = new BatchJudgeService("test-key")
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
