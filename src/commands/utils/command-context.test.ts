import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
  spyOn,
} from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm, realpath } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import {
  runCommand,
  getDbPath,
  type CommandContext,
} from "@commands/utils/command-context"
import { createDatabase } from "@db/database"

describe("getDbPath", () => {
  let originalCwd: string
  let tempDir: string

  beforeEach(async () => {
    originalCwd = process.cwd()
    tempDir = await realpath(await mkdtemp(join(tmpdir(), "gitmem-test-")))
    process.chdir(tempDir)
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(tempDir, { recursive: true })
  })

  test("returns path under .gitmem directory", () => {
    const result = getDbPath()
    expect(result).toBe(join(tempDir, ".gitmem", "index.db"))
  })

  test("creates .gitmem directory if it does not exist", async () => {
    const result = getDbPath()
    const { existsSync } = await import("fs")
    expect(existsSync(join(tempDir, ".gitmem"))).toBe(true)
    expect(result.endsWith("index.db")).toBe(true)
  })
})

describe("runCommand", () => {
  let tempDir: string
  let originalCwd: string
  let exitSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>
  let exitCode: number | undefined

  beforeEach(async () => {
    originalCwd = process.cwd()
    tempDir = await realpath(await mkdtemp(join(tmpdir(), "gitmem-test-")))
    process.chdir(tempDir)
    exitCode = undefined
    exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      exitCode = code as number
      throw new Error(`process.exit(${code})`)
    })
    errorSpy = spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    exitSpy.mockRestore()
    errorSpy.mockRestore()
    await rm(tempDir, { recursive: true })
  })

  test("exits with 1 when not a git repo", async () => {
    await expect(runCommand({}, {}, async () => {})).rejects.toThrow(
      "process.exit(1)",
    )

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith("Error: not a git repository")
  })

  test("exits with 1 when API key missing and needsApiKey is true", async () => {
    // Set up a git repo so git check passes
    const { $ } = await import("bun")
    await $`git init ${tempDir}`.quiet()

    const originalKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    try {
      await expect(
        runCommand({}, { needsApiKey: true, needsDb: false }, async () => {}),
      ).rejects.toThrow("process.exit(1)")

      expect(exitCode).toBe(1)
      expect(errorSpy).toHaveBeenCalledWith(
        "Error: ANTHROPIC_API_KEY environment variable is required",
      )
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey
      }
    }
  })

  test("exits with 1 when db does not exist and dbMustExist is true", async () => {
    const { $ } = await import("bun")
    await $`git init ${tempDir}`.quiet()

    await expect(
      runCommand({}, { needsApiKey: false }, async () => {}),
    ).rejects.toThrow("process.exit(1)")

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      "Error: no index found. Run `gitmem index` first.",
    )
  })

  test("creates db when dbMustExist is false", async () => {
    const { $ } = await import("bun")
    await $`git init ${tempDir}`.quiet()

    const handler = mock(async () => {})

    await runCommand({}, { needsApiKey: false, dbMustExist: false }, handler)

    expect(handler).toHaveBeenCalledTimes(1)
    const calls = handler.mock.calls as unknown as [[CommandContext]]
    const ctx = calls[0][0]
    expect(ctx.db).toBeDefined()
    expect(ctx.dbPath).toContain("index.db")
  })

  test("closes db even when handler throws", async () => {
    const { $ } = await import("bun")
    await $`git init ${tempDir}`.quiet()

    // Create the db file so dbMustExist check passes
    const dbPath = join(tempDir, ".gitmem", "index.db")
    const { mkdirSync } = await import("fs")
    mkdirSync(join(tempDir, ".gitmem"), { recursive: true })
    const tempDb = createDatabase(dbPath)
    tempDb.close()

    let capturedDb: Database | undefined

    await expect(
      runCommand({}, {}, async (ctx) => {
        capturedDb = ctx.db
        throw new Error("handler failed")
      }),
    ).rejects.toThrow("handler failed")

    // Verify db was closed by trying to run a query — should throw
    expect(() => capturedDb!.query("SELECT 1")).toThrow()
  })

  test("resolves format correctly from program opts", async () => {
    const { $ } = await import("bun")
    await $`git init ${tempDir}`.quiet()

    const dbPath = join(tempDir, ".gitmem", "index.db")
    const { mkdirSync } = await import("fs")
    mkdirSync(join(tempDir, ".gitmem"), { recursive: true })
    const tempDb = createDatabase(dbPath)
    tempDb.close()

    const handler = mock(async () => {})

    await runCommand({ json: true }, {}, handler)

    const calls = handler.mock.calls as unknown as [[CommandContext]]
    expect(calls[0][0].format).toBe("json")
  })

  test("skips git check when needsGit is false", async () => {
    // No git repo — would fail if git check ran
    const handler = mock(async () => {})

    await runCommand({}, { needsGit: false, needsDb: false }, handler)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  test("skips db when needsDb is false", async () => {
    const { $ } = await import("bun")
    await $`git init ${tempDir}`.quiet()

    const handler = mock(async () => {})

    await runCommand({}, { needsDb: false }, handler)

    expect(handler).toHaveBeenCalledTimes(1)
    // db should be undefined-ish (not initialized)
    const calls = handler.mock.calls as unknown as [[CommandContext]]
    const ctx = calls[0][0]
    expect(ctx.dbPath).toBe("")
  })

  test("passes API key to handler when needsApiKey is true", async () => {
    const { $ } = await import("bun")
    await $`git init ${tempDir}`.quiet()

    const originalKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key-123"

    try {
      const handler = mock(async () => {})
      await runCommand({}, { needsApiKey: true, needsDb: false }, handler)

      expect(handler).toHaveBeenCalledTimes(1)
      const calls = handler.mock.calls as unknown as [[CommandContext]]
      expect(calls[0][0].apiKey).toBe("test-key-123")
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey
      } else {
        delete process.env.ANTHROPIC_API_KEY
      }
    }
  })

  test("acquires and releases lock when needsLock is true", async () => {
    const { $ } = await import("bun")
    const { existsSync } = await import("fs")
    await $`git init ${tempDir}`.quiet()

    const dbPath = join(tempDir, ".gitmem", "index.db")
    const { mkdirSync } = await import("fs")
    mkdirSync(join(tempDir, ".gitmem"), { recursive: true })
    const tempDb = createDatabase(dbPath)
    tempDb.close()

    const lockPath = join(tempDir, ".gitmem", "index.lock")
    let lockExistedDuringHandler = false

    await runCommand({}, { needsApiKey: false, needsLock: true }, async () => {
      lockExistedDuringHandler = existsSync(lockPath)
    })

    expect(lockExistedDuringHandler).toBe(true)
    expect(existsSync(lockPath)).toBe(false)
  })

  test("releases lock when handler throws", async () => {
    const { $ } = await import("bun")
    const { existsSync } = await import("fs")
    await $`git init ${tempDir}`.quiet()

    const dbPath = join(tempDir, ".gitmem", "index.db")
    const { mkdirSync } = await import("fs")
    mkdirSync(join(tempDir, ".gitmem"), { recursive: true })
    const tempDb = createDatabase(dbPath)
    tempDb.close()

    const lockPath = join(tempDir, ".gitmem", "index.lock")

    await expect(
      runCommand({}, { needsApiKey: false, needsLock: true }, async () => {
        throw new Error("handler failed")
      }),
    ).rejects.toThrow("handler failed")

    expect(existsSync(lockPath)).toBe(false)
  })

  test("rethrows non-EEXIST errors from lock acquisition", async () => {
    const { $ } = await import("bun")
    const { mkdirSync, chmodSync } = await import("fs")
    await $`git init ${tempDir}`.quiet()

    mkdirSync(join(tempDir, ".gitmem"), { recursive: true })
    const dbPath = join(tempDir, ".gitmem", "index.db")
    const tempDb = createDatabase(dbPath)
    tempDb.close()

    // Make directory read-only so openSync fails with EACCES, not EEXIST
    chmodSync(join(tempDir, ".gitmem"), 0o555)

    try {
      await expect(
        runCommand({}, { needsApiKey: false, needsLock: true }, async () => {}),
      ).rejects.toThrow()

      // Should NOT be our lock-exists message — it should be a raw EACCES
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("another gitmem process"),
      )
    } finally {
      chmodSync(join(tempDir, ".gitmem"), 0o755)
    }
  })

  test("exits with 1 when lock file already exists", async () => {
    const { $ } = await import("bun")
    const { writeFileSync, mkdirSync } = await import("fs")
    await $`git init ${tempDir}`.quiet()

    const dbPath = join(tempDir, ".gitmem", "index.db")
    mkdirSync(join(tempDir, ".gitmem"), { recursive: true })
    const tempDb = createDatabase(dbPath)
    tempDb.close()

    // Create the lock file before running
    const lockPath = join(tempDir, ".gitmem", "index.lock")
    writeFileSync(lockPath, "12345\n")

    await expect(
      runCommand({}, { needsApiKey: false, needsLock: true }, async () => {}),
    ).rejects.toThrow("process.exit(1)")

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      "Error: another gitmem process is running (lock file exists: .gitmem/index.lock)",
    )
  })

  test("passes config to handler", async () => {
    const { $ } = await import("bun")
    await $`git init ${tempDir}`.quiet()

    const handler = mock(async () => {})

    await runCommand({}, { needsApiKey: false, dbMustExist: false }, handler)

    expect(handler).toHaveBeenCalledTimes(1)
    const calls = handler.mock.calls as unknown as [[CommandContext]]
    const ctx = calls[0][0]
    expect(ctx.config).toBeDefined()
    expect(ctx.config.ai).toBe(true)
    expect(ctx.config.indexModel).toBe("claude-haiku-4-5-20251001")
  })

  test("skips API key check when AI is disabled", async () => {
    const { $ } = await import("bun")
    const { mkdirSync, writeFileSync } = await import("fs")
    await $`git init ${tempDir}`.quiet()

    // Write config with ai: false
    mkdirSync(join(tempDir, ".gitmem"), { recursive: true })
    writeFileSync(
      join(tempDir, ".gitmem", "config.json"),
      JSON.stringify({ ai: false }),
    )

    const originalKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    try {
      const handler = mock(async () => {})
      await runCommand({}, { needsApiKey: true, needsDb: false }, handler)

      // Should NOT exit — API key is not needed when AI is disabled
      expect(handler).toHaveBeenCalledTimes(1)
      const calls = handler.mock.calls as unknown as [[CommandContext]]
      expect(calls[0][0].config.ai).toBe(false)
      expect(calls[0][0].apiKey).toBe("")
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey
      }
    }
  })

  test("exits with error on invalid config", async () => {
    const { $ } = await import("bun")
    const { mkdirSync, writeFileSync } = await import("fs")
    await $`git init ${tempDir}`.quiet()

    mkdirSync(join(tempDir, ".gitmem"), { recursive: true })
    writeFileSync(join(tempDir, ".gitmem", "config.json"), "{invalid")

    await expect(
      runCommand({}, { needsDb: false }, async () => {}),
    ).rejects.toThrow("process.exit(1)")

    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("not valid JSON"),
    )
  })
})
