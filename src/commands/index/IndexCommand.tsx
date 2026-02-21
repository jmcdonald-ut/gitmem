import { Box, Text, useApp } from "ink"
import Spinner from "ink-spinner"
import React, { useEffect, useState } from "react"

import type { IndexProgress } from "@/types"
import { EnricherService } from "@services/enricher"

/** Props for the IndexCommand component. */
interface IndexCommandProps {
  /** The enricher service that drives the indexing pipeline. */
  enricher: EnricherService
}

/**
 * Ink component that runs the enrichment pipeline and displays real-time progress,
 * including phase labels, commit counts, and a final coverage summary.
 */
export function IndexCommand({ enricher }: IndexCommandProps) {
  const { exit } = useApp()
  const [progress, setProgress] = useState<IndexProgress>({
    phase: "discovering",
    current: 0,
    total: 0,
  })
  const [result, setResult] = useState<{
    enrichedThisRun: number
    totalEnriched: number
    totalCommits: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    enricher
      .run((p) => setProgress(p), controller.signal)
      .then(setResult)
      .catch((err) => setError(err.message))

    return () => controller.abort()
  }, [enricher])

  useEffect(() => {
    if (result || error) exit()
  }, [result, error, exit])

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Error: {error}</Text>
      </Box>
    )
  }

  if (result) {
    return (
      <Box flexDirection="column">
        <Text color="green">Indexing complete!</Text>
        <Text>
          Enriched this run: {result.enrichedThisRun.toLocaleString()}
        </Text>
        <Text>
          Total coverage: {result.totalEnriched.toLocaleString()} /{" "}
          {result.totalCommits.toLocaleString()} commits (
          {result.totalCommits > 0
            ? Math.round((result.totalEnriched / result.totalCommits) * 100)
            : 0}
          %)
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> {phaseLabel(progress)}</Text>
      </Box>
      {progress.phase === "measuring" && progress.total > 0 && (
        <Text>
          Measuring file {progress.current.toLocaleString()} /{" "}
          {progress.total.toLocaleString()}
        </Text>
      )}
      {progress.phase === "enriching" && progress.total > 0 && (
        <Text>
          Enriching commit {progress.current.toLocaleString()} /{" "}
          {progress.total.toLocaleString()}
          {progress.currentHash ? ` [${progress.currentHash.slice(0, 7)}]` : ""}
        </Text>
      )}
    </Box>
  )
}

/**
 * Maps an IndexProgress phase to a human-readable status label.
 * @param progress - The current indexing progress state.
 * @returns A display string for the current phase.
 */
export function phaseLabel(progress: IndexProgress): string {
  switch (progress.phase) {
    case "discovering":
      return "Discovering commits..."
    case "measuring":
      return "Measuring complexity..."
    case "enriching":
      return "Enriching commits..."
    case "aggregating":
      return "Rebuilding aggregates..."
    case "indexing":
      return "Rebuilding search index..."
    case "done":
      return "Done"
  }
}
