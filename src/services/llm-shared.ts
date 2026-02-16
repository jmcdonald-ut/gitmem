import type { CommitInfo, EnrichmentResult, Classification } from "@/types"
import { CLASSIFICATIONS } from "@/types"

/** System prompt used for all LLM commit enrichment requests. */
export const SYSTEM_PROMPT = `You are a git commit analyzer. Given a commit message and diff, classify the commit and provide a brief summary.

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

/**
 * Builds the user message sent to the LLM for commit enrichment.
 * @param commit - The commit metadata.
 * @param diff - The unified diff content.
 * @returns The formatted user message string.
 */
export function buildUserMessage(commit: CommitInfo, diff: string): string {
  return `Commit message: ${commit.message}

Files changed: ${commit.files.map((f) => f.filePath).join(", ")}

Diff:
${diff}`
}

/**
 * Parses the LLM JSON response into an EnrichmentResult,
 * stripping any markdown fences and validating the classification.
 * @param text - Raw text response from the LLM.
 * @returns The parsed enrichment result.
 */
export function parseEnrichmentResponse(text: string): EnrichmentResult {
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
