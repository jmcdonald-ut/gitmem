import React from "react"
import { Box, Text } from "ink"
import type { SearchResult, FileStatsRow } from "@/types"

/** Props for the QueryCommand component. */
interface QueryCommandProps {
  /** The user's search query string. */
  query: string
  /** FTS search results matching the query. */
  results: SearchResult[]
  /** Top file hotspots by change frequency. */
  hotspots: FileStatsRow[]
  /** Index coverage as a percentage (0-100). */
  coveragePct: number
}

/**
 * Ink component that displays search results, file hotspots, and
 * a coverage warning if the index is incomplete.
 */
export function QueryCommand({
  query,
  results,
  hotspots,
  coveragePct,
}: QueryCommandProps) {
  return (
    <Box flexDirection="column">
      {coveragePct < 100 && (
        <Text color="yellow">
          Warning: Index coverage is {coveragePct}% — results may be incomplete.
        </Text>
      )}

      <Text bold>Query: {query}</Text>
      <Text> </Text>

      {results.length === 0 ? (
        <Text color="gray">No matching commits found.</Text>
      ) : (
        <>
          <Text bold>Matching commits ({results.length}):</Text>
          {results.map((r) => (
            <Box key={r.hash} flexDirection="column" marginLeft={1}>
              <Text>
                <Text color="cyan">{r.hash.slice(0, 7)}</Text>{" "}
                <Text color="yellow">[{r.classification}]</Text> {r.summary}
              </Text>
            </Box>
          ))}
        </>
      )}

      {hotspots.length > 0 && (
        <>
          <Text> </Text>
          <Text bold>Top hotspots:</Text>
          {hotspots.map((h) => (
            <Text key={h.file_path} color="gray">
              {"  "}
              {h.file_path} ({h.total_changes} changes, {h.bug_fix_count} bug
              fixes)
            </Text>
          ))}
        </>
      )}
    </Box>
  )
}
