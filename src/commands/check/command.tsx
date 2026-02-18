import { Command } from "commander"
import React from "react"
import { render } from "ink"
import { resolve, join } from "path"
import { runCommand } from "@commands/utils/command-context"
import { parsePositiveInt } from "@commands/utils/parse-int"
import { formatOutput } from "@/output"
import { CommitRepository } from "@db/commits"
import { JudgeService } from "@services/judge"
import { CheckerService } from "@services/checker"
import { CheckCommand } from "@commands/check/CheckCommand"

const HELP_TEXT = `
Requires ANTHROPIC_API_KEY environment variable.

Two modes:
  gitmem check <hash>        evaluate a single enriched commit
  gitmem check --sample N    evaluate N random enriched commits

Evaluates three dimensions: classification correctness, summary
accuracy, and summary completeness. Each dimension is scored 1-5.

Default output for --sample mode:  .gitmem/check-<timestamp>.json

Examples:
  gitmem check abc1234
  gitmem check --sample 20
  gitmem check --sample 10 --model claude-sonnet-4-5-20250929`

export const checkCommand = new Command("check")
  .argument("[hash]", "Commit hash to evaluate")
  .description("Evaluate enrichment quality via LLM-as-judge")
  .addHelpText("after", HELP_TEXT)
  .option(
    "-s, --sample <number>",
    "Number of random enriched commits to evaluate",
    parsePositiveInt,
  )
  .option(
    "-m, --model <model>",
    "Judge model to use",
    "claude-sonnet-4-5-20250929",
  )
  .option("-o, --output <path>", "Detail file path for batch results")
  .option(
    "-c, --concurrency <number>",
    "Number of parallel judge requests",
    parsePositiveInt,
    4,
  )
  .action(async (hash, opts, cmd) => {
    if (!hash && !opts.sample) {
      console.error("Error: provide a commit hash or use --sample <N>")
      process.exit(1)
    }

    await runCommand(
      cmd.parent!.opts(),
      { needsApiKey: true, needsLock: true },
      async ({ format, cwd, git, apiKey, db }) => {
        const commits = new CommitRepository(db)
        const judge = new JudgeService(apiKey, opts.model)
        const checker = new CheckerService(
          git,
          judge,
          commits,
          opts.concurrency,
        )

        if (format === "json") {
          if (opts.sample) {
            const { results, summary } = await checker.checkSample(
              opts.sample,
              () => {},
            )
            formatOutput("json", { results, summary })
          } else {
            const result = await checker.checkOne(hash, () => {})
            if (!result) {
              console.error(
                `Error: commit ${hash} not found or not yet enriched`,
              )
              process.exit(1)
            }
            formatOutput("json", result)
          }
        } else {
          if (opts.sample) {
            const outputPath =
              opts.output ??
              join(
                resolve(cwd, ".gitmem"),
                `check-${new Date().toISOString().replace(/[:.]/g, "")}.json`,
              )
            const instance = render(
              <CheckCommand
                checker={checker}
                sampleSize={opts.sample}
                outputPath={outputPath}
              />,
            )
            await instance.waitUntilExit()
            instance.unmount()
          } else {
            const instance = render(
              <CheckCommand checker={checker} hash={hash} />,
            )
            await instance.waitUntilExit()
            instance.unmount()
          }
        }
      },
    )
  })
