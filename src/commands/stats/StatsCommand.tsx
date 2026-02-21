import { Box, Text } from "ink"
import React from "react"

import type { AiCoverage } from "@/config"
import type { FileContributorRow, FileStatsRow, RecentCommit } from "@/types"
import {
  CLASSIFICATION_COLORS,
  CLASSIFICATION_KEYS,
  type Classification,
} from "@/types"
import { AiCoverageDisclaimer } from "@commands/utils/AiCoverageDisclaimer"

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
  /** AI coverage status for disclaimer display. */
  aiCoverage?: AiCoverage
}

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
  aiCoverage,
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

      <AiCoverageDisclaimer aiCoverage={aiCoverage} spaceAfter />

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

      {stats.current_complexity != null && stats.current_complexity > 0 && (
        <>
          <Text> </Text>
          <Box marginLeft={2} flexDirection="column">
            <Text bold>Complexity:</Text>
            <Box marginLeft={2}>
              <Text>
                current:{" "}
                <Text bold>{Math.round(stats.current_complexity)}</Text>
                {"  "}avg:{" "}
                {stats.avg_complexity != null
                  ? Math.round(stats.avg_complexity)
                  : "\u2014"}
                {"  "}max:{" "}
                {stats.max_complexity != null
                  ? Math.round(stats.max_complexity)
                  : "\u2014"}
                {stats.current_loc != null && stats.current_loc > 0 && (
                  <>
                    {"  "}LOC: {stats.current_loc}
                  </>
                )}
              </Text>
            </Box>
          </Box>
        </>
      )}

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
                  <Text color={CLASSIFICATION_COLORS[c.label]}>
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
                    {c.classification ? (
                      <>
                        <Text
                          color={
                            CLASSIFICATION_COLORS[
                              c.classification as Classification
                            ] ?? "white"
                          }
                        >
                          [{c.classification}]
                        </Text>{" "}
                        {c.summary}
                      </>
                    ) : (
                      <Text color="gray">(not enriched)</Text>
                    )}
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
