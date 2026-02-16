import { Command } from "commander"
import React from "react"
import { render } from "ink"
import { runCommand } from "@commands/utils/command-context"
import { formatOutput } from "@/output"
import { AggregateRepository } from "@db/aggregates"
import { CouplingCommand } from "@commands/coupling/CouplingCommand"

const HELP_TEXT = `
Co-change means two files were modified in the same commit. High
coupling can indicate hidden dependencies.

Three modes:
  gitmem coupling                global top pairs
  gitmem coupling <file>         files most coupled to a specific file
  gitmem coupling <directory>    top pairs within a directory

Examples:
  gitmem coupling
  gitmem coupling src/db/commits.ts
  gitmem coupling src/services/`

export const couplingCommand = new Command("coupling")
  .alias("c")
  .argument("[path]", "File or directory path")
  .description("Show files that frequently change together")
  .addHelpText("after", HELP_TEXT)
  .option("-l, --limit <number>", "Max results", "10")
  .action(async (path, opts, cmd) => {
    await runCommand(cmd.parent!.opts(), {}, async ({ format, db }) => {
      const aggregates = new AggregateRepository(db)
      const limit = parseInt(opts.limit, 10)

      if (!path) {
        const pairs = aggregates.getTopCoupledPairs(limit)

        if (formatOutput(format, { path: null, pairs })) return

        render(<CouplingCommand path={null} pairs={pairs} />).unmount()
      } else {
        const fileStats = aggregates.getFileStats(path)
        if (fileStats) {
          const pairs = aggregates.getCoupledFilesWithRatio(path, limit)

          if (formatOutput(format, { path, pairs })) return

          render(<CouplingCommand path={path} pairs={pairs} />).unmount()
        } else {
          const prefix = path.endsWith("/") ? path : path + "/"
          const fileCount = aggregates.getDirectoryFileCount(prefix)

          if (fileCount === 0) {
            console.error(`Error: no indexed data found for "${path}"`)
            process.exit(1)
          }

          const pairs = aggregates.getCoupledFilesForDirectory(prefix, limit)

          if (formatOutput(format, { path: prefix, pairs })) return

          render(<CouplingCommand path={prefix} pairs={pairs} />).unmount()
        }
      }
    })
  })
