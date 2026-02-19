import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { join } from "path"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { generateSkill } from "@commands/generate/command"
import { getSkillContent } from "@commands/generate/skill-content"

describe("generateSkill", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gitmem-test-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("writes SKILL.md to default path", () => {
    const result = generateSkill({ repoRoot: tempDir })

    expect(result.skillDir).toBe(
      join(tempDir, ".claude", "skills", "use-gitmem"),
    )
    expect(result.skillPath).toBe(
      join(tempDir, ".claude", "skills", "use-gitmem", "SKILL.md"),
    )
    expect(existsSync(result.skillPath)).toBe(true)
    expect(readFileSync(result.skillPath, "utf-8")).toBe(getSkillContent())
  })

  test("errors when skill exists without --force", () => {
    generateSkill({ repoRoot: tempDir })

    expect(() => generateSkill({ repoRoot: tempDir })).toThrow(
      "Skill already exists",
    )
    expect(() => generateSkill({ repoRoot: tempDir })).toThrow("--force")
  })

  test("overwrites with --force", () => {
    generateSkill({ repoRoot: tempDir })
    const result = generateSkill({ repoRoot: tempDir, force: true })

    expect(existsSync(result.skillPath)).toBe(true)
    expect(readFileSync(result.skillPath, "utf-8")).toBe(getSkillContent())
  })

  test("respects --out path", () => {
    const customDir = join(tempDir, "custom", "skill-dir")
    const result = generateSkill({ repoRoot: tempDir, out: customDir })

    expect(result.skillDir).toBe(customDir)
    expect(result.skillPath).toBe(join(customDir, "SKILL.md"))
    expect(existsSync(result.skillPath)).toBe(true)
  })

  test("creates nested directories", () => {
    const deepDir = join(tempDir, "a", "b", "c")
    const result = generateSkill({ repoRoot: tempDir, out: deepDir })

    expect(existsSync(result.skillPath)).toBe(true)
  })
})
