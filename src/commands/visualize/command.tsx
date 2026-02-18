import { Command } from "commander"
import { basename } from "path"
import { runCommand } from "@commands/utils/command-context"
import { CommitRepository } from "@db/commits"
import {
  AggregateRepository,
  computeTrend,
  type WindowKey,
} from "@db/aggregates"
import { buildHierarchy } from "@commands/visualize/hierarchy"
import { generatePage } from "@commands/visualize/page"
import {
  isExcluded,
  resolveExcludedCategories,
  filterByTrackedFiles,
  filterPairsByTrackedFiles,
  type FileCategory,
} from "@services/file-filter"

export function parsePort(value: string): number {
  const n = parseInt(value, 10)
  if (isNaN(n) || n < 0 || n > 65535) {
    throw new Error("port must be between 0 and 65535")
  }
  return n
}

export function handleDetails(
  url: URL,
  commits: CommitRepository,
  aggregates: AggregateRepository,
  exclude: FileCategory[],
  trackedFiles?: Set<string>,
): Response {
  const filePath = url.searchParams.get("path") ?? ""
  const window: WindowKey = "monthly"
  const trendLimit = 12
  const fetchLimit = trackedFiles ? 10000 : 5

  try {
    if (!filePath || filePath === "/") {
      // Root level
      const totalCommits = commits.getTotalCommitCount()
      const enrichedCommits = commits.getEnrichedCommitCount()
      const rawHotspots = aggregates.getHotspots({
        sort: "combined",
        limit: fetchLimit,
        exclude,
      })
      const hotspots = trackedFiles
        ? filterByTrackedFiles(rawHotspots, trackedFiles, 5)
        : rawHotspots
      const rawPairs = aggregates.getTopCoupledPairs(fetchLimit, exclude)
      const coupledPairs = trackedFiles
        ? filterPairsByTrackedFiles(rawPairs, trackedFiles, 5)
        : rawPairs
      const trends = aggregates.getTrendsForDirectory("", window, trendLimit)
      const trendSummary = computeTrend(trends)

      return Response.json({
        type: "root",
        totalCommits,
        enrichedCommits,
        enrichmentPct:
          totalCommits > 0
            ? Math.round((enrichedCommits / totalCommits) * 100)
            : 0,
        hotspots: hotspots.map((h) => ({
          file: h.file_path,
          changes: h.total_changes,
          score: (h as { combined_score?: number }).combined_score ?? 0,
        })),
        coupledPairs: coupledPairs.map((p) => ({
          fileA: p.file_a,
          fileB: p.file_b,
          count: p.co_change_count,
        })),
        trendSummary,
      })
    }

    if (filePath.endsWith("/")) {
      // Directory level
      const dirStats = aggregates.getDirectoryStats(filePath)
      const fileCount = aggregates.getDirectoryFileCount(filePath)
      const contributors = aggregates.getDirectoryContributors(filePath, 5)
      const rawCoupled = aggregates.getCoupledFilesForDirectory(
        filePath,
        fetchLimit,
        exclude,
      )
      const coupled = trackedFiles
        ? rawCoupled.filter((c) => trackedFiles.has(c.file)).slice(0, 5)
        : rawCoupled
      const rawHotspots = aggregates.getHotspots({
        pathPrefix: filePath,
        sort: "combined",
        limit: fetchLimit,
        exclude,
      })
      const hotspots = trackedFiles
        ? filterByTrackedFiles(rawHotspots, trackedFiles, 5)
        : rawHotspots
      const trends = aggregates.getTrendsForDirectory(
        filePath,
        window,
        trendLimit,
      )
      const trendSummary = computeTrend(trends)

      return Response.json({
        type: "directory",
        path: filePath,
        fileCount,
        stats: dirStats,
        hotspots: hotspots.map((h) => ({
          file: h.file_path,
          changes: h.total_changes,
          score: (h as { combined_score?: number }).combined_score ?? 0,
        })),
        contributors: contributors.map((c) => ({
          name: c.author_name,
          commits: c.commit_count,
        })),
        coupled: coupled.map((c) => ({
          file: c.file,
          count: c.co_change_count,
          ratio: c.coupling_ratio,
        })),
        trendSummary,
      })
    }

    // File level
    const fileStats = aggregates.getFileStats(filePath)
    const contributors = aggregates.getTopContributors(filePath, 5)
    const rawCoupled = aggregates.getCoupledFilesWithRatio(
      filePath,
      fetchLimit,
      exclude,
    )
    const coupled = trackedFiles
      ? rawCoupled.filter((c) => trackedFiles.has(c.file)).slice(0, 5)
      : rawCoupled
    const trends = aggregates.getTrendsForFile(filePath, window, trendLimit)
    const trendSummary = computeTrend(trends)

    return Response.json({
      type: "file",
      path: filePath,
      stats: fileStats,
      contributors: contributors.map((c) => ({
        name: c.author_name,
        commits: c.commit_count,
      })),
      coupled: coupled.map((c) => ({
        file: c.file,
        count: c.co_change_count,
        ratio: c.coupling_ratio,
      })),
      trendSummary,
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}

export function createFetchHandler(
  html: string,
  commits: CommitRepository,
  aggregates: AggregateRepository,
  exclude: FileCategory[],
  trackedFiles?: Set<string>,
): (req: Request) => Response {
  return (req: Request) => {
    const url = new URL(req.url)
    if (url.pathname === "/")
      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      })
    if (url.pathname === "/api/details")
      return handleDetails(url, commits, aggregates, exclude, trackedFiles)
    return new Response("Not found", { status: 404 })
  }
}

const HELP_TEXT = `
Launches a browser-based visualization of repository hotspots,
file coupling, and change patterns using an interactive circle-packing diagram.

The server runs until you press Ctrl+C.

Examples:
  gitmem visualize
  gitmem viz --port 3000`

export const visualizeCommand = new Command("visualize")
  .alias("viz")
  .description("Open an interactive visualization of the repository")
  .addHelpText("after", HELP_TEXT)
  .option("-p, --port <number>", "Server port (0 for auto)", parsePort, 0)
  .option("--include-tests", "Include test files (excluded by default)")
  .option("--include-docs", "Include documentation files (excluded by default)")
  .option(
    "--include-generated",
    "Include generated/vendored files (excluded by default)",
  )
  .option("--all", "Include all files (no exclusions)")
  .option("--include-deleted", "Include files no longer in the working tree")
  .action(async (opts, cmd) => {
    await runCommand(
      cmd.parent!.opts(),
      { needsApiKey: false },
      async ({ db, git, cwd }) => {
        const exclude = resolveExcludedCategories(opts)
        const allTrackedFiles = await git.getTrackedFiles()
        const trackedFiles =
          exclude.length > 0
            ? allTrackedFiles.filter((f) => !isExcluded(f, exclude))
            : allTrackedFiles
        const commits = new CommitRepository(db)
        const aggregates = new AggregateRepository(db)
        const allStats = aggregates.getAllFileStats(exclude)
        const statsMap = new Map(allStats.map((s) => [s.file_path, s]))

        const hierarchy = buildHierarchy(trackedFiles, statsMap)
        const repoName = basename(cwd)
        const html = generatePage(hierarchy, repoName)
        const detailsTrackedFiles = opts.includeDeleted
          ? undefined
          : new Set(allTrackedFiles)

        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: opts.port,
          fetch: createFetchHandler(
            html,
            commits,
            aggregates,
            exclude,
            detailsTrackedFiles,
          ),
        })

        console.log(`Visualize: http://localhost:${server.port}`)
        if (hierarchy.unindexedCount > 0) {
          console.log(
            `${hierarchy.unindexedCount} files not yet indexed. Run \`gitmem index\` for full data.`,
          )
        }

        await new Promise<void>((resolve) => {
          const shutdown = () => {
            server.stop()
            resolve()
          }
          process.once("SIGINT", shutdown)
          process.once("SIGTERM", shutdown)
        })
      },
    )
  })
