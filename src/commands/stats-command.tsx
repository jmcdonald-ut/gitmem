import React from "react"
import { Box, Text } from "ink"
import type { FileStatsRow, FileContributorRow, RecentCommit } from "@/types"

/** Props for the StatsCommand component. */
interface StatsCommandProps {
  /** The path being inspected. */
  path: string
  /** Whether this is a file or directory. */
  type: "file" | "directory"
  /** Number of files in the directory (directory only). */
  fileCount?: number
  /** Aggregated stats for the path. */
  stats: FileStatsRow
  /** Top contributors. */
  contributors: FileContributorRow[]
  /** Recent commits (file only). */
  recentCommits?: RecentCommit[]
  /** Top files by change count (directory only). */
  topFiles?: FileStatsRow[]
}

const TAG_COLORS: Record<string, string> = {
  "bug-fix": "red",
  feature: "green",
  refactor: "yellow",
  docs: "blue",
  chore: "gray",
  perf: "magenta",
  test: "cyan",
  style: "white",
}

const CLASSIFICATION_KEYS: { key: keyof FileStatsRow; label: string }[] = [
  { key: "bug_fix_count", label: "bug-fix" },
  { key: "feature_count", label: "feature" },
  { key: "refactor_count", label: "refactor" },
  { key: "docs_count", label: "docs" },
  { key: "chore_count", label: "chore" },
  { key: "perf_count", label: "perf" },
  { key: "test_count", label: "test" },
  { key: "style_count", label: "style" },
]

/**
 * Ink component that displays detailed stats for a file or directory,
 * including classification breakdown, contributors, and recent commits
 * or top files.
 */
export function StatsCommand({
  path,
  type,
  fileCount,
  stats,
  contributors,
  recentCommits,
  topFiles,
}: StatsCommandProps) {
  const additions = stats.total_additions
  const deletions = stats.total_deletions

  const nonZeroClassifications = CLASSIFICATION_KEYS.filter(
    (c) => (stats[c.key] as number) > 0,
  ).sort((a, b) => (stats[b.key] as number) - (stats[a.key] as number))

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="cyan">{path}</Text> ({type}
        {type === "directory" && fileCount !== undefined
          ? `, ${fileCount} files`
          : ""}
        )
      </Text>
      <Text> </Text>

      <Box marginLeft={2} flexDirection="column">
        <Text>
          <Text bold>{stats.total_changes}</Text> changes{"  "}
          <Text color="green">+{additions}</Text>{" "}
          <Text color="red">-{deletions}</Text>
        </Text>
        <Text>
          first seen: <Text color="gray">{stats.first_seen.split("T")[0]}</Text>
          {"  "}last changed:{" "}
          <Text color="gray">{stats.last_changed.split("T")[0]}</Text>
        </Text>
      </Box>

      <Text> </Text>
      <Box marginLeft={2} flexDirection="column">
        <Text bold>Classification breakdown:</Text>
        {nonZeroClassifications.length === 0 ? (
          <Text color="gray"> No classifications</Text>
        ) : (
          <Box marginLeft={2}>
            <Text>
              {nonZeroClassifications.map((c, i) => (
                <Text key={c.label}>
                  <Text color={TAG_COLORS[c.label]}>
                    {c.label}: {stats[c.key] as number}
                  </Text>
                  {i < nonZeroClassifications.length - 1 ? "  " : ""}
                </Text>
              ))}
            </Text>
          </Box>
        )}
      </Box>

      <Text> </Text>
      <Box marginLeft={2} flexDirection="column">
        <Text bold>Contributors:</Text>
        {contributors.length === 0 ? (
          <Text color="gray"> No contributors</Text>
        ) : (
          <Box marginLeft={2}>
            <Text>
              {contributors.map((c, i) => (
                <Text key={c.author_email}>
                  {c.author_name} ({c.commit_count})
                  {i < contributors.length - 1 ? "  " : ""}
                </Text>
              ))}
            </Text>
          </Box>
        )}
      </Box>

      {type === "file" && recentCommits && (
        <>
          <Text> </Text>
          <Box marginLeft={2} flexDirection="column">
            <Text bold>Recent commits:</Text>
            {recentCommits.length === 0 ? (
              <Text color="gray"> No recent commits</Text>
            ) : (
              recentCommits.map((c) => (
                <Box key={c.hash} marginLeft={2}>
                  <Text>
                    <Text color="gray">{c.hash.slice(0, 7)}</Text>{" "}
                    <Text color={TAG_COLORS[c.classification] ?? "white"}>
                      [{c.classification}]
                    </Text>{" "}
                    {c.summary}
                  </Text>
                </Box>
              ))
            )}
          </Box>
        </>
      )}

      {type === "directory" && topFiles && (
        <>
          <Text> </Text>
          <Box marginLeft={2} flexDirection="column">
            <Text bold>Top files:</Text>
            {topFiles.length === 0 ? (
              <Text color="gray"> No files found</Text>
            ) : (
              topFiles.map((f) => (
                <Box key={f.file_path} marginLeft={2}>
                  <Text>
                    <Text color="cyan">{f.file_path}</Text>
                    {"  "}
                    <Text bold>{f.total_changes}</Text> changes
                  </Text>
                </Box>
              ))
            )}
          </Box>
        </>
      )}
    </Box>
  )
}
