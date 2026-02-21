import { Box, Text, useApp } from "ink"
import Spinner from "ink-spinner"
import React, { useEffect, useState } from "react"

import type { CheckProgress, EvalResult, EvalSummary } from "@/types"
import type { CheckerService } from "@services/checker"

/** Props for single-commit check mode. */
interface SingleCheckProps {
  checker: CheckerService
  hash: string
  outputPath?: undefined
}

/** Props for batch sample check mode. */
interface BatchCheckProps {
  checker: CheckerService
  sampleSize: number
  outputPath: string
}

type CheckCommandProps = SingleCheckProps | BatchCheckProps

/**
 * Ink component that runs the quality check workflow and displays
 * evaluation results inline (single) or as aggregate summary (batch).
 */
export function CheckCommand(props: CheckCommandProps) {
  const { exit } = useApp()
  const [progress, setProgress] = useState<CheckProgress>({
    phase: "evaluating",
    current: 0,
    total: 0,
  })
  const [singleResult, setSingleResult] = useState<EvalResult | null>(null)
  const [batchResult, setBatchResult] = useState<{
    summary: EvalSummary
    outputPath: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const isBatch = "sampleSize" in props

  useEffect(() => {
    if (isBatch) {
      props.checker
        .checkSample(props.sampleSize, setProgress)
        .then(({ results, summary }) => {
          const output = JSON.stringify(results, null, 2)
          void Bun.write(props.outputPath, output)
          setBatchResult({ summary, outputPath: props.outputPath })
        })
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : String(err)),
        )
    } else {
      props.checker
        .checkOne(props.hash, setProgress)
        .then((result) => {
          if (result) {
            setSingleResult(result)
          } else {
            setNotFound(true)
          }
        })
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : String(err)),
        )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.checker])

  useEffect(() => {
    if (singleResult || batchResult || error || notFound) exit()
  }, [singleResult, batchResult, error, notFound, exit])

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Error: {error}</Text>
      </Box>
    )
  }

  if (notFound) {
    return (
      <Box flexDirection="column">
        <Text color="red">
          Commit not found or not yet enriched. Run `gitmem index` first.
        </Text>
      </Box>
    )
  }

  if (singleResult) {
    return <SingleResultView result={singleResult} />
  }

  if (batchResult) {
    return (
      <BatchResultView
        summary={batchResult.summary}
        outputPath={batchResult.outputPath}
      />
    )
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Evaluating commits...</Text>
      </Box>
      {progress.total > 0 && (
        <Text>
          Evaluating commit {progress.current.toLocaleString()} /{" "}
          {progress.total.toLocaleString()}
          {progress.currentHash ? ` [${progress.currentHash.slice(0, 7)}]` : ""}
        </Text>
      )}
    </Box>
  )
}

function SingleResultView({ result }: { result: EvalResult }) {
  return (
    <Box flexDirection="column">
      <Text>
        Evaluation for <Text color="cyan">{result.hash.slice(0, 7)}</Text>
      </Text>
      <Text />
      <Text>
        {"  "}Original: [{result.classification}] {result.summary}
      </Text>
      <Text />
      <VerdictLine
        label="Classification"
        pass={result.classificationVerdict.pass}
        reasoning={result.classificationVerdict.reasoning}
      />
      <VerdictLine
        label="Summary accuracy"
        pass={result.accuracyVerdict.pass}
        reasoning={result.accuracyVerdict.reasoning}
      />
      <VerdictLine
        label="Summary completeness"
        pass={result.completenessVerdict.pass}
        reasoning={result.completenessVerdict.reasoning}
      />
    </Box>
  )
}

function VerdictLine({
  label,
  pass,
  reasoning,
}: {
  label: string
  pass: boolean
  reasoning: string
}) {
  return (
    <Box flexDirection="column">
      <Text>
        {"  "}
        <Text color={pass ? "green" : "red"}>
          [{pass ? "PASS" : "FAIL"}]
        </Text>{" "}
        {label}
      </Text>
      <Text>
        {"         "}
        {reasoning}
      </Text>
    </Box>
  )
}

function BatchResultView({
  summary,
  outputPath,
}: {
  summary: EvalSummary
  outputPath: string
}) {
  return (
    <Box flexDirection="column">
      <Text>Evaluation Summary ({summary.total} commits)</Text>
      <Text />
      <Text>
        {"  "}Classification: {padNum(summary.classificationCorrect)}/
        {summary.total} correct
      </Text>
      <Text>
        {"  "}Summary accuracy: {padNum(summary.summaryAccurate)}/
        {summary.total} accurate
      </Text>
      <Text>
        {"  "}Summary completeness: {padNum(summary.summaryComplete)}/
        {summary.total} complete
      </Text>
      <Text />
      <Text>
        {"  "}Details saved to: {outputPath}
      </Text>
    </Box>
  )
}

function padNum(n: number): string {
  return String(n)
}
