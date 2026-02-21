import { Command } from "@commander-js/extra-typings"
import { render } from "ink"
import { join, resolve } from "path"
import React from "react"
import z from "zod"

import { isAiEnabled } from "@/config"
import { AiRequiredError, NotFoundError, ValidationError } from "@/errors"
import { formatOutput } from "@/output"
import { BatchCheckCommand } from "@commands/check/BatchCheckCommand"
import { CheckCommand } from "@commands/check/CheckCommand"
import { runCommand } from "@commands/utils/command-context"
import { parsePositiveInt } from "@commands/utils/parse-int"
import { BatchJobRepository } from "@db/batch-jobs"
import { CommitRepository } from "@db/commits"
import { BatchJudgeService } from "@services/batch-judge"
import { CheckerService } from "@services/checker"
import { JudgeService } from "@services/judge"

const HELP_TEXT = `
Requires ANTHROPIC_API_KEY environment variable.

Two modes:
  gitmem check <hash>        evaluate a single enriched commit
  gitmem check --sample N    evaluate N random enriched commits

Add --batch with --sample to use the Anthropic Message Batches API
for 50% cost reduction. Re-run the same command to poll/import results.

Evaluates three dimensions: classification correctness, summary
accuracy, and summary completeness. Each dimension receives a pass/fail verdict.

Default output for --sample mode:  .gitmem/check-<timestamp>.json

Examples:
  gitmem check abc1234
  gitmem check --sample 20
  gitmem check --batch --sample 20
  gitmem check --sample 10 --model claude-sonnet-4-5-20250929`

const hashInputSchema = z.object({
  batch: z.undefined(),
  hash: z.hex().min(4),
  sample: z.undefined(),
})

const sampleInputSchema = z.object({
  batch: z.boolean().optional(),
  hash: z.undefined(),
  sample: z.number().int().positive(),
})

const inputSchema = z.union([hashInputSchema, sampleInputSchema])

export const checkCommand = new Command("check")
  .argument("[hash]", "Commit hash to evaluate")
  .description("Evaluate enrichment quality via LLM-as-judge")
  .addHelpText("after", HELP_TEXT)
  .option(
    "-s, --sample <number>",
    "Number of random enriched commits to evaluate",
    parsePositiveInt,
  )
  .option("-m, --model <model>", "Judge model to use")
  .option("-o, --output <path>", "Detail file path for batch results")
  .option(
    "-c, --concurrency <number>",
    "Number of parallel judge requests",
    parsePositiveInt,
    4,
  )
  .option(
    "-b, --batch",
    "Use Anthropic Message Batches API (50% cost reduction)",
  )
  .action(async (hash, opts, cmd) => {
    await runCommand(
      cmd.parent!.opts(),
      { needsApiKey: true, needsLock: true },
      async ({ format, cwd, git, apiKey, db, config }) => {
        const parsedInput = inputSchema.safeParse({ ...opts, hash })
        if (parsedInput.error) {
          throw new ValidationError(
            "provide either a commit hash or use --sample <N> (--batch optional with --sample)",
          )
        }

        const input = parsedInput.data

        if (!isAiEnabled(config)) {
          throw new AiRequiredError(
            "AI is disabled in .gitmem/config.json. The check command requires AI enrichment.",
          )
        }

        const model = opts.model ?? config.checkModel
        const commits = new CommitRepository(db)
        const judge = new JudgeService(apiKey, model)
        const checker = new CheckerService(
          git,
          judge,
          commits,
          opts.concurrency,
        )

        const outputPath =
          opts.output ??
          join(
            resolve(cwd, ".gitmem"),
            `check-${new Date().toISOString().replace(/[:.]/g, "")}.json`,
          )

        if (input.batch) {
          const batchJudge = new BatchJudgeService(apiKey, model)
          const batchJobs = new BatchJobRepository(db)

          if (format === "json") {
            const result = await checker.checkSampleBatch(
              batchJudge,
              batchJobs,
              input.sample,
              outputPath,
              () => {},
            )
            formatOutput("json", result)
          } else {
            const instance = render(
              <BatchCheckCommand
                checker={checker}
                batchJudge={batchJudge}
                batchJobs={batchJobs}
                sampleSize={input.sample}
                outputPath={outputPath}
              />,
            )
            await instance.waitUntilExit()
            instance.unmount()
          }
        } else if (format === "json") {
          if (input.sample !== undefined) {
            const { results, summary } = await checker.checkSample(
              input.sample,
              () => {},
            )
            formatOutput("json", { results, summary })
          } else {
            const result = await checker.checkOne(input.hash, () => {})
            if (!result) {
              throw new NotFoundError(
                `commit ${input.hash} not found or not yet enriched`,
              )
            }
            formatOutput("json", result)
          }
        } else {
          if (input.sample !== undefined) {
            const instance = render(
              <CheckCommand
                checker={checker}
                sampleSize={input.sample}
                outputPath={outputPath}
              />,
            )
            await instance.waitUntilExit()
            instance.unmount()
          } else {
            const instance = render(
              <CheckCommand checker={checker} hash={input.hash} />,
            )
            await instance.waitUntilExit()
            instance.unmount()
          }
        }
      },
    )
  })
