import { Command } from "@commander-js/extra-typings"
import { basename } from "path"

import { filterByTrackedFiles, filterPairsByTrackedFiles } from "@/file-filter"
import {
  type ScopeSpec,
  addScopeOptions,
  matchesScope,
  resolveScope,
} from "@/scope"
import { runCommand } from "@commands/utils/command-context"
import { buildHierarchy } from "@commands/visualize/hierarchy"
import {
  AggregateRepository,
  type WindowKey,
  computeTrend,
} from "@db/aggregates"
import { CommitRepository } from "@db/commits"

import homepage from "@visualize-app/index.html"

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
  scope: ScopeSpec,
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
    scope,
  )
  const scopedCoupled = pathPrefix
    ? rawCoupled.filter((c) => c.file.startsWith(pathPrefix))
    : rawCoupled
  const coupled = trackedFiles
    ? scopedCoupled.filter((c) => trackedFiles.has(c.file)).slice(0, 5)
    : scopedCoupled
  const rawHotspots = aggregates.getHotspots({
    scope: {
      include: [dirPath],
      exclude: scope.exclude,
    },
    sort: "combined",
    limit: fetchLimit,
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
  scope: ScopeSpec,
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
          scope,
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
        scope,
      })
      const hotspots = trackedFiles
        ? filterByTrackedFiles(rawHotspots, trackedFiles, 5)
        : rawHotspots
      const rawPairs = aggregates.getTopCoupledPairs(fetchLimit, scope)
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
          scope,
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
      scope,
    )
    const scopedCoupled = pathPrefix
      ? rawCoupled.filter((c) => c.file.startsWith(pathPrefix))
      : rawCoupled
    const coupled = trackedFiles
      ? scopedCoupled.filter((c) => trackedFiles.has(c.file)).slice(0, 5)
      : scopedCoupled
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
    if (err instanceof Error) {
      console.error("Details API error:", err.message)
    }
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}

const HELP_TEXT = `
Launches a browser-based visualization of repository hotspots,
file coupling, and change patterns using an interactive circle-packing diagram.

The server runs until you press Ctrl+C.

Examples:
  gitmem visualize
  gitmem visualize src/commands/
  gitmem viz src/services/ -I "*.ts"
  gitmem viz --port 3000 --all`

export const visualizeCommand = addScopeOptions(
  new Command("visualize")
    .alias("viz")
    .description("Open an interactive visualization of the repository")
    .argument("[path]", "Scope visualization to a subdirectory")
    .addHelpText("after", HELP_TEXT)
    .option("-p, --port <number>", "Server port (0 for auto)", parsePort, 0)
    .option("--include-deleted", "Include files no longer in the working tree"),
).action(async (path, opts, cmd) => {
  await runCommand(
    cmd.parent!.opts(),
    { needsApiKey: false },
    async ({ db, git, cwd, config }) => {
      const pathPrefix = path ? normalizePathPrefix(path) : ""

      const flags = {
        include: opts.include,
        exclude: opts.exclude,
        all: opts.all,
      }
      const scope = resolveScope(flags, config.scope)
      const allTrackedFiles = await git.getTrackedFiles()
      const trackedFiles = allTrackedFiles.filter((f) => matchesScope(f, scope))

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
      const allStats = aggregates.getAllFileStats(scope)
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
      const hierarchyData = buildHierarchy(filesForHierarchy, strippedStatsMap)
      const repoName = basename(cwd)
      const detailsTrackedFiles = opts.includeDeleted
        ? undefined
        : new Set(allTrackedFiles)

      const securityHeaders = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy":
          "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
      }

      // Pre-compress hierarchy JSON (static payload, potentially large)
      const hierarchyJson = JSON.stringify({
        ...hierarchyData,
        repoName,
        pathPrefix,
      })
      const hierarchyGzip = Bun.gzipSync(Buffer.from(hierarchyJson))

      // Cache details responses (DB is read-only during visualization)
      const detailsCache = new Map<string, Response>()

      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: opts.port,
        routes: {
          "/": homepage,
        },
        fetch(req) {
          const url = new URL(req.url)
          if (url.pathname === "/api/hierarchy") {
            const acceptGzip =
              req.headers.get("accept-encoding")?.includes("gzip") ?? false
            if (acceptGzip) {
              return new Response(hierarchyGzip, {
                headers: {
                  "Content-Type": "application/json",
                  "Content-Encoding": "gzip",
                  ...securityHeaders,
                },
              })
            }
            return new Response(hierarchyJson, {
              headers: {
                "Content-Type": "application/json",
                ...securityHeaders,
              },
            })
          }
          if (url.pathname === "/api/details") {
            const cacheKey = url.searchParams.get("path") ?? ""
            const cached = detailsCache.get(cacheKey)
            if (cached) return cached.clone()

            const res = handleDetails(
              url,
              commits,
              aggregates,
              scope,
              detailsTrackedFiles,
              pathPrefix,
            )
            for (const [k, v] of Object.entries(securityHeaders)) {
              res.headers.set(k, v)
            }
            detailsCache.set(cacheKey, res.clone())
            return res
          }
          return new Response("Not found", {
            status: 404,
            headers: securityHeaders,
          })
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
          void server.stop()
          resolve()
        }
        process.once("SIGINT", shutdown)
        process.once("SIGTERM", shutdown)
      })
    },
  )
})
