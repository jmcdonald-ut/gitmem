import { Command } from "commander"
import React from "react"
import { render } from "ink"
import { runCommand } from "@commands/utils/command-context"
import { parsePositiveInt } from "@commands/utils/parse-int"
import { formatOutput } from "@/output"
import { AggregateRepository } from "@db/aggregates"
import { CommitRepository } from "@db/commits"
import { StatsCommand } from "@commands/stats/StatsCommand"

const HELP_TEXT = `
File mode: classification breakdown, top contributors, recent commits.
Directory mode: aggregate stats, file count, top contributors, and
hottest files within that directory.

--limit controls the size of sub-lists (contributors, recent commits,
top files). Default: 5.

Examples:
  gitmem stats src/db/commits.ts
  gitmem stats src/services/`

export const statsCommand = new Command("stats")
  .argument("<path>", "File or directory path to inspect")
  .option("-l, --limit <number>", "Limit sub-lists", parsePositiveInt, 5)
  .description("Show detailed change statistics for a file or directory")
  .addHelpText("after", HELP_TEXT)
  .action(async (path, opts, cmd) => {
    await runCommand(cmd.parent!.opts(), {}, async ({ format, db }) => {
      const aggregates = new AggregateRepository(db)
      const commits = new CommitRepository(db)
      const limit = opts.limit

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
          />,
        ).unmount()
      } else {
        const prefix = path.endsWith("/") ? path : path + "/"
        const fileCount = aggregates.getDirectoryFileCount(prefix)

        if (fileCount === 0) {
          console.error(`Error: no indexed data found for "${path}"`)
          process.exit(1)
        }

        const dirStats = aggregates.getDirectoryStats(prefix)!
        const contributors = aggregates.getDirectoryContributors(prefix, limit)
        const topFiles = aggregates.getHotspots({
          pathPrefix: prefix,
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
          />,
        ).unmount()
      }
    })
  })
