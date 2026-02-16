import { Command } from "commander"
import React from "react"
import { render } from "ink"
import { runCommand } from "@commands/utils/command-context"
import { formatOutput } from "@/output"
import { CommitRepository } from "@db/commits"
import { SearchService } from "@db/search"
import { QueryCommand } from "@commands/query/QueryCommand"

const HELP_TEXT = `
Uses SQLite FTS5 full-text search — no API calls at query time.

FTS5 query syntax:
  "exact phrase"          phrase match
  auth NOT oauth          boolean operators
  summary:performance     column filter (summary, classification, hash)

Examples:
  gitmem query "memory leak"
  gitmem query "refactor" --classification refactor
  gitmem query "auth NOT oauth" --limit 5`

export const queryCommand = new Command("query")
  .alias("q")
  .argument("<query>", "Search query")
  .option("-l, --limit <number>", "Max results", "20")
  .option(
    "--classification <type>",
    "Filter by classification (bug-fix, feature, refactor, docs, chore, perf, test, style)",
  )
  .description("Full-text search over enriched commits (no API calls)")
  .addHelpText("after", HELP_TEXT)
  .action(async (query, opts, cmd) => {
    await runCommand(cmd.parent!.opts(), {}, async ({ format, git, db }) => {
      const commits = new CommitRepository(db)
      const search = new SearchService(db)
      const branch = await git.getDefaultBranch()
      const totalCommits = await git.getTotalCommitCount(branch)
      const enrichedCommits = commits.getEnrichedCommitCount()
      const coveragePct =
        totalCommits > 0
          ? Math.round((enrichedCommits / totalCommits) * 100)
          : 0

      const classification: string | undefined = opts.classification
      const results = search.search(
        query,
        parseInt(opts.limit, 10),
        classification,
      )

      if (
        formatOutput(format, {
          query,
          classification_filter: classification ?? null,
          results,
          coveragePct,
        })
      )
        return

      render(
        <QueryCommand
          query={query}
          results={results}
          classificationFilter={classification}
          coveragePct={coveragePct}
        />,
      ).unmount()
    })
  })
