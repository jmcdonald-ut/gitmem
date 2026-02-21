import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

import {
  DEFAULTS,
  type GitmemConfig,
  configExists,
  createConfig,
  getAiCoverage,
  isAiEnabled,
  loadConfig,
} from "@/config"
import { ConfigError, NotInitializedError } from "@/errors"

describe("loadConfig", () => {
  let tempDir: string

  beforeEach(async () => {
    const raw = await mkdtemp(join(tmpdir(), "gitmem-config-test-"))
    tempDir = await Bun.$`realpath ${raw}`.text().then((t) => t.trim())
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("throws when config file does not exist", () => {
    const gitmemDir = join(tempDir, ".gitmem")

    expect(() => loadConfig(gitmemDir)).toThrow(
      "gitmem is not initialized. Run `gitmem init` first.",
    )
    expect(() => loadConfig(gitmemDir)).toThrow(NotInitializedError)
  })

  test("throws when directory does not exist", () => {
    const gitmemDir = join(tempDir, "nested", ".gitmem")

    expect(() => loadConfig(gitmemDir)).toThrow(
      "gitmem is not initialized. Run `gitmem init` first.",
    )
    expect(() => loadConfig(gitmemDir)).toThrow(NotInitializedError)
  })

  test("reads existing config", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(
      join(gitmemDir, "config.json"),
      JSON.stringify({ ai: false, indexModel: "custom-model" }),
    )

    const config = loadConfig(gitmemDir)
    expect(config.ai).toBe(false)
    expect(config.indexModel).toBe("custom-model")
    // Defaults backfilled
    expect(config.indexStartDate).toBeNull()
    expect(config.checkModel).toBe("claude-sonnet-4-5-20250929")
  })

  test("backfills missing keys from defaults in memory", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(join(gitmemDir, "config.json"), JSON.stringify({ ai: false }))

    const config = loadConfig(gitmemDir)
    expect(config.ai).toBe(false)
    expect(config.indexStartDate).toBeNull()
    expect(config.indexModel).toBe("claude-haiku-4-5-20251001")
    expect(config.checkModel).toBe("claude-sonnet-4-5-20250929")

    // File should NOT be rewritten
    const raw = JSON.parse(
      readFileSync(join(gitmemDir, "config.json"), "utf-8"),
    )
    expect(Object.keys(raw)).toEqual(["ai"])
  })

  test("accepts ai as date string", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(
      join(gitmemDir, "config.json"),
      JSON.stringify({ ai: "2024-06-01" }),
    )

    const config = loadConfig(gitmemDir)
    expect(config.ai).toBe("2024-06-01")
  })

  test("accepts indexStartDate as date string", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(
      join(gitmemDir, "config.json"),
      JSON.stringify({ indexStartDate: "2024-01-01" }),
    )

    const config = loadConfig(gitmemDir)
    expect(config.indexStartDate).toBe("2024-01-01")
  })

  test("throws on invalid ai value (number)", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(join(gitmemDir, "config.json"), JSON.stringify({ ai: 42 }))

    expect(() => loadConfig(gitmemDir)).toThrow(
      'must be true, false, or a valid "YYYY-MM-DD"',
    )
  })

  test("throws on invalid ai date format", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(
      join(gitmemDir, "config.json"),
      JSON.stringify({ ai: "not-a-date" }),
    )

    expect(() => loadConfig(gitmemDir)).toThrow(
      'must be true, false, or a valid "YYYY-MM-DD"',
    )
  })

  test("throws on semantically invalid ai date", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(
      join(gitmemDir, "config.json"),
      JSON.stringify({ ai: "2024-13-45" }),
    )

    expect(() => loadConfig(gitmemDir)).toThrow(
      'must be true, false, or a valid "YYYY-MM-DD"',
    )
  })

  test("throws on invalid indexStartDate", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(
      join(gitmemDir, "config.json"),
      JSON.stringify({ indexStartDate: 123 }),
    )

    expect(() => loadConfig(gitmemDir)).toThrow(
      'must be null or a valid "YYYY-MM-DD"',
    )
  })

  test("throws on empty indexModel", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(
      join(gitmemDir, "config.json"),
      JSON.stringify({ indexModel: "" }),
    )

    expect(() => loadConfig(gitmemDir)).toThrow("non-empty string")
  })

  test("throws on non-string checkModel", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(
      join(gitmemDir, "config.json"),
      JSON.stringify({ checkModel: 42 }),
    )

    expect(() => loadConfig(gitmemDir)).toThrow("non-empty string")
  })

  test("accepts explicit null indexStartDate", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(
      join(gitmemDir, "config.json"),
      JSON.stringify({ indexStartDate: null }),
    )

    const config = loadConfig(gitmemDir)
    expect(config.indexStartDate).toBeNull()
  })

  test("throws on invalid indexStartDate date format", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(
      join(gitmemDir, "config.json"),
      JSON.stringify({ indexStartDate: "not-a-date" }),
    )

    expect(() => loadConfig(gitmemDir)).toThrow(
      'must be null or a valid "YYYY-MM-DD"',
    )
  })

  test("throws on semantically invalid indexStartDate", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(
      join(gitmemDir, "config.json"),
      JSON.stringify({ indexStartDate: "2024-02-30" }),
    )

    expect(() => loadConfig(gitmemDir)).toThrow(
      'must be null or a valid "YYYY-MM-DD"',
    )
  })

  test("accepts valid checkModel string", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(
      join(gitmemDir, "config.json"),
      JSON.stringify({ checkModel: "custom-judge-model" }),
    )

    const config = loadConfig(gitmemDir)
    expect(config.checkModel).toBe("custom-judge-model")
  })

  test("throws on invalid JSON", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(join(gitmemDir, "config.json"), "{invalid")

    expect(() => loadConfig(gitmemDir)).toThrow("not valid JSON")
    expect(() => loadConfig(gitmemDir)).toThrow(ConfigError)
  })

  test("throws on non-object JSON", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(join(gitmemDir, "config.json"), '"just a string"')

    expect(() => loadConfig(gitmemDir)).toThrow("must be a JSON object")
    expect(() => loadConfig(gitmemDir)).toThrow(ConfigError)
  })

  test("throws ConfigError on invalid ai value", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(join(gitmemDir, "config.json"), JSON.stringify({ ai: 42 }))

    expect(() => loadConfig(gitmemDir)).toThrow(ConfigError)
  })
})

