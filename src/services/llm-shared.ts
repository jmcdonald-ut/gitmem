import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { z } from "zod"

import type { CommitInfo, EnrichmentResult } from "@/types"
import { CLASSIFICATIONS } from "@/types"

export const EnrichmentSchema = z.object({
  classification: z.enum(CLASSIFICATIONS),
  summary: z.string(),
})

export const ENRICHMENT_OUTPUT_CONFIG = {
  format: zodOutputFormat(EnrichmentSchema),
}

/** System prompt used for all LLM commit enrichment requests. */
export const SYSTEM_PROMPT = `You are a git commit analyzer. Given a commit message, file list, and diff, classify the commit and provide a brief summary.

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
- Removing deprecated code or making breaking API changes is "chore", not "refactor". True refactors preserve external behavior.
- Adding locale/translation files for an existing feature is "chore", not "feature". The feature already exists; adding a translation is maintenance.
- Updating existing locale/translation text is "style", not "docs". Locale files are runtime UI strings, not documentation.
- Regenerating test fixtures or snapshots without changing test logic is "chore", not "test".
- Fixing broken links, broken builds, or broken configs is "bug-fix" regardless of which file type contains the fix.
- Classify by the purpose of the change, not the file type. A config file change that fixes a broken doc site is "bug-fix", not "docs" or "chore".

Summary guidelines:
- Base your summary on the actual diff content, not just the commit message.
- If the diff is empty or missing, state that clearly rather than speculating about what changed.
- Mention the most important files or components affected.
- Do not speculate about changes you cannot see in the diff.
- Describe what changed, not why. Do not infer motivation, performance impact, or version changes unless explicitly visible in the diff.
- Never claim something was "fixed", "improved", or "optimized" unless the diff evidence supports it.`

const MAX_INPUT_TOKENS = 175_000
const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Builds the user message sent to the LLM for commit enrichment.
 * Truncates the diff and/or file list if the estimated token count exceeds the limit.
 * @param commit - The commit metadata.
 * @param diff - The unified diff content.
 * @returns The formatted user message string.
 */
export function buildUserMessage(commit: CommitInfo, diff: string): string {
  const fileEntries = commit.files.map(
    (f) => `${f.changeType} ${f.filePath} (+${f.additions} -${f.deletions})`,
  )
  let fileList = fileEntries.join("\n  ")
  let truncatedDiff = diff

  const buildMessage = (fl: string, d: string) =>
    `Commit message: ${commit.message}\n\nFiles changed:\n  ${fl}\n\nDiff:\n${d}`

  const totalEstimate = estimateTokens(
    SYSTEM_PROMPT + buildMessage(fileList, truncatedDiff),
  )

  if (totalEstimate > MAX_INPUT_TOKENS) {
    // First: truncate the diff
    const diffSuffix = "\n[diff truncated]"
    const overhead = estimateTokens(
      SYSTEM_PROMPT + buildMessage(fileList, diffSuffix),
    )
    const availableForDiff = Math.max(0, MAX_INPUT_TOKENS - overhead)
    const maxDiffChars = availableForDiff * CHARS_PER_TOKEN
    if (diff.length > maxDiffChars) {
      truncatedDiff = diff.slice(0, maxDiffChars) + diffSuffix
    }

    // Second: if the file list alone exceeds the budget, omit diff and truncate files
    const fileListOnlyEstimate = estimateTokens(
      SYSTEM_PROMPT + buildMessage(fileList, ""),
    )
    if (fileListOnlyEstimate > MAX_INPUT_TOKENS) {
      truncatedDiff = "[diff omitted — message too large]"
      const overheadNoDiff = estimateTokens(
        SYSTEM_PROMPT + buildMessage("", truncatedDiff),
      )
      const availableForFiles = Math.max(0, MAX_INPUT_TOKENS - overheadNoDiff)
      const maxFileChars = availableForFiles * CHARS_PER_TOKEN
      let accumulated = ""
      let kept = 0
      for (const entry of fileEntries) {
        const next = kept === 0 ? entry : accumulated + "\n  " + entry
        if (next.length > maxFileChars) break
        accumulated = next
        kept++
      }
      const omitted = fileEntries.length - kept
      fileList =
        omitted > 0
          ? accumulated + `\n  ... and ${omitted} more files`
          : accumulated
    }
  }

  return buildMessage(fileList, truncatedDiff)
}

/**
 * Parses the LLM JSON response into an EnrichmentResult.
 * With structured outputs, the API guarantees valid JSON matching the schema.
 * @param text - Raw text response from the LLM.
 * @returns The parsed enrichment result.
 */
export function parseEnrichmentResponse(text: string): EnrichmentResult {
  return JSON.parse(text) as EnrichmentResult
}
