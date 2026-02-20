import React from "react"
import { Box, Text } from "ink"
import type { FileStatsRow } from "@/types"
import { CLASSIFICATION_COLORS, CLASSIFICATION_KEYS } from "@/types"
import type { AiCoverage } from "@/config"

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
          const tags = CLASSIFICATION_KEYS.filter(
            (c) => (file[c.key] as number) > 0,
          )
            .sort((a, b) => (file[b.key] as number) - (file[a.key] as number))
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
                      [{t.label}: {file[t.key] as number}]
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

function AiCoverageDisclaimer({ aiCoverage }: { aiCoverage?: AiCoverage }) {
  if (!aiCoverage) return null

  if (aiCoverage.status === "disabled") {
    return (
      <Text color="yellow">
        AI enrichment is disabled. Classification data is not available.
      </Text>
    )
  }

  if (aiCoverage.status === "partial") {
    const pct = Math.round((aiCoverage.enriched / aiCoverage.total) * 100)
    return (
      <Text color="yellow">
        AI classifications reflect {aiCoverage.enriched} of {aiCoverage.total}{" "}
        commits ({pct}%).
      </Text>
    )
  }

  return null
}
