import { Command } from "commander"
import React from "react"
import { render } from "ink"
import { resolveFormat } from "@/output"
import { formatOutput } from "@/output"
import { SCHEMA } from "@/schema"
import { SchemaCommand } from "@commands/schema/SchemaCommand"

const HELP_TEXT = `
For writing custom SQL queries against the .gitmem/index.db database.

Tables: commits, file_stats, file_contributors, file_coupling,
commit_search, metadata, batch_jobs.

Example:
  gitmem schema --json`

export const schemaCommand = new Command("schema")
  .description("Display database schema documentation")
  .addHelpText("after", HELP_TEXT)
  .action(async (_opts, cmd) => {
    const format = resolveFormat(cmd.parent!.opts())

    if (formatOutput(format, { tables: SCHEMA })) return

    render(<SchemaCommand tables={SCHEMA} />).unmount()
  })
