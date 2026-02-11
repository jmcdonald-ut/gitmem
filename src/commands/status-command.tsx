import React from "react"
import { Box, Text } from "ink"
import type { StatusInfo } from "@/types"

/** Props for the StatusCommand component. */
interface StatusCommandProps {
  /** Current index health and coverage information. */
  status: StatusInfo
}

/** Ink component that displays index health, coverage percentages, and database metadata. */
export function StatusCommand({ status }: StatusCommandProps) {
  const coveragePct =
    status.totalCommits > 0
      ? Math.round((status.enrichedCommits / status.totalCommits) * 100)
      : 0
  const indexedPct =
    status.totalCommits > 0
      ? Math.round((status.indexedCommits / status.totalCommits) * 100)
      : 0

  return (
    <Box flexDirection="column">
      <Text bold>gitmem status</Text>
      <Text> </Text>
      <Text>
        Indexed: {status.indexedCommits.toLocaleString()} /{" "}
        {status.totalCommits.toLocaleString()} commits ({indexedPct}%)
      </Text>
      <Text>
        Enriched: {status.enrichedCommits.toLocaleString()} /{" "}
        {status.indexedCommits.toLocaleString()} indexed commits ({coveragePct}
        %)
      </Text>
      <Text>Last run: {status.lastRun ?? "never"}</Text>
      <Text>Model: {status.modelUsed ?? "none"}</Text>
      <Text>DB: {status.dbPath}</Text>
      <Text>
        DB size:{" "}
        {status.dbSize < 1024
          ? `${status.dbSize} B`
          : status.dbSize < 1024 * 1024
            ? `${(status.dbSize / 1024).toFixed(1)} KB`
            : `${(status.dbSize / (1024 * 1024)).toFixed(1)} MB`}
      </Text>
    </Box>
  )
}
