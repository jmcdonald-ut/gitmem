import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { z } from "zod"

import { ConfigError, NotInitializedError } from "@/errors"
import type { ScopeConfig } from "@/scope"

/** Controls whether AI enrichment is used and for which commits. */
export type AiConfigValue = boolean | string

/** Configuration for gitmem stored in `.gitmem/config.json`. */
export interface GitmemConfig {
  /** false (disabled), true (all commits), or "YYYY-MM-DD" (commits on/after date). */
  ai: AiConfigValue
  /** null (all history) or "YYYY-MM-DD" (limit discovery to commits on/after date). */
  indexStartDate: string | null
  /** Default model for `gitmem index`. */
  indexModel: string
  /** Default model for `gitmem check`. */
  checkModel: string
  /** Default include/exclude patterns for file scoping. */
  scope: ScopeConfig
}

/** AI coverage status for UI disclaimers. */
export type AiCoverage =
  | { status: "disabled" }
  | { status: "full" }
  | {
      status: "partial"
      enriched: number
      total: number
      aiConfig: AiConfigValue
    }

/** Default configuration values. */
export const DEFAULTS: GitmemConfig = {
  ai: true,
  indexStartDate: null,
  indexModel: "claude-haiku-4-5-20251001",
  checkModel: "claude-sonnet-4-5-20250929",
  scope: {
    exclude: [
      "*__test__*",
      "*.test.*",
      "test/*",
      "*__spec__*",
      "*.spec.*",
      "spec/*",
      "*.lock",
      "*.md",
    ],
  },
}

const isoDate = z.iso.date()

/** Returns true when `.gitmem/config.json` exists. */
export function configExists(gitmemDir: string): boolean {
  return existsSync(join(gitmemDir, "config.json"))
}

/**
 * Creates `.gitmem/config.json` with defaults merged with optional overrides.
 * Creates the `.gitmem/` directory if it does not exist.
 * Throws if config already exists or if overrides contain invalid values.
 */
export function createConfig(
  gitmemDir: string,
  overrides?: Partial<GitmemConfig>,
): GitmemConfig {
  if (configExists(gitmemDir)) {
    throw new ConfigError(
      "Already initialized. Edit .gitmem/config.json to change settings.",
    )
  }

  const config: GitmemConfig = { ...DEFAULTS }

  if (overrides) {
    if (overrides.ai !== undefined) {
      const ai = overrides.ai
      if (ai === true || ai === false) {
        config.ai = ai
      } else if (typeof ai === "string") {
        if (!isoDate.safeParse(ai).success) {
          throw new ConfigError(
            `Invalid config: "ai" must be true, false, or a valid "YYYY-MM-DD" date string, got "${ai}"`,
          )
        }
        config.ai = ai
      } else {
        throw new ConfigError(
          `Invalid config: "ai" must be true, false, or a valid "YYYY-MM-DD" date string`,
        )
      }
    }

    if (overrides.indexStartDate !== undefined) {
      const isd = overrides.indexStartDate
      if (isd === null) {
        config.indexStartDate = null
      } else if (typeof isd === "string") {
        if (!isoDate.safeParse(isd).success) {
          throw new ConfigError(
            `Invalid config: "indexStartDate" must be null or a valid "YYYY-MM-DD" date string, got "${isd}"`,
          )
        }
        config.indexStartDate = isd
      } else {
        throw new ConfigError(
          `Invalid config: "indexStartDate" must be null or a valid "YYYY-MM-DD" date string`,
        )
      }
    }

    if (overrides.indexModel !== undefined) {
      if (
        typeof overrides.indexModel !== "string" ||
        overrides.indexModel === ""
      ) {
        throw new ConfigError(
          `Invalid config: "indexModel" must be a non-empty string`,
        )
      }
      config.indexModel = overrides.indexModel
    }

    if (overrides.checkModel !== undefined) {
      if (
        typeof overrides.checkModel !== "string" ||
        overrides.checkModel === ""
      ) {
        throw new ConfigError(
          `Invalid config: "checkModel" must be a non-empty string`,
        )
      }
      config.checkModel = overrides.checkModel
    }

    if (overrides.scope !== undefined) {
      const s = overrides.scope
      if (typeof s !== "object" || s === null || Array.isArray(s)) {
        throw new ConfigError(
          `Invalid config: "scope" must be an object with optional "include" and "exclude" string arrays`,
        )
      }
      if (
        s.include !== undefined &&
        (!Array.isArray(s.include) ||
          !s.include.every((v) => typeof v === "string"))
      ) {
        throw new ConfigError(
          `Invalid config: "scope.include" must be an array of strings`,
        )
      }
      if (
        s.exclude !== undefined &&
        (!Array.isArray(s.exclude) ||
          !s.exclude.every((v) => typeof v === "string"))
      ) {
        throw new ConfigError(
          `Invalid config: "scope.exclude" must be an array of strings`,
        )
      }
      config.scope = s
    }
  }

  if (!existsSync(gitmemDir)) {
    mkdirSync(gitmemDir, { recursive: true })
  }
  writeFileSync(
    join(gitmemDir, "config.json"),
    JSON.stringify(config, null, 2) + "\n",
  )

  return config
}

