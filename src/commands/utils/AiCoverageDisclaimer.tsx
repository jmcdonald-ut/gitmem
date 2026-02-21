import { Text } from "ink"
import React from "react"

import type { AiCoverage } from "@/config"

interface AiCoverageDisclaimerProps {
  aiCoverage?: AiCoverage
  spaceBefore?: boolean
  spaceAfter?: boolean
}

/** Renders a yellow disclaimer when AI coverage is disabled or partial. */
export function AiCoverageDisclaimer({
  aiCoverage,
  spaceBefore = false,
  spaceAfter = false,
}: AiCoverageDisclaimerProps) {
  if (!aiCoverage || aiCoverage.status === "full") return null

  let message: string
  if (aiCoverage.status === "disabled") {
    message = "AI enrichment is disabled. Classification data is not available."
  } else {
    const pct = Math.round((aiCoverage.enriched / aiCoverage.total) * 100)
    message = `AI classifications reflect ${aiCoverage.enriched} of ${aiCoverage.total} commits (${pct}%).`
  }

  return (
    <>
      {spaceBefore && <Text> </Text>}
      <Text color="yellow">{message}</Text>
      {spaceAfter && <Text> </Text>}
    </>
  )
}
