import { Command } from "commander"
import React from "react"
import { render } from "ink"
import { runCommand } from "@commands/utils/command-context"
import { parsePositiveInt } from "@commands/utils/parse-int"
import { formatOutput } from "@/output"
import { AggregateRepository } from "@db/aggregates"
import { HotspotsCommand } from "@commands/hotspots/HotspotsCommand"
import {
  resolveExcludedCategories,
  filterByTrackedFiles,
} from "@services/file-filter"

const VALID_SORT_FIELDS = [
  "total",
  "bug-fix",
  "feature",
  "refactor",
  "docs",
  "chore",
  "perf",
  "test",
  "style",
  "complexity",
  "combined",
]

const HELP_TEXT = `
Hotspots highlight files with the most commits — indicators of churn,
risk, or active development.

Sort by a classification type to surface e.g. the buggiest files.
Sort by complexity to find the most complex files, or combined to
find files that are both frequently changed AND complex.

Examples:
  gitmem hotspots
  gitmem hotspots --sort bug-fix
  gitmem hotspots --sort complexity
  gitmem hotspots --sort combined
  gitmem hotspots --path src/services/ --limit 20`

export const hotspotsCommand = new Command("hotspots")
  .alias("h")
  .description("Show most-changed files with classification breakdown")
  .addHelpText("after", HELP_TEXT)
  .option(
    "--sort <field>",
    "Sort by: total, bug-fix, feature, refactor, docs, chore, perf, test, style, complexity, combined",
    "total",
  )
  .option("--path <prefix>", "Filter by directory prefix")
  .option("-l, --limit <number>", "Max results", parsePositiveInt, 10)
  .option("--include-tests", "Include test files (excluded by default)")
  .option("--include-docs", "Include documentation files (excluded by default)")
  .option(
    "--include-generated",
    "Include generated/vendored files (excluded by default)",
  )
  .option("--all", "Include all files (no exclusions)")
  .option("--include-deleted", "Include files no longer in the working tree")
  .action(async (opts, cmd) => {
    if (!VALID_SORT_FIELDS.includes(opts.sort)) {
      console.error(
        `Error: invalid sort field "${opts.sort}". Valid values: ${VALID_SORT_FIELDS.join(", ")}`,
      )
      process.exit(1)
    }

    await runCommand(cmd.parent!.opts(), {}, async ({ format, db, git }) => {
      const aggregates = new AggregateRepository(db)
      const exclude = resolveExcludedCategories(opts)

      const fetchLimit = opts.includeDeleted ? opts.limit : 10000
      const hotspots = aggregates.getHotspots({
        limit: fetchLimit,
        sort: opts.sort,
        pathPrefix: opts.path,
        exclude,
      })

      const filtered = opts.includeDeleted
        ? hotspots
        : filterByTrackedFiles(
            hotspots,
            new Set(await git.getTrackedFiles()),
            opts.limit,
          )

      if (
        formatOutput(format, {
          sort: opts.sort,
          path: opts.path ?? null,
          hotspots: filtered,
        })
      )
        return

      render(
        <HotspotsCommand
          hotspots={filtered}
          sort={opts.sort}
          pathPrefix={opts.path}
        />,
      ).unmount()
    })
  })
