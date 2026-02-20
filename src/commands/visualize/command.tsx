import { Command } from "@commander-js/extra-typings"
import { basename } from "path"
import { runCommand } from "@commands/utils/command-context"
import { CommitRepository } from "@db/commits"
import {
  AggregateRepository,
  computeTrend,
  type WindowKey,
} from "@db/aggregates"
import { buildHierarchy } from "@commands/visualize/hierarchy"
import homepage from "@commands/visualize/webapp/index.html"
import {
  isExcluded,
  resolveExcludedCategories,
  filterByTrackedFiles,
  filterPairsByTrackedFiles,
  type FileCategory,
} from "@services/file-filter"

export function normalizePathPrefix(input: string): string {
  let p = input
  // Remove leading ./ or /
  p = p.replace(/^\.\//, "").replace(/^\//, "")
  // "." means whole repo
  if (p === "." || p === "") return ""
  // Ensure trailing /
  if (!p.endsWith("/")) p += "/"
  return p
}

function stripPrefix(filePath: string, prefix: string): string {
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
}

export function parsePort(value: string): number {
  const n = parseInt(value, 10)
  if (isNaN(n) || n < 0 || n > 65535) {
    throw new Error("port must be between 0 and 65535")
  }
  return n
}

function buildDirectoryResponse(
  dirPath: string,
  displayPath: string,
  aggregates: AggregateRepository,
  exclude: FileCategory[],
  trackedFiles: Set<string> | undefined,
  pathPrefix: string,
  fetchLimit: number,
  window: WindowKey,
  trendLimit: number,
) {
  const dirStats = aggregates.getDirectoryStats(dirPath)
  const fileCount = aggregates.getDirectoryFileCount(dirPath)
  const contributors = aggregates.getDirectoryContributors(dirPath, 5)
  const rawCoupled = aggregates.getCoupledFilesForDirectory(
    dirPath,
    fetchLimit,
    exclude,
  )
  const coupled = trackedFiles
    ? rawCoupled.filter((c) => trackedFiles.has(c.file)).slice(0, 5)
    : rawCoupled
  const rawHotspots = aggregates.getHotspots({
    pathPrefix: dirPath,
    sort: "combined",
    limit: fetchLimit,
    exclude,
  })
  const hotspots = trackedFiles
    ? filterByTrackedFiles(rawHotspots, trackedFiles, 5)
    : rawHotspots
  const trends = aggregates.getTrendsForDirectory(dirPath, window, trendLimit)
  const trendSummary = computeTrend(trends)

  return {
    type: "directory" as const,
    path: displayPath,
    fileCount,
    stats: dirStats,
    hotspots: hotspots.map((h) => ({
      file: stripPrefix(h.file_path, pathPrefix),
      changes: h.total_changes,
      score: h.combined_score ?? 0,
    })),
    contributors: contributors.map((c) => ({
      name: c.author_name,
      commits: c.commit_count,
    })),
    coupled: coupled.map((c) => ({
      file: stripPrefix(c.file, pathPrefix),
      count: c.co_change_count,
      ratio: c.coupling_ratio,
    })),
    trendSummary,
  }
}

export function handleDetails(
  url: URL,
  commits: CommitRepository,
  aggregates: AggregateRepository,
  exclude: FileCategory[],
  trackedFiles?: Set<string>,
  pathPrefix = "",
): Response {
  const rawPath = url.searchParams.get("path") ?? ""
  const window: WindowKey = "monthly"
  const trendLimit = 12
  const fetchLimit = trackedFiles ? 10000 : 5

  try {
    // When scoped, root click maps to a directory request for the prefix
    if (pathPrefix && (!rawPath || rawPath === "/")) {
      return Response.json(
        buildDirectoryResponse(
          pathPrefix,
          pathPrefix,
          aggregates,
          exclude,
          trackedFiles,
          pathPrefix,
          fetchLimit,
          window,
          trendLimit,
        ),
      )
    }

    if (!rawPath || rawPath === "/") {
      // Root level (no pathPrefix)
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
          score: h.combined_score ?? 0,
        })),
        coupledPairs: coupledPairs.map((p) => ({
          fileA: p.file_a,
          fileB: p.file_b,
          count: p.co_change_count,
        })),
        trendSummary,
      })
    }

    const filePath = pathPrefix + rawPath

    if (filePath.endsWith("/")) {
      return Response.json(
        buildDirectoryResponse(
          filePath,
          stripPrefix(filePath, pathPrefix),
          aggregates,
          exclude,
          trackedFiles,
          pathPrefix,
          fetchLimit,
          window,
          trendLimit,
        ),
      )
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
      path: stripPrefix(filePath, pathPrefix),
      stats: fileStats,
      contributors: contributors.map((c) => ({
        name: c.author_name,
        commits: c.commit_count,
      })),
      coupled: coupled.map((c) => ({
        file: stripPrefix(c.file, pathPrefix),
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

const HELP_TEXT = `
Launches a browser-based visualization of repository hotspots,
file coupling, and change patterns using an interactive circle-packing diagram.

The server runs until you press Ctrl+C.

Examples:
  gitmem visualize
  gitmem visualize src/commands/
  gitmem viz src/services/ --include-tests
  gitmem viz --port 3000`

export const visualizeCommand = new Command("visualize")
  .alias("viz")
  .description("Open an interactive visualization of the repository")
  .argument("[path]", "Scope visualization to a subdirectory")
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
  .action(async (path, opts, cmd) => {
    await runCommand(
      cmd.parent!.opts(),
      { needsApiKey: false },
      async ({ db, git, cwd }) => {
        const pathPrefix = path ? normalizePathPrefix(path) : ""
        const exclude = resolveExcludedCategories(opts)
        const allTrackedFiles = await git.getTrackedFiles()
        const trackedFiles =
          exclude.length > 0
            ? allTrackedFiles.filter((f) => !isExcluded(f, exclude))
            : allTrackedFiles

        // Filter to files under the path prefix
        const scopedTrackedFiles = pathPrefix
          ? trackedFiles.filter((f) => f.startsWith(pathPrefix))
          : trackedFiles

        if (pathPrefix && scopedTrackedFiles.length === 0) {
          console.error(
            `No tracked files found under "${pathPrefix}". Check the path and try again.`,
          )
          return
        }

        const commits = new CommitRepository(db)
        const aggregates = new AggregateRepository(db)
        const allStats = aggregates.getAllFileStats(exclude)
        const scopedStats = pathPrefix
          ? allStats.filter((s) => s.file_path.startsWith(pathPrefix))
          : allStats
        const strippedStatsMap = new Map(
          scopedStats.map((s) => [stripPrefix(s.file_path, pathPrefix), s]),
        )

        const strippedTrackedFiles = scopedTrackedFiles.map((f) =>
          stripPrefix(f, pathPrefix),
        )
        const filesForHierarchy = opts.includeDeleted
          ? [
              ...new Set([
                ...strippedTrackedFiles,
                ...scopedStats.map((s) => stripPrefix(s.file_path, pathPrefix)),
              ]),
            ]
          : strippedTrackedFiles
        const hierarchyData = buildHierarchy(
          filesForHierarchy,
          strippedStatsMap,
        )
        const repoName = basename(cwd)
        const detailsTrackedFiles = opts.includeDeleted
          ? undefined
          : new Set(allTrackedFiles)

        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: opts.port,
          routes: {
            "/": homepage,
          },
          fetch(req) {
            const url = new URL(req.url)
            if (url.pathname === "/api/hierarchy") {
              return Response.json({
                ...hierarchyData,
                repoName,
                pathPrefix,
              })
            }
            if (url.pathname === "/api/details") {
              return handleDetails(
                url,
                commits,
                aggregates,
                exclude,
                detailsTrackedFiles,
                pathPrefix,
              )
            }
            return new Response("Not found", { status: 404 })
          },
        })

        const scopeLabel = pathPrefix ? ` (${pathPrefix})` : ""
        console.log(`Visualize${scopeLabel}: http://localhost:${server.port}`)
        if (hierarchyData.unindexedCount > 0) {
          console.log(
            `${hierarchyData.unindexedCount} files not yet indexed. Run \`gitmem index\` for full data.`,
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
