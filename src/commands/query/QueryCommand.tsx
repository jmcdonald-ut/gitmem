import { Box, Text } from "ink"
import React from "react"

import type { SearchResult } from "@db/types"

/** Props for the QueryCommand component. */
interface QueryCommandProps {
  /** The user's search query string. */
  query: string
  /** FTS search results matching the query. */
  results: SearchResult[]
  /** Active classification filter, if any. */
  classificationFilter?: string
  /** Index coverage as a percentage (0-100). */
  coveragePct: number
}

/**
 * Ink component that displays search results and
 * a coverage warning if the index is incomplete.
 */
export function QueryCommand({
  query,
  results,
  classificationFilter,
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
      {classificationFilter && (
        <Text>
          Filter: <Text color="magenta">{classificationFilter}</Text>
        </Text>
      )}
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
    </Box>
  )
}
