import { describe, test, expect } from "bun:test"
import { getSkillContent } from "@commands/generate/skill-content"

describe("getSkillContent", () => {
  const content = getSkillContent()

  test("includes frontmatter with name and description", () => {
    expect(content).toMatch(/^---\n/)
    expect(content).toContain("name: use-gitmem")
    expect(content).toContain("description:")
  })

  test("mentions all query-side commands", () => {
    expect(content).toContain("gitmem query")
    expect(content).toContain("gitmem hotspots")
    expect(content).toContain("gitmem coupling")
    expect(content).toContain("gitmem trends")
    expect(content).toContain("gitmem stats")
    expect(content).toContain("gitmem status")
    expect(content).toContain("gitmem schema")
  })

  test("mentions --json flag for machine-readable output", () => {
    expect(content).toContain("--json")
  })

  test("includes setup instructions", () => {
    expect(content).toContain("gitmem index")
    expect(content).toContain("ANTHROPIC_API_KEY")
  })

  test("describes search triggers in frontmatter description", () => {
    const frontmatterMatch = content.match(/---\n([\s\S]*?)\n---/)
    expect(frontmatterMatch).not.toBeNull()
    const frontmatter = frontmatterMatch![1]
    expect(frontmatter).toContain("git history")
    expect(frontmatter).toContain("hotspots")
    expect(frontmatter).toContain("coupling")
    expect(frontmatter).toContain("trends")
  })
})
