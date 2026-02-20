import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import {
  loadConfig,
  getAiCoverage,
  isAiEnabled,
  DEFAULTS,
  type GitmemConfig,
} from "@/config"

describe("loadConfig", () => {
  let tempDir: string

  beforeEach(async () => {
    const raw = await mkdtemp(join(tmpdir(), "gitmem-config-test-"))
    tempDir = await Bun.$`realpath ${raw}`.text().then((t) => t.trim())
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  test("creates config with defaults when file does not exist", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    const config = loadConfig(gitmemDir)

    expect(config).toEqual(DEFAULTS)
    expect(existsSync(join(gitmemDir, "config.json"))).toBe(true)

    const written = JSON.parse(
      readFileSync(join(gitmemDir, "config.json"), "utf-8"),
    )
    expect(written.ai).toBe(true)
    expect(written.indexStartDate).toBeNull()
    expect(written.indexModel).toBe("claude-haiku-4-5-20251001")
    expect(written.checkModel).toBe("claude-sonnet-4-5-20250929")
  })

  test("creates .gitmem directory if it does not exist", () => {
    const gitmemDir = join(tempDir, "nested", ".gitmem")
    loadConfig(gitmemDir)
    expect(existsSync(gitmemDir)).toBe(true)
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
  })

  test("throws on non-object JSON", () => {
    const gitmemDir = join(tempDir, ".gitmem")
    mkdirSync(gitmemDir, { recursive: true })
    writeFileSync(join(gitmemDir, "config.json"), '"just a string"')

    expect(() => loadConfig(gitmemDir)).toThrow("must be a JSON object")
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
