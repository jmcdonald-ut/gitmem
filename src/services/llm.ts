import Anthropic from "@anthropic-ai/sdk"
import type {
  CommitInfo,
  EnrichmentResult,
  ILLMService,
  Classification,
} from "@/types"
import { CLASSIFICATIONS } from "@/types"

const SYSTEM_PROMPT = `You are a git commit analyzer. Given a commit message and diff, classify the commit and provide a brief summary.

Respond with valid JSON only, no markdown fences. Use this exact format:
{"classification": "<type>", "summary": "<1-2 sentence summary>"}

Classification must be one of: ${CLASSIFICATIONS.join(", ")}

Guidelines:
- bug-fix: fixes a bug or error
- feature: adds new functionality
- refactor: restructures code without changing behavior
- docs: documentation changes
- chore: maintenance, config, dependencies
- perf: performance improvements
- test: adds or modifies tests
- style: formatting, whitespace, naming`

/** Classifies and summarizes git commits using the Anthropic API. */
export class LLMService implements ILLMService {
  private client: Anthropic
  private model: string

  /**
   * @param apiKey - Anthropic API key.
   * @param model - Model identifier to use for enrichment requests.
   */
  constructor(apiKey: string, model: string = "claude-haiku-4-5-20251001") {
    this.client = new Anthropic({ apiKey })
    this.model = model
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
    const userMessage = `Commit message: ${commit.message}

Files changed: ${commit.files.map((f) => f.filePath).join(", ")}

Diff:
${diff}`

    let lastError: Error | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 256,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        })

        const text =
          response.content[0].type === "text" ? response.content[0].text : ""
        return this.parseResponse(text)
      } catch (error) {
        lastError = error as Error
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)))
        }
      }
    }
    throw lastError!
  }

  /**
   * Parses the LLM JSON response into an EnrichmentResult,
   * stripping any markdown fences and validating the classification.
   * @param text - Raw text response from the LLM.
   */
  private parseResponse(text: string): EnrichmentResult {
    const stripped = text
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/, "")
    const parsed = JSON.parse(stripped)
    const classification = CLASSIFICATIONS.includes(parsed.classification)
      ? (parsed.classification as Classification)
      : "chore"
    const summary =
      typeof parsed.summary === "string" ? parsed.summary : "No summary"
    return { classification, summary }
  }
}
