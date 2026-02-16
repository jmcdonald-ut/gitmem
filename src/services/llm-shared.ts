import type { CommitInfo, EnrichmentResult, Classification } from "@/types"
import { CLASSIFICATIONS } from "@/types"

/** System prompt used for all LLM commit enrichment requests. */
export const SYSTEM_PROMPT = `You are a git commit analyzer. Given a commit message, file list, and diff, classify the commit and provide a brief summary.

Respond with valid JSON only, no markdown fences. Use this exact format:
{"classification": "<type>", "summary": "<1-2 sentence summary>"}

Classification must be one of: ${CLASSIFICATIONS.join(", ")}

Classification guidelines:
- bug-fix: fixes a defect, corrects broken behavior, or restores intended functionality
- feature: adds new user-facing functionality or capabilities that did not exist before
- refactor: restructures existing code without changing external behavior (internal improvements only)
- docs: changes to documentation content meant for humans to read (README, guides, tutorials, API docs)
- chore: maintenance tasks — dependency updates, CI config, version bumps, merge commits, build tooling, changelogs, release notes, repo infrastructure (.github/*, PR templates, issue templates, .editorconfig)
- perf: changes that improve efficiency or reduce resource usage, even small ones like moving work outside a loop
- test: adds or modifies test files without changing production code
- style: purely cosmetic changes — formatting, whitespace, semicolons, naming conventions, linting fixes. Must have zero semantic or behavioral effect.

Edge case rules:
- Merge commits (message starts with "Merge") should be classified as "chore".
- When a commit spans multiple categories, classify by its primary purpose (the most significant change).
- IMPORTANT: Always trust the diff over the commit message. If the message says "fix" but the diff shows only a refactor, classify as "refactor". If the message says "v3 alpha" but the diff only adds an empty object, describe only what the diff shows.
- Improving existing behavior or internal implementation without adding new user-facing capability is "refactor", not "feature".
- Changing existing error messages, validation messages, or user-facing text wording is "style", not "feature". Only classify as "feature" if entirely new message types or validation rules are added.
- CHANGELOG and release note updates are "chore", not "docs". These are release process artifacts, not user documentation.
- Adding or configuring dev tooling (linters, git hooks, formatters, CI pipelines) is "chore", not "feature".
- Moving code for efficiency (e.g. hoisting an assignment out of a loop) is "perf", not "style".

Summary guidelines:
- Base your summary on the actual diff content, not just the commit message.
- If the diff is empty or missing, state that clearly rather than speculating about what changed.
- Mention the most important files or components affected.
- Do not speculate about changes you cannot see in the diff.
- Describe what changed, not why. Do not infer motivation, performance impact, or version changes unless explicitly visible in the diff.
- Never claim something was "fixed", "improved", or "optimized" unless the diff evidence supports it.`

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
