import type { Database } from "bun:sqlite"
import type { OutputFormat } from "@/types"
import { GitService } from "@services/git"
import { createDatabase } from "@db/database"
import { resolveFormat } from "@/output"
import { resolve, join } from "path"
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs"
import { openSync, closeSync } from "fs"
import { constants } from "fs"

export interface CommandContext {
  format: OutputFormat
  cwd: string
  git: GitService
  apiKey: string
  db: Database
  dbPath: string
}

export interface CommandRequirements {
  needsGit?: boolean
  needsApiKey?: boolean
  needsDb?: boolean
  dbMustExist?: boolean
  /** Whether this command performs writes and needs an exclusive lock. */
  needsLock?: boolean
}

export function getDbPath(): string {
  const dir = resolve(process.cwd(), ".gitmem")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, "index.db")
}

function getLockPath(): string {
  return resolve(process.cwd(), ".gitmem", "index.lock")
}

function acquireLock(): string {
  const lockPath = getLockPath()
  try {
    const fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY)
    const content = `${process.pid}\n`
    writeFileSync(fd, content)
    closeSync(fd)
    return lockPath
  } catch (err: any) {
    if (err.code === "EEXIST") {
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
  handler: (ctx: CommandContext) => Promise<void>,
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

  let apiKey = ""
  if (requirements.needsApiKey) {
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
    await handler({ format, cwd, git: git!, apiKey, db: db!, dbPath })
  } finally {
    db?.close()
    if (lockPath) releaseLock(lockPath)
  }
}
