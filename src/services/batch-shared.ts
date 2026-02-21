import type Anthropic from "@anthropic-ai/sdk"

import type { BatchStatusResult } from "@/types"

/**
 * Retrieves the current status of a batch from the Anthropic API.
 * Shared between BatchLLMService and BatchJudgeService.
 * @param client - The Anthropic client instance.
 * @param batchId - The batch ID to check.
 * @returns Processing status and request counts.
 */
export async function getBatchStatus(
  client: Anthropic,
  batchId: string,
): Promise<BatchStatusResult> {
  const batch = await client.messages.batches.retrieve(batchId)
  return {
    processingStatus: batch.processing_status,
    requestCounts: {
      succeeded: batch.request_counts.succeeded,
      errored: batch.request_counts.errored,
      canceled: batch.request_counts.canceled,
      expired: batch.request_counts.expired,
      processing: batch.request_counts.processing,
    },
  }
}
