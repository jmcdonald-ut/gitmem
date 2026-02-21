import { Command } from "@commander-js/extra-typings"
import { render } from "ink"
import React from "react"

import { getAiCoverage } from "@/config"
import { NotFoundError } from "@/errors"
import { formatOutput } from "@/output"
import { addScopeOptions, resolveScope } from "@/scope"
import { StatsCommand } from "@commands/stats/StatsCommand"
import { runCommand } from "@commands/utils/command-context"
import { parsePositiveInt } from "@commands/utils/parse-int"
import { AggregateRepository } from "@db/aggregates"
import { CommitRepository } from "@db/commits"

const HELP_TEXT = `
File mode: classification breakdown, top contributors, recent commits.
Directory mode: aggregate stats, file count, top contributors, and
hottest files within that directory.
Global mode (no path): aggregate stats across the entire repository.

--limit controls the size of sub-lists (contributors, recent commits,
top files). Default: 5.

Examples:
  gitmem stats
  gitmem stats src/db/commits.ts
  gitmem stats src/services/
  gitmem stats -I src/ -X "*.test.*"`

export const statsCommand = addScopeOptions(
  new Command("stats")
    .argument("[path]", "File or directory path to inspect")
    .option("-l, --limit <number>", "Limit sub-lists", parsePositiveInt, 5)
    .description("Show detailed change statistics for a file or directory")
    .addHelpText("after", HELP_TEXT),
).action(async (path, opts, cmd) => {
  await runCommand(cmd.parent!.opts(), {}, ({ format, db, config }) => {
    const aggregates = new AggregateRepository(db)
    const commits = new CommitRepository(db)
    const aiCoverage = getAiCoverage(
      config,
      commits.getEnrichedCommitCount(),
      commits.getTotalCommitCount(),
    )
    const limit = opts.limit

    const flags = {
      include: path ? [path, ...opts.include] : opts.include,
      exclude: opts.exclude,
      all: opts.all,
    }
    const scope = resolveScope(flags, config.scope)

    if (!path) {
      // Global mode: aggregate stats across all files
      const dirStats = aggregates.getDirectoryStats("")
      if (!dirStats) {
        throw new NotFoundError("no indexed data found")
      }
      const fileCount = aggregates.getDirectoryFileCount("")
      const contributors = aggregates.getDirectoryContributors("", limit)
      const topFiles = aggregates.getHotspots({ scope, limit })

      const displayPath = "(repository)"

      if (
        formatOutput(format, {
          path: displayPath,
          type: "directory",
          file_count: fileCount,
          stats: dirStats,
          contributors,
          top_files: topFiles,
        })
      )
        return

      render(
        <StatsCommand
          path={displayPath}
          type="directory"
          fileCount={fileCount}
          stats={dirStats}
          contributors={contributors}
          topFiles={topFiles}
          aiCoverage={aiCoverage}
        />,
      ).unmount()
      return
    }

    const fileStats = aggregates.getFileStats(path)
    if (fileStats) {
      const contributors = aggregates.getTopContributors(path, limit)
      const recentCommits = commits.getRecentCommitsForFile(path, limit)

      if (
        formatOutput(format, {
          path,
          type: "file",
          stats: fileStats,
          contributors,
          recent_commits: recentCommits,
        })
      )
        return

      render(
        <StatsCommand
          path={path}
          type="file"
          stats={fileStats}
          contributors={contributors}
          recentCommits={recentCommits}
          aiCoverage={aiCoverage}
        />,
      ).unmount()
    } else {
      const prefix = path.endsWith("/") ? path : path + "/"
      const fileCount = aggregates.getDirectoryFileCount(prefix)

      if (fileCount === 0) {
        throw new NotFoundError(`no indexed data found for "${path}"`)
      }

      const dirStats = aggregates.getDirectoryStats(prefix)!
      const contributors = aggregates.getDirectoryContributors(prefix, limit)
      const topFiles = aggregates.getHotspots({
        scope: { include: [prefix], exclude: [] },
        limit,
      })

      if (
        formatOutput(format, {
          path: prefix,
          type: "directory",
          file_count: fileCount,
          stats: dirStats,
          contributors,
          top_files: topFiles,
        })
      )
        return

      render(
        <StatsCommand
          path={prefix}
          type="directory"
          fileCount={fileCount}
          stats={dirStats}
          contributors={contributors}
          topFiles={topFiles}
          aiCoverage={aiCoverage}
        />,
      ).unmount()
    }
  })
})
