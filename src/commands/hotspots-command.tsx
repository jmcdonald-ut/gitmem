import React from "react"
import { Box, Text } from "ink"
import type { FileStatsRow } from "@/types"

/** Props for the HotspotsCommand component. */
interface HotspotsCommandProps {
  /** Hotspot file stats to display. */
  hotspots: FileStatsRow[]
  /** Active sort field. */
  sort: string
  /** Active path prefix filter, if any. */
  pathPrefix?: string
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

const CLASSIFICATION_KEYS: { key: keyof FileStatsRow; label: string }[] = [
  { key: "bug_fix_count", label: "bug-fix" },
  { key: "feature_count", label: "feature" },
  { key: "refactor_count", label: "refactor" },
  { key: "docs_count", label: "docs" },
  { key: "chore_count", label: "chore" },
  { key: "perf_count", label: "perf" },
  { key: "test_count", label: "test" },
  { key: "style_count", label: "style" },
]

/**
 * Ink component that displays file hotspots with
 * classification breakdown tags.
 */
export function HotspotsCommand({
  hotspots,
  sort,
  pathPrefix,
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
                {tags.map((t) => (
                  <Text key={t.label}>
                    <Text color={TAG_COLORS[t.label]}>
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
