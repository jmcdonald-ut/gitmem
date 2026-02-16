import React from "react"
import { Box, Text } from "ink"
import type { CouplingPairRow, CouplingPairGlobalRow } from "@/types"

/** Props for the CouplingCommand component. */
interface CouplingCommandProps {
  /** Path being queried, or null for global mode. */
  path: string | null
  /** Coupling pairs to display. */
  pairs: CouplingPairRow[] | CouplingPairGlobalRow[]
}

function isGlobalPairs(
  pairs: CouplingPairRow[] | CouplingPairGlobalRow[],
): pairs is CouplingPairGlobalRow[] {
  return pairs.length === 0 || "file_a" in pairs[0]
}

/**
 * Ink component that displays file coupling / co-change pairs.
 * Global mode shows file_a + file_b columns; file/directory mode shows file + ratio.
 */
export function CouplingCommand({ path, pairs }: CouplingCommandProps) {
  return (
    <Box flexDirection="column">
      {path && (
        <>
          <Text>
            Path: <Text color="magenta">{path}</Text>
          </Text>
          <Text> </Text>
        </>
      )}

      {pairs.length === 0 ? (
        <Text color="gray">No coupling data found.</Text>
      ) : path === null && isGlobalPairs(pairs) ? (
        pairs.map((pair) => (
          <Box key={`${pair.file_a}-${pair.file_b}`} marginLeft={1}>
            <Text>
              <Text color="cyan">{pair.file_a}</Text>
              {"  ↔  "}
              <Text color="cyan">{pair.file_b}</Text>
              {"  "}
              <Text bold>{pair.co_change_count}</Text> co-changes
            </Text>
          </Box>
        ))
      ) : (
        (pairs as CouplingPairRow[]).map((pair) => (
          <Box key={pair.file} marginLeft={1}>
            <Text>
              <Text color="cyan">{pair.file}</Text>
              {"  "}
              <Text bold>{pair.co_change_count}</Text> co-changes{"  "}
              <Text color="gray">
                ({Math.round(pair.coupling_ratio * 100)}%)
              </Text>
            </Text>
          </Box>
        ))
      )}
    </Box>
  )
}
