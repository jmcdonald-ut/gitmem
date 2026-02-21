import Anthropic from "@anthropic-ai/sdk"

import type { CommitInfo, EnrichmentResult } from "@/types"
import { getBatchStatus as getBatchStatusShared } from "@services/batch-shared"
import {
  ENRICHMENT_OUTPUT_CONFIG,
  SYSTEM_PROMPT,
  buildUserMessage,
  parseEnrichmentResponse,
} from "@services/llm-shared"
import type { BatchStatusResult } from "@services/types"

/** A single request item for a batch submission. */
export interface BatchRequest {
  hash: string
  commit: CommitInfo
  diff: string
}

/** A single result from a completed batch. */
export interface BatchResultItem {
  hash: string
  result?: EnrichmentResult
  error?: string
}

/** Submits and retrieves commit enrichment via the Anthropic Message Batches API. */
export class BatchLLMService {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model: string = "claude-haiku-4-5-20251001") {
    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  /**
   * Submits a batch of enrichment requests to the Anthropic Batches API.
   * @param requests - Array of commit/diff pairs to enrich.
   * @returns The batch ID and request count.
   */
  async submitBatch(
    requests: BatchRequest[],
  ): Promise<{ batchId: string; requestCount: number }> {
    const batch = await this.client.messages.batches.create({
      requests: requests.map((req) => ({
        custom_id: req.hash,
        params: {
          model: this.model,
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          messages: [
            { role: "user", content: buildUserMessage(req.commit, req.diff) },
          ],
          output_config: ENRICHMENT_OUTPUT_CONFIG,
        },
      })),
    })

    return { batchId: batch.id, requestCount: requests.length }
  }

  /**
   * Retrieves the current status of a batch.
   * @param batchId - The batch ID to check.
   * @returns Processing status and request counts.
   */
  async getBatchStatus(batchId: string): Promise<BatchStatusResult> {
    return getBatchStatusShared(this.client, batchId)
  }

  /**
   * Retrieves and parses results from a completed batch.
   * @param batchId - The batch ID to get results for.
   * @returns Array of result items with enrichment data or error messages.
   */
  async getBatchResults(batchId: string): Promise<BatchResultItem[]> {
    const results: BatchResultItem[] = []
    const decoder = await this.client.messages.batches.results(batchId)

    for await (const item of decoder) {
      const hash = item.custom_id
      if (item.result.type === "succeeded") {
        const message = item.result.message
        const text =
          message.content[0].type === "text" ? message.content[0].text : ""
        try {
          const enrichment = parseEnrichmentResponse(text)
          results.push({ hash, result: enrichment })
        } catch {
          results.push({ hash, error: `Failed to parse response: ${text}` })
        }
      } else {
        results.push({
          hash,
          error: `Batch item ${item.result.type}`,
        })
      }
    }

    return results
  }
}
