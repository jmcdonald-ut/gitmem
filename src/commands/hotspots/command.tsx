import { Command } from "commander"
import React from "react"
import { render } from "ink"
import { runCommand } from "@commands/utils/command-context"
import { formatOutput } from "@/output"
import { AggregateRepository } from "@db/aggregates"
import { HotspotsCommand } from "@commands/hotspots/HotspotsCommand"

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
  .option("-l, --limit <number>", "Max results", "10")
  .action(async (opts, cmd) => {
    if (!VALID_SORT_FIELDS.includes(opts.sort)) {
      console.error(
        `Error: invalid sort field "${opts.sort}". Valid values: ${VALID_SORT_FIELDS.join(", ")}`,
      )
      process.exit(1)
    }

    await runCommand(cmd.parent!.opts(), {}, async ({ format, db }) => {
      const aggregates = new AggregateRepository(db)

      const hotspots = aggregates.getHotspots({
        limit: parseInt(opts.limit, 10),
        sort: opts.sort,
        pathPrefix: opts.path,
      })

      if (
        formatOutput(format, {
          sort: opts.sort,
          path: opts.path ?? null,
          hotspots,
        })
      )
        return

      render(
        <HotspotsCommand
          hotspots={hotspots}
          sort={opts.sort}
          pathPrefix={opts.path}
        />,
      ).unmount()
    })
  })
