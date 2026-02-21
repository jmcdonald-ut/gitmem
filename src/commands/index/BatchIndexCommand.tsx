import { Box, Text, useApp } from "ink"
import Spinner from "ink-spinner"
import React, { useEffect, useState } from "react"

import type { IndexProgress } from "@/types"
import type { BatchJobRepository } from "@db/batch-jobs"
import type { BatchLLMService } from "@services/batch-llm"
import type { EnricherService } from "@services/enricher"

interface BatchIndexCommandProps {
  enricher: EnricherService
  batchLLM: BatchLLMService
  batchJobs: BatchJobRepository
}

/**
 * Ink component that runs the batch enrichment pipeline and displays
 * real-time progress including batch submission, polling, and import states.
 */
export function BatchIndexCommand({
  enricher,
  batchLLM,
  batchJobs,
}: BatchIndexCommandProps) {
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
    batchId?: string
    batchStatus?: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    enricher
      .runBatch(batchLLM, batchJobs, (p) => setProgress(p))
      .then(setResult)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
  }, [enricher, batchLLM, batchJobs])

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
    if (result.batchStatus === "submitted") {
      return (
        <Box flexDirection="column">
          <Text color="yellow">Batch submitted! ID: {result.batchId}</Text>
          <Text>
            Commits queued: {result.totalCommits - result.totalEnriched}
          </Text>
          <Text>Run `gitmem index --batch` again to check status.</Text>
        </Box>
      )
    }

    if (result.batchStatus === "in_progress") {
      return (
        <Box flexDirection="column">
          <Text color="cyan">Batch in progress: {result.batchId}</Text>
          <Text>Run `gitmem index --batch` again to check status.</Text>
        </Box>
      )
    }

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
        <Text> {batchPhaseLabel(progress)}</Text>
      </Box>
    </Box>
  )
}

export function batchPhaseLabel(progress: IndexProgress): string {
  if (progress.batchStatus === "submitting") {
    return `Submitting batch (${progress.total} commits)...`
  }
  if (progress.batchStatus === "importing") {
    return `Importing ${progress.total} results...`
  }
  switch (progress.phase) {
    case "discovering":
      return "Discovering commits..."
    case "measuring":
      return "Measuring complexity..."
    case "enriching":
      if (progress.batchId) {
        return `Batch ${progress.batchId}: ${progress.batchStatus}...`
      }
      return "Enriching commits..."
    case "aggregating":
      return "Rebuilding aggregates..."
    case "indexing":
      return "Rebuilding search index..."
    case "done":
      return "Done"
  }
}
