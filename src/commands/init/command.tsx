import { Command } from "@commander-js/extra-typings"
import { render } from "ink"
import { resolve } from "path"
import React from "react"

import { type GitmemConfig, createConfig } from "@/config"
import { formatOutput } from "@/output"
import { InitCommand } from "@commands/init/InitCommand"
import { runCommand } from "@commands/utils/command-context"
import { createDatabase } from "@db/database"

function parseAiValue(value: string): boolean | string {
  if (value === "true") return true
  if (value === "false") return false
  return value
}

const HELP_TEXT = `
Creates .gitmem/config.json and an empty .gitmem/index.db database.
Must be run before any other gitmem command (except schema and generate).

Examples:
  gitmem init
  gitmem init --ai false
  gitmem init --ai 2024-06-01
  gitmem init --index-start-date 2024-01-01`

export const initCommand = new Command("init")
  .description("Initialize gitmem in the current repository")
  .addHelpText("after", HELP_TEXT)
  .option(
    "--ai <value>",
    'AI enrichment: "true", "false", or YYYY-MM-DD',
    parseAiValue,
  )
  .option(
    "--index-start-date <date>",
    "Limit discovery to commits on/after this date",
  )
  .option("--index-model <model>", "Default model for gitmem index")
  .option("--check-model <model>", "Default model for gitmem check")
  .action(async (opts, cmd) => {
    await runCommand(
      cmd.parent!.opts(),
      { needsConfig: false, needsDb: false },
      ({ format, cwd }) => {
        const gitmemDir = resolve(cwd, ".gitmem")

        const overrides: Partial<GitmemConfig> = {}
        if (opts.ai !== undefined) overrides.ai = opts.ai
        if (opts.indexStartDate !== undefined)
          overrides.indexStartDate = opts.indexStartDate
        if (opts.indexModel !== undefined)
          overrides.indexModel = opts.indexModel
        if (opts.checkModel !== undefined)
          overrides.checkModel = opts.checkModel

        const config = createConfig(
          gitmemDir,
          Object.keys(overrides).length > 0 ? overrides : undefined,
        )

        const dbPath = resolve(gitmemDir, "index.db")
        const db = createDatabase(dbPath)
        db.close()

        if (formatOutput(format, { success: true, config })) return

        render(<InitCommand config={config} />).unmount()
      },
    )
  })
