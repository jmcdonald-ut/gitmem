import { Command } from "@commander-js/extra-typings"
import { render } from "ink"
import React from "react"

import { isAiEnabled } from "@/config"
import { formatOutput } from "@/output"
import { BatchIndexCommand } from "@commands/index/BatchIndexCommand"
import { IndexCommand } from "@commands/index/IndexCommand"
import { runCommand } from "@commands/utils/command-context"
import { parsePositiveInt } from "@commands/utils/parse-int"
import { AggregateRepository } from "@db/aggregates"
import { BatchJobRepository } from "@db/batch-jobs"
import { CommitRepository } from "@db/commits"
import { SearchService } from "@db/search"
import { BatchLLMService } from "@services/batch-llm"
import { EnricherService } from "@services/enricher"
import { LLMService } from "@services/llm"
import { MeasurerService } from "@services/measurer"

const HELP_TEXT = `
Requires ANTHROPIC_API_KEY environment variable (unless AI is disabled
in .gitmem/config.json).

Indexing is incremental — only new commits are analyzed. Re-running is
safe and will pick up where it left off.

Batch mode (--batch) submits all work to the Anthropic Message Batches
API at 50% cost, but results are asynchronous. Run the command again
to poll for completion.

Examples:
  gitmem index                                       # default (haiku)
  gitmem index --batch                               # async batch, 50% cheaper
  gitmem index --model claude-sonnet-4-5-20250929    # use a different model`

export const indexCommand = new Command("index")
  .alias("i")
  .description("Analyze new commits via Claude API and rebuild search index")
  .addHelpText("after", HELP_TEXT)
  .option("-m, --model <model>", "LLM model to use")
  .option(
    "-c, --concurrency <number>",
    "Number of parallel LLM requests",
    parsePositiveInt,
    8,
  )
  .option(
    "-b, --batch",
    "Use Anthropic Message Batches API (50% cost reduction)",
  )
  .action(async (opts, cmd) => {
    await runCommand(
      cmd.parent!.opts(),
      { needsApiKey: true, dbMustExist: false, needsLock: true },
      async ({ format, git, apiKey, db, config }) => {
        const aiEnabled = isAiEnabled(config)
        const model = opts.model ?? config.indexModel
        const commits = new CommitRepository(db)
        const aggregates = new AggregateRepository(db)
        const search = new SearchService(db)
        const llm = aiEnabled ? new LLMService(apiKey, model) : null
        const measurer = new MeasurerService(git, commits)
        const aiStartDate =
          typeof config.ai === "string" ? config.ai : undefined
        const enricher = new EnricherService(
          git,
          llm,
          commits,
          aggregates,
          search,
          measurer,
          model,
          opts.concurrency,
          config.indexStartDate ?? undefined,
          aiStartDate,
        )

        if (aiEnabled) {
          db.prepare(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
          ).run("model_used", model)
        }

        if (format === "json") {
          let result
          if (opts.batch && aiEnabled) {
            const batchLLM = new BatchLLMService(apiKey, model)
            const batchJobs = new BatchJobRepository(db)
            result = await enricher.runBatch(batchLLM, batchJobs, () => {})
          } else {
            result = await enricher.run(() => {})
          }

          db.prepare(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
          ).run("last_run", new Date().toISOString())

          formatOutput("json", {
            success: true,
            discovered: result.discoveredThisRun,
            enriched: result.enrichedThisRun,
            already_enriched: result.totalEnriched - result.enrichedThisRun,
            failed: 0,
            total_commits: result.totalCommits,
            enriched_commits: result.totalEnriched,
            coverage_pct:
              result.totalCommits > 0
                ? Math.round((result.totalEnriched / result.totalCommits) * 100)
                : 0,
            model: aiEnabled ? model : null,
            batch_id: "batchId" in result ? (result.batchId ?? null) : null,
          })
        } else {
          if (opts.batch && aiEnabled) {
            const batchLLM = new BatchLLMService(apiKey, model)
            const batchJobs = new BatchJobRepository(db)
            const instance = render(
              <BatchIndexCommand
                enricher={enricher}
                batchLLM={batchLLM}
                batchJobs={batchJobs}
              />,
            )
            await instance.waitUntilExit()
            instance.unmount()
          } else {
            const instance = render(<IndexCommand enricher={enricher} />)
            await instance.waitUntilExit()
            instance.unmount()
          }

          db.prepare(
            "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
          ).run("last_run", new Date().toISOString())
        }
      },
    )
  })
