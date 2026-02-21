import type { OutputFormat } from "@/types"

export type ErrorCode =
  | "CONFIG_ERROR"
  | "NOT_INITIALIZED"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "LOCK_ERROR"
  | "GIT_ERROR"
  | "API_KEY_ERROR"
  | "AI_REQUIRED"
  | "INVALID_QUERY"

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode
  abstract readonly exitCode: number
  readonly hint?: string

  constructor(message: string, hint?: string) {
    super(message)
    this.name = this.constructor.name
    this.hint = hint
  }
}

export class ConfigError extends AppError {
  readonly code = "CONFIG_ERROR" as const
  readonly exitCode = 3

  constructor(message: string) {
    super(message)
  }
}

export class NotInitializedError extends AppError {
  readonly code = "NOT_INITIALIZED" as const
  readonly exitCode = 3

  constructor() {
    super("gitmem is not initialized. Run `gitmem init` first.")
  }
}

export class ValidationError extends AppError {
  readonly code = "VALIDATION_ERROR" as const
  readonly exitCode = 2

  constructor(message: string) {
    super(message)
  }
}

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND" as const
  readonly exitCode = 4

  constructor(message: string) {
    super(message)
  }
}

export class LockError extends AppError {
  readonly code = "LOCK_ERROR" as const
  readonly exitCode = 6

  constructor() {
    super(
      "another gitmem process is running (lock file exists: .gitmem/index.lock)",
    )
  }
}

export class GitError extends AppError {
  readonly code = "GIT_ERROR" as const
  readonly exitCode = 5

  constructor(message: string = "not a git repository") {
    super(message)
  }
}

export class ApiKeyError extends AppError {
  readonly code = "API_KEY_ERROR" as const
  readonly exitCode = 5

  constructor() {
    super("ANTHROPIC_API_KEY environment variable is required")
  }
}

export class AiRequiredError extends AppError {
  readonly code = "AI_REQUIRED" as const
  readonly exitCode = 2

  constructor(message: string) {
    super(message)
  }
}

export class InvalidQueryError extends AppError {
  readonly code = "INVALID_QUERY" as const
  readonly exitCode = 2

  constructor(query: string, cause: unknown) {
    const detail =
      cause instanceof Error && cause.message.includes("fts5")
        ? cause.message.replace(/^.*fts5: /, "")
        : "invalid query syntax"
    super(
      `Invalid search query "${query}": ${detail}`,
      'use quotes for phrases, e.g. gitmem query "memory leak"',
    )
  }
}

export function handleError(err: unknown, format: OutputFormat): never {
  let message: string
  let code: string | undefined
  let hint: string | undefined
  let exitCode = 1

  if (err instanceof AppError) {
    message = err.message
    code = err.code
    hint = err.hint
    exitCode = err.exitCode
  } else if (err instanceof Error) {
    message = err.message
  } else {
    message = String(err)
  }

  if (format === "json") {
    const payload: Record<string, unknown> = { success: false, error: message }
    if (code) payload.code = code
    if (hint) payload.hint = hint
    console.log(JSON.stringify(payload, null, 2))
  } else {
    console.error(`Error: ${message}`)
    if (hint) console.error(`Hint: ${hint}`)
  }

  process.exit(exitCode)
}
