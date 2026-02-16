#!/usr/bin/env bun
import { Command } from "commander"
import React from "react"
import { render } from "ink"
import { resolve, join } from "path"
import { statSync, existsSync, mkdirSync } from "fs"
import { createDatabase } from "@db/database"
import { CommitRepository } from "@db/commits"
import { AggregateRepository } from "@db/aggregates"
import { SearchService } from "@db/search"
import { GitService } from "@services/git"
import { LLMService } from "@services/llm"
import { EnricherService } from "@services/enricher"
import { BatchLLMService } from "@services/batch-llm"
import { BatchJobRepository } from "@db/batch-jobs"
import { IndexCommand } from "@commands/index-command"
import { BatchIndexCommand } from "@commands/batch-index-command"
import { StatusCommand } from "@commands/status-command"
import { QueryCommand } from "@commands/query-command"
import { CheckCommand } from "@commands/check-command"
import { JudgeService } from "@services/judge"
import { CheckerService } from "@services/checker"
import type { StatusInfo } from "@/types"

/**
 * Resolves the path to the SQLite database file, creating the .gitmem directory if needed.
 * @returns Absolute path to the index.db file.
 */
function getDbPath(): string {
  const dir = resolve(process.cwd(), ".gitmem")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, "index.db")
}

const program = new Command()
  .name("gitmem")
  .description("Pre-analyzed git history index")
  .version("0.1.0")
  .option("--format <format>", "Output format (text or json)", "text")
  .option("--json", "Shorthand for --format json")

program
  .command("index")
  .alias("i")
  .description("Enrich new commits via LLM and rebuild aggregates")
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
  .action(async (opts) => {
    const cwd = process.cwd()
    const git = new GitService(cwd)

    if (!(await git.isGitRepo())) {
      console.error("Error: not a git repository")
      process.exit(1)
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error("Error: ANTHROPIC_API_KEY environment variable is required")
      process.exit(1)
    }

    const dbPath = getDbPath()
    const db = createDatabase(dbPath)
    const commits = new CommitRepository(db)
    const aggregates = new AggregateRepository(db)
    const search = new SearchService(db)
    const llm = new LLMService(apiKey, opts.model)
    const enricher = new EnricherService(
      git,
      llm,
      commits,
      aggregates,
      search,
      opts.model,
      parseInt(opts.concurrency, 10),
    )

    // Store metadata
    db.prepare(
      "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
    ).run("model_used", opts.model)

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

    db.close()
  })

program
  .command("status")
  .alias("s")
  .description("Display index health and coverage")
  .action(async () => {
    const cwd = process.cwd()
    const git = new GitService(cwd)

    if (!(await git.isGitRepo())) {
      console.error("Error: not a git repository")
      process.exit(1)
    }

    const dbPath = getDbPath()
    if (!existsSync(dbPath)) {
      console.error("Error: no index found. Run `gitmem index` first.")
      process.exit(1)
    }

    const db = createDatabase(dbPath)
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

    const instance = render(<StatusCommand status={status} />)
    instance.unmount()
    db.close()
  })

program
  .command("query")
  .alias("q")
  .argument("<query>", "Search query")
  .option("-l, --limit <number>", "Max results", "20")
  .description("Search the index (no LLM, retrieval only)")
  .action(async (query, opts) => {
    const cwd = process.cwd()
    const git = new GitService(cwd)

    if (!(await git.isGitRepo())) {
      console.error("Error: not a git repository")
      process.exit(1)
    }

    const dbPath = getDbPath()
    if (!existsSync(dbPath)) {
      console.error("Error: no index found. Run `gitmem index` first.")
      process.exit(1)
    }

    const db = createDatabase(dbPath)
    const commits = new CommitRepository(db)
    const aggregates = new AggregateRepository(db)
    const search = new SearchService(db)
    const branch = await git.getDefaultBranch()
    const totalCommits = await git.getTotalCommitCount(branch)
    const enrichedCommits = commits.getEnrichedCommitCount()
    const coveragePct =
      totalCommits > 0 ? Math.round((enrichedCommits / totalCommits) * 100) : 0

    const results = search.search(query, parseInt(opts.limit, 10))
    const hotspots = aggregates.getHotspots(5)

    const instance = render(
      <QueryCommand
        query={query}
        results={results}
        hotspots={hotspots}
        coveragePct={coveragePct}
      />,
    )
    instance.unmount()
    db.close()
  })

program
  .command("check")
  .argument("[hash]", "Commit hash to evaluate")
  .description("Evaluate enrichment quality using LLM-as-Judge")
  .option(
    "-s, --sample <number>",
    "Number of random enriched commits to evaluate",
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
    "4",
  )
  .action(async (hash, opts) => {
    const cwd = process.cwd()
    const git = new GitService(cwd)

    if (!(await git.isGitRepo())) {
      console.error("Error: not a git repository")
      process.exit(1)
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error("Error: ANTHROPIC_API_KEY environment variable is required")
      process.exit(1)
    }

    const dbPath = getDbPath()
    if (!existsSync(dbPath)) {
      console.error("Error: no index found. Run `gitmem index` first.")
      process.exit(1)
    }

    if (!hash && !opts.sample) {
      console.error("Error: provide a commit hash or use --sample <N>")
      process.exit(1)
    }

    const db = createDatabase(dbPath)
    const commits = new CommitRepository(db)
    const judge = new JudgeService(apiKey, opts.model)
    const checker = new CheckerService(
      git,
      judge,
      commits,
      parseInt(opts.concurrency, 10),
    )

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
          sampleSize={parseInt(opts.sample, 10)}
          outputPath={outputPath}
        />,
      )
      await instance.waitUntilExit()
      instance.unmount()
    } else {
      const instance = render(<CheckCommand checker={checker} hash={hash} />)
      await instance.waitUntilExit()
      instance.unmount()
    }

    db.close()
  })

program.parse()
