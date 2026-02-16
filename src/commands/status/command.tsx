import { Command } from "commander"
import React from "react"
import { render } from "ink"
import { statSync } from "fs"
import { runCommand } from "@commands/utils/command-context"
import { formatOutput } from "@/output"
import { CommitRepository } from "@db/commits"
import { StatusCommand } from "@commands/status/StatusCommand"
import type { StatusInfo } from "@/types"

const HELP_TEXT = `
Displays coverage percentage, enriched/total commit counts, last index
run timestamp, model used, and database path and size.

Requires a prior gitmem index run.`

export const statusCommand = new Command("status")
  .alias("s")
  .description("Show index health, coverage, and database statistics")
  .addHelpText("after", HELP_TEXT)
  .action(async (_opts, cmd) => {
    await runCommand(
      cmd.parent!.opts(),
      {},
      async ({ format, git, db, dbPath }) => {
        const commits = new CommitRepository(db)
        const branch = await git.getDefaultBranch()
        const totalCommits = await git.getTotalCommitCount(branch)

        const lastRun =
          db
            .query<
              { value: string },
              [string]
            >("SELECT value FROM metadata WHERE key = ?")
            .get("last_run")?.value ?? null

        const modelUsed =
          db
            .query<
              { value: string },
              [string]
            >("SELECT value FROM metadata WHERE key = ?")
            .get("model_used")?.value ?? null

        const dbSize = statSync(dbPath).size

        const status: StatusInfo = {
          totalCommits,
          indexedCommits: commits.getTotalCommitCount(),
          enrichedCommits: commits.getEnrichedCommitCount(),
          lastRun,
          modelUsed,
          dbPath,
          dbSize,
        }

        if (formatOutput(format, status)) return

        render(<StatusCommand status={status} />).unmount()
      },
    )
  })
