import { describe, expect, test } from "bun:test"

import type { CommitInfo } from "@/types"
import {
  EnrichmentSchema,
  SYSTEM_PROMPT,
  buildUserMessage,
  estimateTokens,
  parseEnrichmentResponse,
} from "@services/llm-shared"

const commit: CommitInfo = {
  hash: "abc123",
  authorName: "Test",
  authorEmail: "test@example.com",
  committedAt: "2024-01-01",
  message: "fix auth bug",
  files: [
    { filePath: "src/auth.ts", changeType: "M", additions: 5, deletions: 2 },
    { filePath: "src/utils.ts", changeType: "M", additions: 1, deletions: 0 },
  ],
}

describe("SYSTEM_PROMPT", () => {
  test("contains all classification types", () => {
    expect(SYSTEM_PROMPT).toContain("bug-fix")
    expect(SYSTEM_PROMPT).toContain("feature")
    expect(SYSTEM_PROMPT).toContain("refactor")
    expect(SYSTEM_PROMPT).toContain("chore")
  })

  test("contains edge case rules", () => {
    expect(SYSTEM_PROMPT).toContain("Merge")
    expect(SYSTEM_PROMPT).toContain("primary purpose")
    expect(SYSTEM_PROMPT).toContain("trust the diff")
  })

  test("contains summary grounding instructions", () => {
    expect(SYSTEM_PROMPT).toContain("actual diff content")
    expect(SYSTEM_PROMPT).toContain("Do not speculate")
  })

  test("does not contain JSON format instructions (handled by structured outputs)", () => {
    expect(SYSTEM_PROMPT).not.toContain("Respond with valid JSON only")
    expect(SYSTEM_PROMPT).not.toContain("markdown fences")
  })
})

describe("EnrichmentSchema", () => {
  test("validates valid enrichment result", () => {
    const result = EnrichmentSchema.safeParse({
      classification: "bug-fix",
      summary: "Fixed null pointer",
    })
    expect(result.success).toBe(true)
  })

  test("rejects invalid classification", () => {
    const result = EnrichmentSchema.safeParse({
      classification: "unknown-type",
      summary: "Something",
    })
    expect(result.success).toBe(false)
  })
})

describe("buildUserMessage", () => {
  test("includes commit message", () => {
    const msg = buildUserMessage(commit, "diff here")
    expect(msg).toContain("Commit message: fix auth bug")
  })

  test("includes file paths with change types and line counts", () => {
    const msg = buildUserMessage(commit, "diff here")
    expect(msg).toContain("M src/auth.ts (+5 -2)")
    expect(msg).toContain("M src/utils.ts (+1 -0)")
  })

  test("includes diff content", () => {
    const msg = buildUserMessage(commit, "+const x = 1")
    expect(msg).toContain("+const x = 1")
  })

  test("handles empty files list", () => {
    const emptyCommit: CommitInfo = { ...commit, files: [] }
    const msg = buildUserMessage(emptyCommit, "diff")
    expect(msg).toContain("Files changed:")
  })

  test("truncates oversized diff", () => {
    // Create a small commit with a huge diff
    const smallCommit: CommitInfo = {
      ...commit,
      files: [
        {
          filePath: "src/a.ts",
          changeType: "M",
          additions: 1,
          deletions: 0,
        },
      ],
    }
    // ~750k chars = ~187k tokens, exceeding 175k limit
    const hugeDiff = "x".repeat(750_000)
    const msg = buildUserMessage(smallCommit, hugeDiff)
    expect(msg.length).toBeLessThan(750_000)
    expect(msg).toContain("[diff truncated]")
  })

  test("omits diff and truncates file list when files alone exceed limit", () => {
    // Create commit with thousands of files
    const manyFiles = Array.from({ length: 20_000 }, (_, i) => ({
      filePath: `src/very/deeply/nested/directory/structure/file-${String(i).padStart(5, "0")}.ts`,
      changeType: "M",
      additions: 100,
      deletions: 50,
    }))
    const hugeCommit: CommitInfo = { ...commit, files: manyFiles }
    const msg = buildUserMessage(hugeCommit, "small diff")
    expect(msg).toContain("more files")
    expect(msg).toContain("[diff omitted")
  })

  test("does not truncate when under limit", () => {
    const msg = buildUserMessage(commit, "small diff")
    expect(msg).not.toContain("[diff truncated]")
    expect(msg).not.toContain("more files")
  })
})

describe("estimateTokens", () => {
  test("estimates tokens at 4 chars per token", () => {
    expect(estimateTokens("abcd")).toBe(1)
    expect(estimateTokens("abcde")).toBe(2)
    expect(estimateTokens("")).toBe(0)
  })
})

describe("parseEnrichmentResponse", () => {
  test("parses valid JSON response", () => {
    const result = parseEnrichmentResponse(
      '{"classification": "bug-fix", "summary": "Fixed null pointer"}',
    )
    expect(result.classification).toBe("bug-fix")
    expect(result.summary).toBe("Fixed null pointer")
  })

  test("throws on invalid JSON", () => {
    expect(() => parseEnrichmentResponse("not json")).toThrow()
  })
})
