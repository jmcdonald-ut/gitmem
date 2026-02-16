import React from "react"
import { Box, Text } from "ink"
import type { TrendPeriod, TrendSummary } from "@/types"

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

const CLASSIFICATION_KEYS: { key: keyof TrendPeriod; label: string }[] = [
  { key: "bug_fix_count", label: "bug-fix" },
  { key: "feature_count", label: "feature" },
  { key: "refactor_count", label: "refactor" },
  { key: "docs_count", label: "docs" },
  { key: "chore_count", label: "chore" },
  { key: "perf_count", label: "perf" },
  { key: "test_count", label: "test" },
  { key: "style_count", label: "style" },
]

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
              {nonZero.length > 0 ? "   " : ""}
              {nonZero.map((c, i) => (
                <Text key={c.label}>
                  <Text color={TAG_COLORS[c.label]}>
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
