import type { Database } from "bun:sqlite"
import { existsSync, unlinkSync, writeFileSync } from "fs"
import { closeSync, openSync } from "fs"
import { constants } from "fs"
import { join, resolve } from "path"

import type { GitmemConfig } from "@/config"
import { DEFAULTS, isAiEnabled, loadConfig } from "@/config"
import { formatOutput, resolveFormat } from "@/output"
import type { OutputFormat } from "@/types"
import { createDatabase } from "@db/database"
import { GitService } from "@services/git"

export interface CommandContext {
  format: OutputFormat
  cwd: string
  git: GitService
  apiKey: string
  db: Database
  dbPath: string
  config: GitmemConfig
}

export interface CommandRequirements {
  needsGit?: boolean
  needsApiKey?: boolean
  needsDb?: boolean
  dbMustExist?: boolean
  /** Whether this command performs writes and needs an exclusive lock. */
  needsLock?: boolean
  /** Whether this command requires an initialized config. Defaults to true. */
  needsConfig?: boolean
}

export function getDbPath(): string {
  return join(resolve(process.cwd(), ".gitmem"), "index.db")
}

function getLockPath(): string {
  return resolve(process.cwd(), ".gitmem", "index.lock")
}

function acquireLock(): string {
  const lockPath = getLockPath()
  try {
    const fd = openSync(
      lockPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    )
    const content = `${process.pid}\n`
    writeFileSync(fd, content)
    closeSync(fd)
    return lockPath
  } catch (err) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === "EEXIST"
    ) {
      console.error(
        "Error: another gitmem process is running (lock file exists: .gitmem/index.lock)",
      )
      process.exit(1)
    }
    throw err
  }
}

function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath)
  } catch {
    // Lock may already be removed; ignore
  }
}

export async function runCommand(
  programOpts: { format?: string; json?: boolean },
  requirements: CommandRequirements,
  handler: (ctx: CommandContext) => void | Promise<void>,
): Promise<void> {
  const format = resolveFormat(programOpts)
  const cwd = process.cwd()

  let git: GitService | undefined
  if (requirements.needsGit !== false) {
    git = new GitService(cwd)
    if (!(await git.isGitRepo())) {
      console.error("Error: not a git repository")
      process.exit(1)
    }
  }

  const gitmemDir = resolve(cwd, ".gitmem")
  let config: GitmemConfig
  if (requirements.needsConfig === false) {
    config = { ...DEFAULTS }
  } else {
    try {
      config = loadConfig(gitmemDir)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (format === "json") {
        formatOutput("json", { success: false, error: message })
      } else {
        console.error(`Error: ${message}`)
      }
      process.exit(1)
    }
  }

  let apiKey = ""
  if (requirements.needsApiKey && isAiEnabled(config)) {
    apiKey = process.env.ANTHROPIC_API_KEY ?? ""
    if (!apiKey) {
      console.error("Error: ANTHROPIC_API_KEY environment variable is required")
      process.exit(1)
    }
  }

  let db: Database | undefined
  let dbPath = ""
  let lockPath: string | undefined
  if (requirements.needsDb !== false) {
    dbPath = getDbPath()
    if (requirements.dbMustExist !== false && !existsSync(dbPath)) {
      console.error("Error: no index found. Run `gitmem index` first.")
      process.exit(1)
    }
    if (requirements.needsLock) {
      lockPath = acquireLock()
    }
    db = createDatabase(dbPath)
  }

  try {
    await handler({ format, cwd, git: git!, apiKey, db: db!, dbPath, config })
  } finally {
    db?.close()
    if (lockPath) releaseLock(lockPath)
  }
}
