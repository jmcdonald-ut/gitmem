import type { Command, OptionValues } from "@commander-js/extra-typings"

/** Config-level scope defaults stored in `.gitmem/config.json`. */
export interface ScopeConfig {
  include?: string[]
  exclude?: string[]
}

/** CLI flags parsed by Commander for `--include`, `--exclude`, `--all`. */
export interface ScopeFlags {
  include?: string[]
  exclude?: string[]
  all?: boolean
}

/** Resolved scope: fully merged config + CLI flags. */
export interface ScopeSpec {
  include: string[]
  exclude: string[]
}

/** SQL WHERE fragments and their positional parameters. */
export interface ScopeClauses {
  conditions: string[]
  params: string[]
}

/**
 * Merge config defaults with CLI flags into a final ScopeSpec.
 *
 * - `--all` clears config defaults entirely.
 * - `--include` replaces config include (not appended).
 * - `--exclude` appends to config exclude.
 */
export function resolveScope(
  flags: ScopeFlags,
  config?: ScopeConfig,
): ScopeSpec {
  if (flags.all) {
    return { include: [], exclude: [] }
  }

  const configInclude = config?.include ?? []
  const configExclude = config?.exclude ?? []

  const include =
    flags.include && flags.include.length > 0
      ? [...new Set(flags.include.map(normalizePattern))]
      : [...new Set(configInclude.map(normalizePattern))]

  const mergedExclude =
    flags.exclude && flags.exclude.length > 0
      ? [...configExclude, ...flags.exclude]
      : [...configExclude]

  const exclude = [...new Set(mergedExclude.map(normalizePattern))]

  return { include, exclude }
}

/** Strip leading `./` and `/` from user-provided patterns. */
export function normalizePattern(input: string): string {
  return input.replace(/^\.\//, "").replace(/^\//, "")
}

/**
 * Convert a scope pattern to a SQL LIKE string.
 *
 * - No `*` → prefix match: `pattern%`
 * - Has `*` → replace `*` with `%`, escape literal `_` and `%` with `\`.
 *
 * All LIKE clauses using these values must specify `ESCAPE '\'`.
 */
export function patternToLike(pattern: string): string {
  if (!pattern.includes("*")) {
    // Prefix match — escape any literal _ or % in the prefix
    const escaped = pattern
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_")
    return escaped + "%"
  }

  // Wildcard pattern — escape literal _ and %, then convert * to %
  return pattern
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/\*/g, "%")
}

/**
 * Build SQL WHERE fragments from a scope.
 *
 * Include patterns are OR'd, exclude patterns are AND NOT'd.
 */
export function buildScopeClauses(
  column: string,
  scope: ScopeSpec | undefined,
): ScopeClauses {
  if (!scope) return { conditions: [], params: [] }

  const conditions: string[] = []
  const params: string[] = []

  if (scope.include.length > 0) {
    const parts = scope.include.map(() => `${column} LIKE ? ESCAPE '\\'`)
    conditions.push(`(${parts.join(" OR ")})`)
    params.push(...scope.include.map(patternToLike))
  }

  for (const pattern of scope.exclude) {
    conditions.push(`${column} NOT LIKE ? ESCAPE '\\'`)
    params.push(patternToLike(pattern))
  }

  return { conditions, params }
}

/**
 * In-memory predicate equivalent of the SQL scope logic.
 *
 * Returns true if the file path matches the scope.
 */
export function matchesScope(filePath: string, scope: ScopeSpec): boolean {
  // Check include: if include patterns exist, file must match at least one
  if (scope.include.length > 0) {
    const matchesAny = scope.include.some((pattern) =>
      matchesPattern(filePath, pattern),
    )
    if (!matchesAny) return false
  }

  // Check exclude: file must not match any exclude pattern
  for (const pattern of scope.exclude) {
    if (matchesPattern(filePath, pattern)) return false
  }

  return true
}

/** Test whether a file path matches a single scope pattern. */
function matchesPattern(filePath: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    // Prefix match
    return filePath.startsWith(pattern)
  }

  // Convert pattern to regex: escape regex special chars, then replace * with .*
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp("^" + escaped.replace(/\*/g, ".*") + "$")
  return regex.test(filePath)
}

interface ScopeOptions {
  include: string[]
  exclude: string[]
  all?: true
  [key: string]: unknown
}

/** Add `--include/-I`, `--exclude/-X`, `--all` options to a Commander command. */
export function addScopeOptions<
  Args extends unknown[],
  Opts extends OptionValues,
  GlobalOpts extends OptionValues,
>(
  command: Command<Args, Opts, GlobalOpts>,
): Command<Args, Opts & ScopeOptions, GlobalOpts> {
  return command
    .option(
      "-I, --include <pattern>",
      "Include files matching pattern (repeatable, replaces config default)",
      (val: string, prev: string[]) => [...prev, val],
      [] as string[],
    )
    .option(
      "-X, --exclude <pattern>",
      "Exclude files matching pattern (repeatable, appends to config default)",
      (val: string, prev: string[]) => [...prev, val],
      [] as string[],
    )
    .option(
      "--all",
      "Include all files (ignore scope defaults)",
    ) as unknown as Command<Args, Opts & ScopeOptions, GlobalOpts>
}
