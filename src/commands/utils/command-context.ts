import type { Database } from "bun:sqlite"
import type { OutputFormat } from "@/types"
import { GitService } from "@services/git"
import { createDatabase } from "@db/database"
import { resolveFormat } from "@/output"
import { resolve, join } from "path"
import { existsSync, mkdirSync } from "fs"

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
}

export function getDbPath(): string {
  const dir = resolve(process.cwd(), ".gitmem")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, "index.db")
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
  if (requirements.needsDb !== false) {
    dbPath = getDbPath()
    if (requirements.dbMustExist !== false && !existsSync(dbPath)) {
      console.error("Error: no index found. Run `gitmem index` first.")
      process.exit(1)
    }
    db = createDatabase(dbPath)
  }

  try {
    await handler({ format, cwd, git: git!, apiKey, db: db!, dbPath })
  } finally {
    db?.close()
  }
}
