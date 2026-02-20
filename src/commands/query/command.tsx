import { Command } from "@commander-js/extra-typings"
import React from "react"
import { render } from "ink"
import { runCommand } from "@commands/utils/command-context"
import { parsePositiveInt } from "@commands/utils/parse-int"
import { formatOutput } from "@/output"
import { isAiEnabled } from "@/config"
import { CommitRepository } from "@db/commits"
import { SearchService, InvalidQueryError } from "@db/search"
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
          const msg =
            "Error: --classification filter requires AI enrichment, but AI is disabled in .gitmem/config.json"
          if (format === "json") {
            formatOutput("json", { success: false, error: msg })
          } else {
            console.error(msg)
          }
          process.exit(1)
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
        let results
        try {
          results = search.search(query, opts.limit, classification)
        } catch (error) {
          if (error instanceof InvalidQueryError) {
            console.error(`Error: ${error.message}`)
            console.error(
              'Hint: use quotes for phrases, e.g. gitmem query "memory leak"',
            )
            process.exit(1)
          }
          throw error
        }

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
