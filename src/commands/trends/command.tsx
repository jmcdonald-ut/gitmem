import { Command } from "commander"
import React from "react"
import { render } from "ink"
import { runCommand } from "@commands/utils/command-context"
import { formatOutput } from "@/output"
import {
  AggregateRepository,
  computeTrend,
  WINDOW_FORMATS,
} from "@db/aggregates"
import { TrendsCommand } from "@commands/trends/TrendsCommand"

const VALID_WINDOWS = ["weekly", "monthly", "quarterly"]

const HELP_TEXT = `
Trend direction indicators: increasing, decreasing, or stable — based
on recent vs earlier period averages.

Works for both files and directories. Use --window to change the time
granularity.

Examples:
  gitmem trends src/db/commits.ts
  gitmem trends src/services/ --window weekly
  gitmem trends src/ --window quarterly --limit 8`

export const trendsCommand = new Command("trends")
  .alias("t")
  .argument("<path>", "File or directory path to inspect")
  .description("Show change velocity and classification mix over time")
  .addHelpText("after", HELP_TEXT)
  .option(
    "-w, --window <period>",
    "Time window: weekly, monthly, quarterly",
    "monthly",
  )
  .option("-l, --limit <number>", "Number of most recent periods", "12")
  .action(async (path, opts, cmd) => {
    if (!VALID_WINDOWS.includes(opts.window)) {
      console.error(
        `Error: invalid window "${opts.window}". Valid values: ${VALID_WINDOWS.join(", ")}`,
      )
      process.exit(1)
    }

    await runCommand(cmd.parent!.opts(), {}, async ({ format, db }) => {
      const aggregates = new AggregateRepository(db)
      const limit = parseInt(opts.limit, 10)
      const windowSql = WINDOW_FORMATS[opts.window]

      const fileStats = aggregates.getFileStats(path)
      let type: "file" | "directory"
      let periods

      if (fileStats) {
        type = "file"
        periods = aggregates.getTrendsForFile(path, windowSql, limit)
      } else {
        const prefix = path.endsWith("/") ? path : path + "/"
        const fileCount = aggregates.getDirectoryFileCount(prefix)

        if (fileCount === 0) {
          console.error(`Error: no indexed data found for "${path}"`)
          process.exit(1)
        }

        type = "directory"
        periods = aggregates.getTrendsForDirectory(prefix, windowSql, limit)
        path = prefix
      }

      const trend = computeTrend(periods)

      if (
        formatOutput(format, {
          path,
          type,
          window: opts.window,
          periods,
          trend,
        })
      )
        return

      render(
        <TrendsCommand
          path={path}
          type={type}
          window={opts.window}
          periods={periods}
          trend={trend}
        />,
      ).unmount()
    })
  })
