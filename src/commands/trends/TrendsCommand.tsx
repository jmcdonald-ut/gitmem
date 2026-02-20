import React from "react"
import { Box, Text } from "ink"
import type { TrendPeriod, TrendSummary } from "@/types"
import { CLASSIFICATION_COLORS, CLASSIFICATION_KEYS } from "@/types"
import { AiCoverageDisclaimer } from "@commands/utils/AiCoverageDisclaimer"
import type { AiCoverage } from "@/config"

/** Props for the TrendsCommand component. */
interface TrendsCommandProps {
  /** The path being inspected. */
  path: string
  /** Whether this is a file or directory. */
  type: "file" | "directory"
  /** Time window used for grouping. */
  window: string
  /** Trend periods ordered most recent first. */
  periods: TrendPeriod[]
  /** Computed trend summary, or null if insufficient data. */
  trend: TrendSummary | null
  /** AI coverage status for disclaimer display. */
  aiCoverage?: AiCoverage
}

const DIRECTION_DISPLAY: Record<string, { arrow: string; color: string }> = {
  increasing: { arrow: "\u2191", color: "green" },
  decreasing: { arrow: "\u2193", color: "red" },
  stable: { arrow: "\u2192", color: "yellow" },
}

/**
 * Ink component that displays change velocity and classification mix
 * over time for a file or directory.
 */
export function TrendsCommand({
  path,
  type,
  window,
  periods,
  trend,
  aiCoverage,
}: TrendsCommandProps) {
  if (periods.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="cyan">{path}</Text> ({type}, {window})
        </Text>
        <Text> </Text>
        <Text color="gray">No trend data found.</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="cyan">{path}</Text> ({type}, {window})
      </Text>

      <AiCoverageDisclaimer aiCoverage={aiCoverage} spaceBefore />

      {trend && (
        <>
          <Text> </Text>
          <Box marginLeft={2} flexDirection="column">
            <Text>
              Trend:{" "}
              <Text color={DIRECTION_DISPLAY[trend.direction].color}>
                {DIRECTION_DISPLAY[trend.direction].arrow} {trend.direction}
              </Text>{" "}
              (recent: {trend.recent_avg} avg, historical:{" "}
              {trend.historical_avg} avg)
            </Text>
            <Text>
              Bug-fix trend:{" "}
              <Text color={DIRECTION_DISPLAY[trend.bug_fix_trend].color}>
                {trend.bug_fix_trend}
              </Text>
            </Text>
            <Text>
              Complexity trend:{" "}
              <Text color={DIRECTION_DISPLAY[trend.complexity_trend].color}>
                {trend.complexity_trend}
              </Text>
            </Text>
          </Box>
        </>
      )}

      <Text> </Text>
      {periods.map((p) => {
        const nonZero = CLASSIFICATION_KEYS.filter(
          (c) => (p[c.key] as number) > 0,
        ).sort((a, b) => (p[b.key] as number) - (p[a.key] as number))

        return (
          <Box key={p.period} marginLeft={2}>
            <Text>
              <Text bold>{p.period}</Text>
              {"  "}
              {p.total_changes} changes{"  "}
              <Text color="green">+{p.additions}</Text>{" "}
              <Text color="red">-{p.deletions}</Text>
              {p.avg_complexity != null && (
                <>
                  {"  "}
                  <Text color="yellow">cx:{Math.round(p.avg_complexity)}</Text>
                </>
              )}
              {nonZero.length > 0 ? "   " : ""}
              {nonZero.map((c, i) => (
                <Text key={c.label}>
                  <Text color={CLASSIFICATION_COLORS[c.label]}>
                    {c.label}: {p[c.key] as number}
                  </Text>
                  {i < nonZero.length - 1 ? "  " : ""}
                </Text>
              ))}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
