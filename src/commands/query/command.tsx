import { Command } from "@commander-js/extra-typings"
import { render } from "ink"
import React from "react"

import { isAiEnabled } from "@/config"
import { AiRequiredError } from "@/errors"
import { formatOutput } from "@/output"
import { QueryCommand } from "@commands/query/QueryCommand"
import { runCommand } from "@commands/utils/command-context"
import { parsePositiveInt } from "@commands/utils/parse-int"
import { CommitRepository } from "@db/commits"
import { SearchService } from "@db/search"

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
  .option("-l, --limit <number>", "Max results", parsePositiveInt, 20)
  .option(
    "--classification <type>",
    "Filter by classification (bug-fix, feature, refactor, docs, chore, perf, test, style)",
  )
  .description("Full-text search over indexed commits (no API calls)")
  .addHelpText("after", HELP_TEXT)
  .action(async (query, opts, cmd) => {
    await runCommand(
      cmd.parent!.opts(),
      {},
      async ({ format, git, db, config }) => {
        if (opts.classification && !isAiEnabled(config)) {
          throw new AiRequiredError(
            "--classification filter requires AI enrichment, but AI is disabled in .gitmem/config.json",
          )
        }

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
        const results = search.search(query, opts.limit, classification)

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
      },
    )
  })
