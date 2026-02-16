import Anthropic from "@anthropic-ai/sdk"
import type { CommitInfo, EnrichmentResult, ILLMService } from "@/types"
import {
  SYSTEM_PROMPT,
  buildUserMessage,
  parseEnrichmentResponse,
} from "@services/llm-shared"

/** Classifies and summarizes git commits using the Anthropic API. */
export class LLMService implements ILLMService {
  private client: Anthropic
  private model: string
  private retryDelayMs: number

  /**
   * @param apiKey - Anthropic API key.
   * @param model - Model identifier to use for enrichment requests.
   * @param retryDelayMs - Base delay in ms for exponential backoff (default 1000).
   */
  constructor(
    apiKey: string,
    model: string = "claude-haiku-4-5-20251001",
    retryDelayMs: number = 1000,
  ) {
    this.client = new Anthropic({ apiKey })
    this.model = model
    this.retryDelayMs = retryDelayMs
  }

  /**
   * Sends a commit's metadata and diff to the LLM for classification and summarization.
   * Retries up to 3 times with exponential backoff on failure.
   * @param commit - The commit metadata.
   * @param diff - The unified diff content.
   * @returns The classification and summary.
   */
  async enrichCommit(
    commit: CommitInfo,
    diff: string,
  ): Promise<EnrichmentResult> {
    const userMessage = buildUserMessage(commit, diff)

    let lastError: Error | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        })

        const text =
          response.content[0].type === "text" ? response.content[0].text : ""
        return parseEnrichmentResponse(text)
      } catch (error) {
        lastError = error as Error
        if (attempt < 2) {
          await new Promise((r) =>
            setTimeout(r, this.retryDelayMs * Math.pow(2, attempt)),
          )
        }
      }
    }
    throw lastError!
  }
}
