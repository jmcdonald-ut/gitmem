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

  const config = status.config

  let aiDisplay: string
  if (config) {
    if (config.ai === false) aiDisplay = "disabled"
    else if (config.ai === true) aiDisplay = "enabled"
    else aiDisplay = `enabled for commits after ${config.ai}`
  } else {
    aiDisplay = "enabled"
  }

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

      {config && (
        <>
          <Text> </Text>
          <Text bold>Config:</Text>
          <Text> AI: {aiDisplay}</Text>
          <Text>
            {"  "}Index start date: {config.indexStartDate ?? "all history"}
          </Text>
          <Text> Index model: {config.indexModel}</Text>
          <Text> Check model: {config.checkModel}</Text>
        </>
      )}
    </Box>
  )
}