/**
 * Loads config from `.gitmem/config.json`.
 * Missing keys are backfilled from defaults in memory only.
 * Throws when config file does not exist or contains invalid values.
 */
export function loadConfig(gitmemDir: string): GitmemConfig {
  const configPath = join(gitmemDir, "config.json")

  if (!existsSync(configPath)) {
    throw new NotInitializedError()
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"))
  } catch {
    throw new ConfigError(`Invalid config: ${configPath} is not valid JSON`)
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`Invalid config: ${configPath} must be a JSON object`)
  }

  const obj = raw as Record<string, unknown>
  const config: GitmemConfig = { ...DEFAULTS }

  // ai
  if ("ai" in obj) {
    const ai = obj.ai
    if (ai === true || ai === false) {
      config.ai = ai
    } else if (typeof ai === "string") {
      if (!isoDate.safeParse(ai).success) {
        throw new ConfigError(
          `Invalid config: "ai" must be true, false, or a valid "YYYY-MM-DD" date string, got "${ai}"`,
        )
      }
      config.ai = ai
    } else {
      throw new ConfigError(
        `Invalid config: "ai" must be true, false, or a valid "YYYY-MM-DD" date string`,
      )
    }
  }

  // indexStartDate
  if ("indexStartDate" in obj) {
    const isd = obj.indexStartDate
    if (isd === null) {
      config.indexStartDate = null
    } else if (typeof isd === "string") {
      if (!isoDate.safeParse(isd).success) {
        throw new ConfigError(
          `Invalid config: "indexStartDate" must be null or a valid "YYYY-MM-DD" date string, got "${isd}"`,
        )
      }
      config.indexStartDate = isd
    } else {
      throw new ConfigError(
        `Invalid config: "indexStartDate" must be null or a valid "YYYY-MM-DD" date string`,
      )
    }
  }

  // indexModel
  if ("indexModel" in obj) {
    if (typeof obj.indexModel !== "string" || obj.indexModel === "") {
      throw new ConfigError(
        `Invalid config: "indexModel" must be a non-empty string`,
      )
    }
    config.indexModel = obj.indexModel
  }

  // checkModel
  if ("checkModel" in obj) {
    if (typeof obj.checkModel !== "string" || obj.checkModel === "") {
      throw new ConfigError(
        `Invalid config: "checkModel" must be a non-empty string`,
      )
    }
    config.checkModel = obj.checkModel
  }

  // scope
  if ("scope" in obj) {
    const s = obj.scope
    if (typeof s !== "object" || s === null || Array.isArray(s)) {
      throw new ConfigError(
        `Invalid config: "scope" must be an object with optional "include" and "exclude" string arrays`,
      )
    }
    const sObj = s as Record<string, unknown>
    const parsed: ScopeConfig = {}
    if ("include" in sObj) {
      if (
        !Array.isArray(sObj.include) ||
        !sObj.include.every((v: unknown) => typeof v === "string")
      ) {
        throw new ConfigError(
          `Invalid config: "scope.include" must be an array of strings`,
        )
      }
      parsed.include = sObj.include
    }
    if ("exclude" in sObj) {
      if (
        !Array.isArray(sObj.exclude) ||
        !sObj.exclude.every((v: unknown) => typeof v === "string")
      ) {
        throw new ConfigError(
          `Invalid config: "scope.exclude" must be an array of strings`,
        )
      }
      parsed.exclude = sObj.exclude
    }
    config.scope = parsed
  }

  return config
}

/** Returns the AI coverage status for UI disclaimers. */
export function getAiCoverage(
  config: GitmemConfig,
  enrichedCount: number,
  totalCount: number,
): AiCoverage {
  if (config.ai === false) {
    return { status: "disabled" }
  }
  if (totalCount === 0 || enrichedCount >= totalCount) {
    return { status: "full" }
  }
  return {
    status: "partial",
    enriched: enrichedCount,
    total: totalCount,
    aiConfig: config.ai,
  }
}

/** Convenience: returns true when AI is not explicitly disabled. */
export function isAiEnabled(config: GitmemConfig): boolean {
  return config.ai !== false
}
