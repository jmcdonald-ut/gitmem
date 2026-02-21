import { Command } from "@commander-js/extra-typings"
import { render } from "ink"
import React from "react"

import { getAiCoverage } from "@/config"
import { NotFoundError, ValidationError } from "@/errors"
import { formatOutput } from "@/output"
import { addScopeOptions, resolveScope } from "@/scope"
import { TrendsCommand } from "@commands/trends/TrendsCommand"
import { runCommand } from "@commands/utils/command-context"
import { parsePositiveInt } from "@commands/utils/parse-int"
import type { WindowKey } from "@db/aggregates"
import { AggregateRepository, computeTrend } from "@db/aggregates"
import { CommitRepository } from "@db/commits"

const VALID_WINDOWS = ["weekly", "monthly", "quarterly"]

const HELP_TEXT = `
Trend direction indicators: increasing, decreasing, or stable — based
on recent vs earlier period averages.

Works for files, directories, or the entire repository (no path).
Use --window to change the time granularity.

Examples:
  gitmem trends
  gitmem trends src/db/commits.ts
  gitmem trends src/services/ --window weekly
  gitmem trends src/ --window quarterly --limit 8`

export const trendsCommand = addScopeOptions(
  new Command("trends")
    .alias("t")
    .argument("[path]", "File or directory path to inspect")
    .description("Show change velocity and classification mix over time")
    .addHelpText("after", HELP_TEXT)
    .option(
      "-w, --window <period>",
      "Time window: weekly, monthly, quarterly",
      "monthly",
    )
    .option(
      "-l, --limit <number>",
      "Number of most recent periods",
      parsePositiveInt,
      12,
    ),
).action(async (path, opts, cmd) => {
  await runCommand(cmd.parent!.opts(), {}, ({ format, db, config }) => {
    if (!VALID_WINDOWS.includes(opts.window)) {
      throw new ValidationError(
        `invalid window "${opts.window}". Valid values: ${VALID_WINDOWS.join(", ")}`,
      )
    }

    const commits = new CommitRepository(db)
    const aggregates = new AggregateRepository(db)
    const aiCoverage = getAiCoverage(
      config,
      commits.getEnrichedCommitCount(),
      commits.getTotalCommitCount(),
    )
    const limit = opts.limit
    const window = opts.window as WindowKey

    const flags = {
      include: opts.include,
      exclude: opts.exclude,
      all: opts.all,
    }
    const scope = resolveScope(flags, config.scope)

    if (!path) {
      // Global mode: trends across the entire repository
      const periods = aggregates.getTrendsForDirectory("", window, limit, scope)
      const trend = computeTrend(periods)
      const displayPath = "(repository)"

      if (
        formatOutput(format, {
          path: displayPath,
          type: "directory",
          window: opts.window,
          periods,
          trend,
        })
      )
        return

      render(
        <TrendsCommand
          path={displayPath}
          type="directory"
          window={opts.window}
          periods={periods}
          trend={trend}
          aiCoverage={aiCoverage}
        />,
      ).unmount()
      return
    }

    const fileStats = aggregates.getFileStats(path)
    let type: "file" | "directory"
    let periods
    let displayPath = path

    if (fileStats) {
      type = "file"
      periods = aggregates.getTrendsForFile(path, window, limit, scope)
    } else {
      const prefix = path.endsWith("/") ? path : path + "/"
      const fileCount = aggregates.getDirectoryFileCount(prefix)

      if (fileCount === 0) {
        throw new NotFoundError(`no indexed data found for "${path}"`)
      }

      type = "directory"
      periods = aggregates.getTrendsForDirectory(prefix, window, limit, scope)
      displayPath = prefix
    }

    const trend = computeTrend(periods)

    if (
      formatOutput(format, {
        path: displayPath,
        type,
        window: opts.window,
        periods,
        trend,
      })
    )
      return

    render(
      <TrendsCommand
        path={displayPath}
        type={type}
        window={opts.window}
        periods={periods}
        trend={trend}
        aiCoverage={aiCoverage}
      />,
    ).unmount()
  })
})
