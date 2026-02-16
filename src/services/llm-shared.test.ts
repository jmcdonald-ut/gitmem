import { describe, test, expect } from "bun:test"
import {
  SYSTEM_PROMPT,
  buildUserMessage,
  parseEnrichmentResponse,
} from "@services/llm-shared"
import type { CommitInfo } from "@/types"

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
})

describe("buildUserMessage", () => {
  test("includes commit message", () => {
    const msg = buildUserMessage(commit, "diff here")
    expect(msg).toContain("Commit message: fix auth bug")
  })

  test("includes file paths", () => {
    const msg = buildUserMessage(commit, "diff here")
    expect(msg).toContain("src/auth.ts, src/utils.ts")
  })

  test("includes diff content", () => {
    const msg = buildUserMessage(commit, "+const x = 1")
    expect(msg).toContain("+const x = 1")
  })

  test("handles empty files list", () => {
    const emptyCommit: CommitInfo = { ...commit, files: [] }
    const msg = buildUserMessage(emptyCommit, "diff")
    expect(msg).toContain("Files changed: ")
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

  test("strips markdown json fences", () => {
    const result = parseEnrichmentResponse(
      '```json\n{"classification": "feature", "summary": "Added login"}\n```',
    )
    expect(result.classification).toBe("feature")
    expect(result.summary).toBe("Added login")
  })

  test("strips markdown fences without language tag", () => {
    const result = parseEnrichmentResponse(
      '```\n{"classification": "refactor", "summary": "Cleaned up"}\n```',
    )
    expect(result.classification).toBe("refactor")
    expect(result.summary).toBe("Cleaned up")
  })

  test("defaults unknown classification to chore", () => {
    const result = parseEnrichmentResponse(
      '{"classification": "unknown-type", "summary": "Something"}',
    )
    expect(result.classification).toBe("chore")
  })

  test("defaults non-string summary to 'No summary'", () => {
    const result = parseEnrichmentResponse(
      '{"classification": "chore", "summary": 123}',
    )
    expect(result.summary).toBe("No summary")
  })

  test("throws on invalid JSON", () => {
    expect(() => parseEnrichmentResponse("not json")).toThrow()
  })
})
