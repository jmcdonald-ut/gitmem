import { Command } from "@commander-js/extra-typings"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import { render } from "ink"
import { join, relative } from "path"
import React from "react"

import { formatOutput } from "@/output"
import { GenerateSkillCommand } from "@commands/generate/GenerateSkillCommand"
import { getSkillContent } from "@commands/generate/skill-content"
import type { GitmemCommandOpts } from "@commands/gitmem"
import { runCommand } from "@commands/utils/command-context"

export interface GenerateSkillOptions {
  repoRoot: string
  out?: string
  force?: boolean
}

type GenerateSkillResult =
  | { ok: true; skillDir: string; skillPath: string }
  | { ok: false; skillDir: string; skillPath: string; error: string }

export function generateSkill(opts: GenerateSkillOptions): GenerateSkillResult {
  const skillDir =
    opts.out ?? join(opts.repoRoot, ".claude", "skills", "use-gitmem")
  const skillPath = join(skillDir, "SKILL.md")

  if (existsSync(skillPath) && !opts.force) {
    return {
      ok: false,
      skillDir,
      skillPath,
      error: `Skill already exists at ${skillPath}\nUse --force to overwrite`,
    }
  }

  try {
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(skillPath, getSkillContent())
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      skillDir,
      skillPath,
      error: `Failed to write skill file: ${message}`,
    }
  }

  return { ok: true, skillDir, skillPath }
}

const SKILL_HELP_TEXT = `
Writes a SKILL.md file so Claude Code can discover and use gitmem commands
for codebase analysis. Default location: .claude/skills/use-gitmem/SKILL.md

Examples:
  gitmem generate skill
  gitmem generate skill --force
  gitmem generate skill --out ./custom/skill-dir`

const skillCommand = new Command<
  [],
  Omit<GenerateSkillOptions, "repoRoot">,
  GitmemCommandOpts
>("skill")
  .description("Generate a Claude Code skill file for this repository")
  .option("-f, --force", "Overwrite existing skill file")
  .option("-o, --out <path>", "Output directory for the skill file")
  .addHelpText("after", SKILL_HELP_TEXT)
  .action(async (opts, cmd) => {
    await runCommand(
      cmd.optsWithGlobals(),
      { needsGit: true, needsDb: false, needsConfig: false },
      async ({ format, git }) => {
        const repoRoot = await git.getRepoRoot()
        const result = generateSkill({
          repoRoot,
          out: opts.out,
          force: opts.force,
        })

        const displayPath = relative(process.cwd(), result.skillPath)
        if (formatOutput(format, result)) return

        render(
          <GenerateSkillCommand
            error={result.ok ? undefined : result.error}
            skillPath={displayPath}
          />,
        ).unmount()
      },
    )
  })

export const generateCommand = new Command("generate")
  .description("Generate project files")
  .addCommand(skillCommand)
