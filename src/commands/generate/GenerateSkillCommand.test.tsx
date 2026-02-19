import { describe, test, expect } from "bun:test"
import React from "react"
import { render } from "ink-testing-library"
import { GenerateSkillCommand } from "@commands/generate/GenerateSkillCommand"

describe("GenerateSkillCommand", () => {
  test("displays the created skill path", () => {
    const { lastFrame } = render(
      <GenerateSkillCommand skillPath=".claude/skills/use-gitmem/SKILL.md" />,
    )
    const output = lastFrame()

    expect(output).toContain("Created")
    expect(output).toContain(".claude/skills/use-gitmem/SKILL.md")
  })

  test("shows guidance message", () => {
    const { lastFrame } = render(
      <GenerateSkillCommand skillPath=".claude/skills/use-gitmem/SKILL.md" />,
    )
    const output = lastFrame()

    expect(output).toContain("Claude Code")
    expect(output).toContain("gitmem")
  })
})
