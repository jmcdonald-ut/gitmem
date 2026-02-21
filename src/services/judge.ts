import Anthropic from "@anthropic-ai/sdk"

import type { Classification, CommitInfo } from "@/types"
import {
  EVAL_OUTPUT_CONFIG,
  JUDGE_SYSTEM_PROMPT,
  buildJudgeUserMessage,
  parseEvalResponse,
} from "@services/judge-shared"
import type { EvaluationVerdicts, IJudgeService } from "@services/types"

/** Evaluates commit enrichment quality using the Anthropic API. */
export class JudgeService implements IJudgeService {
  private client: Anthropic
  private model: string

  /**
   * @param apiKey - Anthropic API key.
   * @param model - Model identifier to use for evaluation requests.
   */
  constructor(apiKey: string, model: string = "claude-sonnet-4-5-20250929") {
    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  /**
   * Sends a commit's metadata, diff, and enrichment to the judge for evaluation.
   * @param commit - The commit metadata.
   * @param diff - The unified diff content.
   * @param classification - The original enrichment classification.
   * @param summary - The original enrichment summary.
   * @returns The three evaluation verdicts.
   */
  async evaluateCommit(
    commit: CommitInfo,
    diff: string,
    classification: Classification,
    summary: string,
  ): Promise<EvaluationVerdicts> {
    const userMessage = buildJudgeUserMessage(
      commit,
      diff,
      classification,
      summary,
    )

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: JUDGE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      output_config: EVAL_OUTPUT_CONFIG,
    })

    const text =
      response.content[0].type === "text" ? response.content[0].text : ""
    return parseEvalResponse(text)
  }
}
