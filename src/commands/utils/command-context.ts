import type { Database } from "bun:sqlite"
import { existsSync, unlinkSync, writeFileSync } from "fs"
import { closeSync, openSync } from "fs"
import { constants } from "fs"
import { join, resolve } from "path"

import type { GitmemConfig } from "@/config"
import { DEFAULTS, isAiEnabled, loadConfig } from "@/config"
import {
  ApiKeyError,
  GitError,
  LockError,
  NotFoundError,
  handleError,
} from "@/errors"
import { resolveFormat } from "@/output"
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
      throw new LockError()
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
  let db: Database | undefined
  let lockPath: string | undefined

  try {
    let git: GitService | undefined
    if (requirements.needsGit !== false) {
      git = new GitService(cwd)
      if (!(await git.isGitRepo())) {
        throw new GitError()
      }
    }

    const gitmemDir = resolve(cwd, ".gitmem")
    let config: GitmemConfig
    if (requirements.needsConfig === false) {
      config = { ...DEFAULTS }
    } else {
      config = loadConfig(gitmemDir)
    }

    let apiKey = ""
    if (requirements.needsApiKey && isAiEnabled(config)) {
      apiKey = process.env.ANTHROPIC_API_KEY ?? ""
      if (!apiKey) {
        throw new ApiKeyError()
      }
    }

    let dbPath = ""
    if (requirements.needsDb !== false) {
      dbPath = getDbPath()
      if (requirements.dbMustExist !== false && !existsSync(dbPath)) {
        throw new NotFoundError("no index found. Run `gitmem index` first.")
      }
      if (requirements.needsLock) {
        lockPath = acquireLock()
      }
      db = createDatabase(dbPath)
    }

    await handler({ format, cwd, git: git!, apiKey, db: db!, dbPath, config })
  } catch (err) {
    handleError(err, format)
  } finally {
    db?.close()
    if (lockPath) releaseLock(lockPath)
  }
}
