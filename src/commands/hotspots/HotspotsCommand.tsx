import { Box, Text } from "ink"
import React from "react"

import type { AiCoverage } from "@/config"
import { CLASSIFICATION_COLORS, CLASSIFICATION_KEYS } from "@/types"
import { AiCoverageDisclaimer } from "@commands/utils/AiCoverageDisclaimer"
import type { FileStatsRow } from "@db/types"

/** Props for the HotspotsCommand component. */
interface HotspotsCommandProps {
  /** Hotspot file stats to display. */
  hotspots: Array<FileStatsRow & { combined_score?: number }>
  /** Active sort field. */
  sort: string
  /** Active path prefix filter, if any. */
  pathPrefix?: string
  /** AI coverage status for disclaimer display. */
  aiCoverage?: AiCoverage
}

/**
 * Ink component that displays file hotspots with
 * classification breakdown tags.
 */
export function HotspotsCommand({
  hotspots,
  sort,
  pathPrefix,
  aiCoverage,
}: HotspotsCommandProps) {
  const showMeta = sort !== "total" || pathPrefix

  return (
    <Box flexDirection="column">
      {showMeta && (
        <>
          <Text>
            {sort !== "total" && (
              <>
                Sort: <Text color="magenta">{sort}</Text>
                {"  "}
              </>
            )}
            {pathPrefix && (
              <>
                Path: <Text color="magenta">{pathPrefix}</Text>
              </>
            )}
          </Text>
          <Text> </Text>
        </>
      )}

      <AiCoverageDisclaimer aiCoverage={aiCoverage} />

      {hotspots.length === 0 ? (
        <Text color="gray">No hotspots found.</Text>
      ) : (
        hotspots.map((file) => {
          const tags = CLASSIFICATION_KEYS.filter((c) => file[c.key] > 0)
            .sort((a, b) => file[b.key] - file[a.key])
            .slice(0, 3)

          return (
            <Box key={file.file_path} marginLeft={1}>
              <Text>
                <Text color="cyan">{file.file_path}</Text>
                {"  "}
                <Text bold>{file.total_changes}</Text> changes{"  "}
                {file.current_complexity != null &&
                  file.current_complexity > 0 && (
                    <Text>
                      <Text color="yellow">
                        cx:{Math.round(file.current_complexity)}
                      </Text>
                      {"  "}
                    </Text>
                  )}
                {file.combined_score != null && file.combined_score > 0 && (
                  <Text>
                    <Text bold color="magenta">
                      score:{file.combined_score.toFixed(2)}
                    </Text>
                    {"  "}
                  </Text>
                )}
                {tags.map((t) => (
                  <Text key={t.label}>
                    <Text color={CLASSIFICATION_COLORS[t.label]}>
                      [{t.label}: {file[t.key]}]
                    </Text>{" "}
                  </Text>
                ))}
              </Text>
            </Box>
          )
        })
      )}
    </Box>
  )
}
