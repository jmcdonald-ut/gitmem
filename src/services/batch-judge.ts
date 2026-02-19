import Anthropic from "@anthropic-ai/sdk"
import type {
  CommitInfo,
  EvalVerdict,
  IBatchJudgeService,
  BatchStatusResult,
} from "@/types"
import {
  JUDGE_SYSTEM_PROMPT,
  EVAL_OUTPUT_CONFIG,
  buildJudgeUserMessage,
  parseEvalResponse,
} from "@services/judge-shared"
import { getBatchStatus as getBatchStatusShared } from "@services/batch-shared"

/** A single request item for a check batch submission. */
export interface CheckBatchRequest {
  hash: string
  commit: CommitInfo
  diff: string
  classification: string
  summary: string
}

/** A single result from a completed check batch. */
export interface CheckBatchResultItem {
  hash: string
  result?: {
    classificationVerdict: EvalVerdict
    accuracyVerdict: EvalVerdict
    completenessVerdict: EvalVerdict
  }
  error?: string
}

/** Submits and retrieves commit evaluations via the Anthropic Message Batches API. */
export class BatchJudgeService implements IBatchJudgeService {
  private client: Anthropic
  readonly model: string

  constructor(apiKey: string, model: string = "claude-sonnet-4-5-20250929") {
    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  /**
   * Submits a batch of evaluation requests to the Anthropic Batches API.
   * @param requests - Array of commit/enrichment pairs to evaluate.
   * @returns The batch ID and request count.
   */
  async submitBatch(
    requests: CheckBatchRequest[],
  ): Promise<{ batchId: string; requestCount: number }> {
    const batch = await this.client.messages.batches.create({
      requests: requests.map((req) => ({
        custom_id: req.hash,
        params: {
          model: this.model,
          max_tokens: 1024,
          system: JUDGE_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: buildJudgeUserMessage(
                req.commit,
                req.diff,
                req.classification,
                req.summary,
              ),
            },
          ],
          output_config: EVAL_OUTPUT_CONFIG,
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
   * @returns Array of result items with evaluation verdicts or error messages.
   */
  async getBatchResults(batchId: string): Promise<CheckBatchResultItem[]> {
    const results: CheckBatchResultItem[] = []
    const decoder = await this.client.messages.batches.results(batchId)

    for await (const item of decoder) {
      const hash = item.custom_id
      if (item.result.type === "succeeded") {
        const message = item.result.message
        const text =
          message.content[0].type === "text" ? message.content[0].text : ""
        try {
          const verdicts = parseEvalResponse(text)
          results.push({ hash, result: verdicts })
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
