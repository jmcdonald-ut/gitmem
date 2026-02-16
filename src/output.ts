import type { OutputFormat } from "@/types"

/**
 * Resolves CLI flags to a typed output format.
 * --json shorthand wins if both --json and --format are provided.
 */
export function resolveFormat(opts: {
  format?: string
  json?: boolean
}): OutputFormat {
  if (opts.json) return "json"
  if (opts.format === "json") return "json"
  return "text"
}

/**
 * When format is "json", writes JSON to stdout and returns true.
 * When format is "text", returns false (caller handles Ink rendering).
 */
export function formatOutput(format: OutputFormat, data: unknown): boolean {
  if (format === "json") {
    console.log(JSON.stringify(data, null, 2))
    return true
  }
  return false
}
