import { Command } from "@commander-js/extra-typings"
import { render } from "ink"
import React from "react"

import { getAiCoverage, isAiEnabled } from "@/config"
import { AiRequiredError, ValidationError } from "@/errors"
import { filterByTrackedFiles } from "@/file-filter"
import { formatOutput } from "@/output"
import { addScopeOptions, matchesScope, resolveScope } from "@/scope"
import { HotspotsCommand } from "@commands/hotspots/HotspotsCommand"
import { runCommand } from "@commands/utils/command-context"
import { parsePositiveInt } from "@commands/utils/parse-int"
import { AggregateRepository } from "@db/aggregates"
import { CommitRepository } from "@db/commits"

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
  gitmem hotspots src/services/ --limit 20
  gitmem hotspots -I src/ -X "*.test.*"`

export const hotspotsCommand = addScopeOptions(
  new Command("hotspots")
    .alias("h")
    .description("Show most-changed files with classification breakdown")
    .addHelpText("after", HELP_TEXT)
    .argument("[path]", "Scope to a directory prefix")
    .option(
      "--sort <field>",
      "Sort by: total, bug-fix, feature, refactor, docs, chore, perf, test, style, complexity, combined",
      "total",
    )
    .option("-l, --limit <number>", "Max results", parsePositiveInt, 10)
    .option("--include-deleted", "Include files no longer in the working tree"),
).action(async (path, opts, cmd) => {
  const CLASSIFICATION_SORT_FIELDS = [
    "bug-fix",
    "feature",
    "refactor",
    "docs",
    "chore",
    "perf",
    "test",
    "style",
  ]

  await runCommand(
    cmd.parent!.opts(),
    {},
    async ({ format, db, git, config }) => {
      if (!VALID_SORT_FIELDS.includes(opts.sort)) {
        throw new ValidationError(
          `invalid sort field "${opts.sort}". Valid values: ${VALID_SORT_FIELDS.join(", ")}`,
        )
      }

      if (
        CLASSIFICATION_SORT_FIELDS.includes(opts.sort) &&
        !isAiEnabled(config)
      ) {
        throw new AiRequiredError(
          `sorting by "${opts.sort}" requires AI enrichment, but AI is disabled in .gitmem/config.json`,
        )
      }

      const commits = new CommitRepository(db)
      const aggregates = new AggregateRepository(db)
      const aiCoverage = getAiCoverage(
        config,
        commits.getEnrichedCommitCount(),
        commits.getTotalCommitCount(),
      )

      const flags = {
        include: path ? [path, ...opts.include] : opts.include,
        exclude: opts.exclude,
        all: opts.all,
      }
      const scope = resolveScope(flags, config.scope)

      const fetchLimit = opts.includeDeleted ? opts.limit : 10000
      const hotspots = aggregates.getHotspots({
        limit: fetchLimit,
        sort: opts.sort,
        scope,
      })

      let filtered
      if (opts.includeDeleted) {
        filtered = hotspots
      } else {
        const trackedFiles = await git.getTrackedFiles()
        const scopedTracked = trackedFiles.filter((f) => matchesScope(f, scope))
        filtered = filterByTrackedFiles(
          hotspots,
          new Set(scopedTracked),
          opts.limit,
        )
      }

      const scopeLabel = path ?? undefined

      if (
        formatOutput(format, {
          sort: opts.sort,
          path: scopeLabel ?? null,
          hotspots: filtered,
        })
      )
        return

      render(
        <HotspotsCommand
          hotspots={filtered}
          sort={opts.sort}
          pathPrefix={scopeLabel}
          aiCoverage={aiCoverage}
        />,
      ).unmount()
    },
  )
})
