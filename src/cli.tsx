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
import { HotspotsCommand } from "@commands/hotspots-command"
import { StatsCommand } from "@commands/stats-command"
import { CouplingCommand } from "@commands/coupling-command"
import { TrendsCommand } from "@commands/trends-command"
import { SchemaCommand } from "@commands/schema-command"
import { SCHEMA } from "@/schema"
import { computeTrend, WINDOW_FORMATS } from "@db/aggregates"
import { JudgeService } from "@services/judge"
import { CheckerService } from "@services/checker"
import type { StatusInfo } from "@/types"
import { resolveFormat, formatOutput } from "@/output"

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
    const format = resolveFormat(program.opts())
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
              ? Math.round((result.totalEnriched / result.totalCommits) * 100)
              : 0,
          model: opts.model,
          batch_id: result.batchId ?? null,
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

    db.close()
  })

program
  .command("status")
  .alias("s")
  .description("Display index health and coverage")
  .action(async () => {
    const format = resolveFormat(program.opts())
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

    if (formatOutput(format, status)) {
      db.close()
      return
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
  .option(
    "--classification <type>",
    "Filter by classification (bug-fix, feature, refactor, docs, chore, perf, test, style)",
  )
  .description("Search the index (no LLM, retrieval only)")
  .action(async (query, opts) => {
    const format = resolveFormat(program.opts())
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
    const search = new SearchService(db)
    const branch = await git.getDefaultBranch()
    const totalCommits = await git.getTotalCommitCount(branch)
    const enrichedCommits = commits.getEnrichedCommitCount()
    const coveragePct =
      totalCommits > 0 ? Math.round((enrichedCommits / totalCommits) * 100) : 0

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
    ) {
      db.close()
      return
    }

    const instance = render(
      <QueryCommand
        query={query}
        results={results}
        classificationFilter={classification}
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
    const format = resolveFormat(program.opts())
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

    if (format === "json") {
      if (opts.sample) {
        const { results, summary } = await checker.checkSample(
          parseInt(opts.sample, 10),
          () => {},
        )
        formatOutput("json", { results, summary })
      } else {
        const result = await checker.checkOne(hash, () => {})
        if (!result) {
          console.error(`Error: commit ${hash} not found or not yet enriched`)
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
    }

    db.close()
  })

const VALID_SORT_FIELDS = [
  "total",
  "bug-fix",
  "feature",
  "refactor",
  "docs",
  "chore",
  "perf",
  "test",
  "style",
]

program
  .command("hotspots")
  .alias("h")
  .description("Show most-changed files with classification breakdown")
  .option(
    "--sort <field>",
    "Sort by: total, bug-fix, feature, refactor, docs, chore, perf, test, style",
    "total",
  )
  .option("--path <prefix>", "Filter by directory prefix")
  .option("-l, --limit <number>", "Max results", "10")
  .action(async (opts) => {
    const format = resolveFormat(program.opts())
    const cwd = process.cwd()
    const git = new GitService(cwd)

    if (!(await git.isGitRepo())) {
      console.error("Error: not a git repository")
      process.exit(1)
    }

    if (!VALID_SORT_FIELDS.includes(opts.sort)) {
      console.error(
        `Error: invalid sort field "${opts.sort}". Valid values: ${VALID_SORT_FIELDS.join(", ")}`,
      )
      process.exit(1)
    }

    const dbPath = getDbPath()
    if (!existsSync(dbPath)) {
      console.error("Error: no index found. Run `gitmem index` first.")
      process.exit(1)
    }

    const db = createDatabase(dbPath)
    const aggregates = new AggregateRepository(db)

    const hotspots = aggregates.getHotspots({
      limit: parseInt(opts.limit, 10),
      sort: opts.sort,
      pathPrefix: opts.path,
    })

    if (
      formatOutput(format, {
        sort: opts.sort,
        path: opts.path ?? null,
        hotspots,
      })
    ) {
      db.close()
      return
    }

    const instance = render(
      <HotspotsCommand
        hotspots={hotspots}
        sort={opts.sort}
        pathPrefix={opts.path}
      />,
    )
    instance.unmount()
    db.close()
  })

program
  .command("stats")
  .argument("<path>", "File or directory path to inspect")
  .option("-l, --limit <number>", "Limit sub-lists", "5")
  .description("Deep dive on a file or directory")
  .action(async (path, opts) => {
    const format = resolveFormat(program.opts())
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
    const aggregates = new AggregateRepository(db)
    const commits = new CommitRepository(db)
    const limit = parseInt(opts.limit, 10)

    // Detect whether path is a file or directory
    const fileStats = aggregates.getFileStats(path)
    if (fileStats) {
      // File mode
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
      ) {
        db.close()
        return
      }

      const instance = render(
        <StatsCommand
          path={path}
          type="file"
          stats={fileStats}
          contributors={contributors}
          recentCommits={recentCommits}
        />,
      )
      instance.unmount()
    } else {
      // Try as directory prefix
      const prefix = path.endsWith("/") ? path : path + "/"
      const fileCount = aggregates.getDirectoryFileCount(prefix)

      if (fileCount === 0) {
        console.error(`Error: no indexed data found for "${path}"`)
        db.close()
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
      ) {
        db.close()
        return
      }

      const instance = render(
        <StatsCommand
          path={prefix}
          type="directory"
          fileCount={fileCount}
          stats={dirStats}
          contributors={contributors}
          topFiles={topFiles}
        />,
      )
      instance.unmount()
    }

    db.close()
  })

program
  .command("coupling [path]")
  .alias("c")
  .description("Show co-change pairs")
  .option("-l, --limit <number>", "Max results", "10")
  .action(async (path, opts) => {
    const format = resolveFormat(program.opts())
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
    const aggregates = new AggregateRepository(db)
    const limit = parseInt(opts.limit, 10)

    if (!path) {
      // Global mode
      const pairs = aggregates.getTopCoupledPairs(limit)

      if (formatOutput(format, { path: null, pairs })) {
        db.close()
        return
      }

      const instance = render(<CouplingCommand path={null} pairs={pairs} />)
      instance.unmount()
    } else {
      // Detect whether path is a file or directory
      const fileStats = aggregates.getFileStats(path)
      if (fileStats) {
        // File mode
        const pairs = aggregates.getCoupledFilesWithRatio(path, limit)

        if (formatOutput(format, { path, pairs })) {
          db.close()
          return
        }

        const instance = render(<CouplingCommand path={path} pairs={pairs} />)
        instance.unmount()
      } else {
        // Directory mode
        const prefix = path.endsWith("/") ? path : path + "/"
        const fileCount = aggregates.getDirectoryFileCount(prefix)

        if (fileCount === 0) {
          console.error(`Error: no indexed data found for "${path}"`)
          db.close()
          process.exit(1)
        }

        const pairs = aggregates.getCoupledFilesForDirectory(prefix, limit)

        if (formatOutput(format, { path: prefix, pairs })) {
          db.close()
          return
        }

        const instance = render(<CouplingCommand path={prefix} pairs={pairs} />)
        instance.unmount()
      }
    }

    db.close()
  })

const VALID_WINDOWS = ["weekly", "monthly", "quarterly"]

program
  .command("trends <path>")
  .alias("t")
  .description("Show change velocity and classification mix over time")
  .option(
    "-w, --window <period>",
    "Time window: weekly, monthly, quarterly",
    "monthly",
  )
  .option("-l, --limit <number>", "Number of most recent periods", "12")
  .action(async (path, opts) => {
    const format = resolveFormat(program.opts())
    const cwd = process.cwd()
    const git = new GitService(cwd)

    if (!(await git.isGitRepo())) {
      console.error("Error: not a git repository")
      process.exit(1)
    }

    if (!VALID_WINDOWS.includes(opts.window)) {
      console.error(
        `Error: invalid window "${opts.window}". Valid values: ${VALID_WINDOWS.join(", ")}`,
      )
      process.exit(1)
    }

    const dbPath = getDbPath()
    if (!existsSync(dbPath)) {
      console.error("Error: no index found. Run `gitmem index` first.")
      process.exit(1)
    }

    const db = createDatabase(dbPath)
    const aggregates = new AggregateRepository(db)
    const limit = parseInt(opts.limit, 10)
    const windowSql = WINDOW_FORMATS[opts.window]

    // Detect whether path is a file or directory
    const fileStats = aggregates.getFileStats(path)
    let type: "file" | "directory"
    let periods

    if (fileStats) {
      type = "file"
      periods = aggregates.getTrendsForFile(path, windowSql, limit)
    } else {
      const prefix = path.endsWith("/") ? path : path + "/"
      const fileCount = aggregates.getDirectoryFileCount(prefix)

      if (fileCount === 0) {
        console.error(`Error: no indexed data found for "${path}"`)
        db.close()
        process.exit(1)
      }

      type = "directory"
      periods = aggregates.getTrendsForDirectory(prefix, windowSql, limit)
      path = prefix
    }

    const trend = computeTrend(periods)

    if (
      formatOutput(format, {
        path,
        type,
        window: opts.window,
        periods,
        trend,
      })
    ) {
      db.close()
      return
    }

    const instance = render(
      <TrendsCommand
        path={path}
        type={type}
        window={opts.window}
        periods={periods}
        trend={trend}
      />,
    )
    instance.unmount()
    db.close()
  })

program
  .command("schema")
  .description("Display database schema documentation")
  .action(async () => {
    const format = resolveFormat(program.opts())

    if (formatOutput(format, { tables: SCHEMA })) {
      return
    }

    const instance = render(<SchemaCommand tables={SCHEMA} />)
    instance.unmount()
  })

program.parse()
