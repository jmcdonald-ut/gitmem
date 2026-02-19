import React, { useState, useEffect } from "react"
import { Box, Text, useApp } from "ink"
import Spinner from "ink-spinner"
import type { CheckProgress, CheckBatchResult, EvalSummary } from "@/types"
import type { CheckerService } from "@services/checker"
import type { BatchJudgeService } from "@services/batch-judge"
import type { BatchJobRepository } from "@db/batch-jobs"

interface BatchCheckCommandProps {
  checker: CheckerService
  batchJudge: BatchJudgeService
  batchJobs: BatchJobRepository
  sampleSize: number
  outputPath: string
}

/**
 * Ink component that runs the batch check workflow and displays
 * real-time progress including batch submission, polling, and import states.
 */
export function BatchCheckCommand({
  checker,
  batchJudge,
  batchJobs,
  sampleSize,
  outputPath,
}: BatchCheckCommandProps) {
  const { exit } = useApp()
  const [progress, setProgress] = useState<CheckProgress>({
    phase: "evaluating",
    current: 0,
    total: 0,
  })
  const [result, setResult] = useState<CheckBatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    checker
      .checkSampleBatch(batchJudge, batchJobs, sampleSize, outputPath, (p) =>
        setProgress(p),
      )
      .then(setResult)
      .catch((err) => setError(err.message))
  }, [checker, batchJudge, batchJobs, sampleSize, outputPath])

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
    if (result.kind === "submitted") {
      return (
        <Box flexDirection="column">
          <Text color="yellow">Batch submitted! ID: {result.batchId}</Text>
          <Text>Commits queued: {sampleSize}</Text>
          <Text>
            Run `gitmem check --batch --sample {sampleSize}` again to check
            status.
          </Text>
        </Box>
      )
    }

    if (result.kind === "in_progress") {
      return (
        <Box flexDirection="column">
          <Text color="cyan">Batch in progress: {result.batchId}</Text>
          <Text>
            Run `gitmem check --batch --sample {sampleSize}` again to check
            status.
          </Text>
        </Box>
      )
    }

    if (result.kind === "complete") {
      return (
        <BatchCheckResultView
          summary={result.summary}
          outputPath={result.outputPath}
        />
      )
    }

    if (result.kind === "empty") {
      return <BatchCheckResultView summary={result.summary} />
    }
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> {batchCheckPhaseLabel(progress)}</Text>
      </Box>
    </Box>
  )
}

function BatchCheckResultView({
  summary,
  outputPath,
}: {
  summary: EvalSummary
  outputPath?: string
}) {
  return (
    <Box flexDirection="column">
      <Text color="green">Check complete!</Text>
      <Text />
      <Text>Evaluation Summary ({summary.total} commits)</Text>
      <Text />
      <Text>
        {"  "}Classification: {summary.classificationCorrect}/{summary.total}{" "}
        correct
      </Text>
      <Text>
        {"  "}Summary accuracy: {summary.summaryAccurate}/{summary.total}{" "}
        accurate
      </Text>
      <Text>
        {"  "}Summary completeness: {summary.summaryComplete}/{summary.total}{" "}
        complete
      </Text>
      {outputPath && (
        <>
          <Text />
          <Text>
            {"  "}Details saved to: {outputPath}
          </Text>
        </>
      )}
    </Box>
  )
}

export function batchCheckPhaseLabel(progress: CheckProgress): string {
  if (progress.batchStatus === "submitting") {
    return `Submitting batch (${progress.total} commits)...`
  }
  if (progress.batchStatus === "importing") {
    return `Importing ${progress.total} results...`
  }
  if (progress.batchId) {
    return `Batch ${progress.batchId}: ${progress.batchStatus}...`
  }
  return "Evaluating commits..."
}
