import { Command } from "commander"
import React from "react"
import { render } from "ink"
import { runCommand } from "@commands/utils/command-context"
import { formatOutput } from "@/output"
import { CommitRepository } from "@db/commits"
import { AggregateRepository } from "@db/aggregates"
import { SearchService } from "@db/search"
import { LLMService } from "@services/llm"
import { EnricherService } from "@services/enricher"
import { MeasurerService } from "@services/measurer"
import { BatchLLMService } from "@services/batch-llm"
import { BatchJobRepository } from "@db/batch-jobs"
import { IndexCommand } from "@commands/index/IndexCommand"
import { BatchIndexCommand } from "@commands/index/BatchIndexCommand"

const HELP_TEXT = `
Requires ANTHROPIC_API_KEY environment variable.

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
  .option(
    "-m, --model <model>",
    "LLM model to use",
    "claude-haiku-4-5-20251001",
  )
  .option("-c, --concurrency <number>", "Number of parallel LLM requests", "8")
  .option(
    "-b, --batch",
    "Use Anthropic Message Batches API (50% cost reduction)",
  )
  .action(async (opts, cmd) => {
    await runCommand(
      cmd.parent!.opts(),
      { needsApiKey: true, dbMustExist: false },
      async ({ format, git, apiKey, db }) => {
        const commits = new CommitRepository(db)
        const aggregates = new AggregateRepository(db)
        const search = new SearchService(db)
        const llm = new LLMService(apiKey, opts.model)
        const measurer = new MeasurerService(git, commits)
        const enricher = new EnricherService(
          git,
          llm,
          commits,
          aggregates,
          search,
          measurer,
          opts.model,
          parseInt(opts.concurrency, 10),
        )

        db.prepare(
          "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
        ).run("model_used", opts.model)

        if (format === "json") {
          try {
            let result
            if (opts.batch) {
              const batchLLM = new BatchLLMService(apiKey, opts.model)
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
                  ? Math.round(
                      (result.totalEnriched / result.totalCommits) * 100,
                    )
                  : 0,
              model: opts.model,
              batch_id: "batchId" in result ? (result.batchId ?? null) : null,
            })
          } catch (err) {
            formatOutput("json", {
              success: false,
              error: err instanceof Error ? err.message : String(err),
            })
            process.exit(1)
          }
        } else {
          if (opts.batch) {
            const batchLLM = new BatchLLMService(apiKey, opts.model)
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
