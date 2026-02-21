import { Command } from "@commander-js/extra-typings"
import { render } from "ink"
import React from "react"

import { NotFoundError } from "@/errors"
import {
  filterPairsByTrackedFiles,
  resolveExcludedCategories,
} from "@/file-filter"
import { formatOutput } from "@/output"
import { CouplingCommand } from "@commands/coupling/CouplingCommand"
import { runCommand } from "@commands/utils/command-context"
import { parsePositiveInt } from "@commands/utils/parse-int"
import { AggregateRepository } from "@db/aggregates"

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
  .option("-l, --limit <number>", "Max results", parsePositiveInt, 10)
  .option("--include-tests", "Include test files (excluded by default)")
  .option("--include-docs", "Include documentation files (excluded by default)")
  .option(
    "--include-generated",
    "Include generated/vendored files (excluded by default)",
  )
  .option("--all", "Include all files (no exclusions)")
  .option("--include-deleted", "Include files no longer in the working tree")
  .action(async (path, opts, cmd) => {
    await runCommand(cmd.parent!.opts(), {}, async ({ format, db, git }) => {
      const aggregates = new AggregateRepository(db)
      const limit = opts.limit
      const exclude = resolveExcludedCategories(opts)

      const trackedFiles = opts.includeDeleted
        ? undefined
        : new Set(await git.getTrackedFiles())
      const fetchLimit = trackedFiles ? 10000 : limit

      if (!path) {
        const raw = aggregates.getTopCoupledPairs(fetchLimit, exclude)
        const pairs = trackedFiles
          ? filterPairsByTrackedFiles(raw, trackedFiles, limit)
          : raw

        if (formatOutput(format, { path: null, pairs })) return

        render(<CouplingCommand path={null} pairs={pairs} />).unmount()
      } else {
        const fileStats = aggregates.getFileStats(path)
        if (fileStats) {
          const raw = aggregates.getCoupledFilesWithRatio(
            path,
            fetchLimit,
            exclude,
          )
          const pairs = trackedFiles
            ? raw.filter((r) => trackedFiles.has(r.file)).slice(0, limit)
            : raw

          if (formatOutput(format, { path, pairs })) return

          render(<CouplingCommand path={path} pairs={pairs} />).unmount()
        } else {
          const prefix = path.endsWith("/") ? path : path + "/"
          const fileCount = aggregates.getDirectoryFileCount(prefix)

          if (fileCount === 0) {
            throw new NotFoundError(`no indexed data found for "${path}"`)
          }

          const raw = aggregates.getCoupledFilesForDirectory(
            prefix,
            fetchLimit,
            exclude,
          )
          const pairs = trackedFiles
            ? raw.filter((r) => trackedFiles.has(r.file)).slice(0, limit)
            : raw

          if (formatOutput(format, { path: prefix, pairs })) return

          render(<CouplingCommand path={prefix} pairs={pairs} />).unmount()
        }
      }
    })
  })