describe("configExists", () => {
  let tempDir: string

  beforeEach(async () => {
    const raw = await mkdtemp(join(tmpdir(), "gitmem-config-test-"))
    tempDir = await Bun.$`realpath ${raw}`.text().then((t) => t.trim())
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("returns false when config does not exist", () => {
    expect(configExists(join(tempDir, ".gitmem"))).toBe(false)
  })

  test("returns true when config exists", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(join(gitmemDir, "config.json"), "{}")
    expect(configExists(gitmemDir)).toBe(true)
  })
})

describe("createConfig", () => {
  let tempDir: string

  beforeEach(async () => {
    const raw = await mkdtemp(join(tmpdir(), "gitmem-config-test-"))
    tempDir = await Bun.$`realpath ${raw}`.text().then((t) => t.trim())
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("creates config with defaults", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    const config = createConfig(gitmemDir)

    expect(config).toEqual(DEFAULTS)
    expect(existsSync(join(gitmemDir, "config.json"))).toBe(true)

    const written = JSON.parse(
      readFileSync(join(gitmemDir, "config.json"), "utf-8"),
    )
    expect(written).toEqual(DEFAULTS)
  })

  test("creates .gitmem directory if it does not exist", () => {
    const gitmemDir = join(tempDir, "nested", ".gitmem")
    createConfig(gitmemDir)
    expect(existsSync(gitmemDir)).toBe(true)
  })

  test("applies overrides", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    const config = createConfig(gitmemDir, {
      ai: false,
      indexStartDate: "2024-01-01",
      indexModel: "custom-model",
    })

    expect(config.ai).toBe(false)
    expect(config.indexStartDate).toBe("2024-01-01")
    expect(config.indexModel).toBe("custom-model")
    expect(config.checkModel).toBe(DEFAULTS.checkModel)
  })

  test("applies ai date override", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    const config = createConfig(gitmemDir, { ai: "2024-06-01" })
    expect(config.ai).toBe("2024-06-01")
  })

  test("throws when already initialized", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(join(gitmemDir, "config.json"), "{}")

    expect(() => createConfig(gitmemDir)).toThrow(
      "Already initialized. Edit .gitmem/config.json to change settings.",
    )
    expect(() => createConfig(gitmemDir)).toThrow(ConfigError)
  })

  test("throws on invalid ai date", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    expect(() => createConfig(gitmemDir, { ai: "not-a-date" })).toThrow(
      'must be true, false, or a valid "YYYY-MM-DD"',
    )
  })

  test("throws on invalid indexStartDate", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    expect(() =>
      createConfig(gitmemDir, { indexStartDate: "bad" as string }),
    ).toThrow('must be null or a valid "YYYY-MM-DD"')
  })

  test("throws on non-boolean non-string ai override", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    expect(() =>
      createConfig(gitmemDir, { ai: 42 as unknown as boolean }),
    ).toThrow('must be true, false, or a valid "YYYY-MM-DD"')
  })

  test("accepts null indexStartDate override", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    const config = createConfig(gitmemDir, { indexStartDate: null })
    expect(config.indexStartDate).toBeNull()
  })

  test("throws on non-null non-string indexStartDate override", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    expect(() =>
      createConfig(gitmemDir, {
        indexStartDate: 123 as unknown as string,
      }),
    ).toThrow('must be null or a valid "YYYY-MM-DD"')
  })

  test("throws on empty indexModel override", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    expect(() => createConfig(gitmemDir, { indexModel: "" })).toThrow(
      "non-empty string",
    )
  })

  test("throws on empty checkModel override", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    expect(() => createConfig(gitmemDir, { checkModel: "" })).toThrow(
      "non-empty string",
    )
  })

  test("applies checkModel override", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    const config = createConfig(gitmemDir, { checkModel: "custom-judge" })
    expect(config.checkModel).toBe("custom-judge")
  })
})

describe("getAiCoverage", () => {
  test("returns disabled when ai is false", () => {
    const config: GitmemConfig = { ...DEFAULTS, ai: false }
    const result = getAiCoverage(config, 0, 100)
    expect(result).toEqual({ status: "disabled" })
  })

  test("returns full when all commits are enriched", () => {
    const config: GitmemConfig = { ...DEFAULTS, ai: true }
    const result = getAiCoverage(config, 100, 100)
    expect(result).toEqual({ status: "full" })
  })

  test("returns full when total is 0", () => {
    const config: GitmemConfig = { ...DEFAULTS, ai: true }
    const result = getAiCoverage(config, 0, 0)
    expect(result).toEqual({ status: "full" })
  })

  test("returns partial when some commits are unenriched", () => {
    const config: GitmemConfig = { ...DEFAULTS, ai: true }
    const result = getAiCoverage(config, 50, 100)
    expect(result).toEqual({
      status: "partial",
      enriched: 50,
      total: 100,
      aiConfig: true,
    })
  })

  test("returns partial with date when ai is date string", () => {
    const config: GitmemConfig = { ...DEFAULTS, ai: "2024-06-01" }
    const result = getAiCoverage(config, 30, 100)
    expect(result).toEqual({
      status: "partial",
      enriched: 30,
      total: 100,
      aiConfig: "2024-06-01",
    })
  })
})

describe("isAiEnabled", () => {
  test("returns false when ai is false", () => {
    expect(isAiEnabled({ ...DEFAULTS, ai: false })).toBe(false)
  })

  test("returns true when ai is true", () => {
    expect(isAiEnabled({ ...DEFAULTS, ai: true })).toBe(true)
  })

  test("returns true when ai is a date string", () => {
    expect(isAiEnabled({ ...DEFAULTS, ai: "2024-06-01" })).toBe(true)
  })
})
