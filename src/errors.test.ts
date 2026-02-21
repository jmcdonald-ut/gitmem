import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"

import {
  AiRequiredError,
  ApiKeyError,
  AppError,
  ConfigError,
  GitError,
  InvalidQueryError,
  LockError,
  NotFoundError,
  NotInitializedError,
  ValidationError,
  handleError,
} from "@/errors"

describe("error subclasses", () => {
  test("ConfigError", () => {
    const err = new ConfigError("bad config")
    expect(err).toBeInstanceOf(AppError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("CONFIG_ERROR")
    expect(err.exitCode).toBe(3)
    expect(err.name).toBe("ConfigError")
    expect(err.message).toBe("bad config")
    expect(err.hint).toBeUndefined()
  })

  test("NotInitializedError", () => {
    const err = new NotInitializedError()
    expect(err).toBeInstanceOf(AppError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("NOT_INITIALIZED")
    expect(err.exitCode).toBe(3)
    expect(err.name).toBe("NotInitializedError")
    expect(err.message).toBe(
      "gitmem is not initialized. Run `gitmem init` first.",
    )
  })

  test("ValidationError", () => {
    const err = new ValidationError("invalid input")
    expect(err).toBeInstanceOf(AppError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("VALIDATION_ERROR")
    expect(err.exitCode).toBe(2)
    expect(err.name).toBe("ValidationError")
    expect(err.message).toBe("invalid input")
  })

  test("NotFoundError", () => {
    const err = new NotFoundError("no data")
    expect(err).toBeInstanceOf(AppError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("NOT_FOUND")
    expect(err.exitCode).toBe(4)
    expect(err.name).toBe("NotFoundError")
  })

  test("LockError", () => {
    const err = new LockError()
    expect(err).toBeInstanceOf(AppError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("LOCK_ERROR")
    expect(err.exitCode).toBe(6)
    expect(err.name).toBe("LockError")
    expect(err.message).toContain("another gitmem process is running")
  })

  test("GitError with default message", () => {
    const err = new GitError()
    expect(err).toBeInstanceOf(AppError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("GIT_ERROR")
    expect(err.exitCode).toBe(5)
    expect(err.name).toBe("GitError")
    expect(err.message).toBe("not a git repository")
  })

  test("GitError with custom message", () => {
    const err = new GitError("git failed")
    expect(err.message).toBe("git failed")
  })

  test("ApiKeyError", () => {
    const err = new ApiKeyError()
    expect(err).toBeInstanceOf(AppError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("API_KEY_ERROR")
    expect(err.exitCode).toBe(5)
    expect(err.name).toBe("ApiKeyError")
    expect(err.message).toBe(
      "ANTHROPIC_API_KEY environment variable is required",
    )
  })

  test("AiRequiredError", () => {
    const err = new AiRequiredError("AI is disabled")
    expect(err).toBeInstanceOf(AppError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("AI_REQUIRED")
    expect(err.exitCode).toBe(2)
    expect(err.name).toBe("AiRequiredError")
  })

  test("InvalidQueryError extracts fts5 message", () => {
    const cause = new Error("some prefix fts5: syntax error near X")
    const err = new InvalidQueryError("bad query", cause)
    expect(err).toBeInstanceOf(AppError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("INVALID_QUERY")
    expect(err.exitCode).toBe(2)
    expect(err.name).toBe("InvalidQueryError")
    expect(err.message).toContain("syntax error near X")
    expect(err.hint).toBe(
      'use quotes for phrases, e.g. gitmem query "memory leak"',
    )
  })

  test("InvalidQueryError with non-fts5 cause", () => {
    const err = new InvalidQueryError("bad query", new Error("other error"))
    expect(err.message).toContain("invalid query syntax")
    expect(err.hint).toBeDefined()
  })

  test("InvalidQueryError with non-Error cause", () => {
    const err = new InvalidQueryError("bad query", "string cause")
    expect(err.message).toContain("invalid query syntax")
  })
})

describe("handleError", () => {
  let exitSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>
  let logSpy: ReturnType<typeof spyOn>
  let exitCode: number | undefined

  beforeEach(() => {
    exitCode = undefined
    exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      exitCode = code as number
      throw new Error(`process.exit(${code})`)
    })
    errorSpy = spyOn(console, "error").mockImplementation(() => {})
    logSpy = spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    exitSpy.mockRestore()
    errorSpy.mockRestore()
    logSpy.mockRestore()
  })

  test("text mode: AppError without hint", () => {
    const err = new ConfigError("bad config")
    expect(() => handleError(err, "text")).toThrow("process.exit(3)")
    expect(exitCode).toBe(3)
    expect(errorSpy).toHaveBeenCalledWith("Error: bad config")
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  test("text mode: AppError with hint", () => {
    const err = new InvalidQueryError("bad", new Error("other"))
    expect(() => handleError(err, "text")).toThrow("process.exit(2)")
    expect(exitCode).toBe(2)
    expect(errorSpy).toHaveBeenCalledTimes(2)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Error:"))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Hint:"))
  })

  test("text mode: plain Error", () => {
    expect(() => handleError(new Error("boom"), "text")).toThrow(
      "process.exit(1)",
    )
    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith("Error: boom")
  })

  test("text mode: non-Error", () => {
    expect(() => handleError("string error", "text")).toThrow("process.exit(1)")
    expect(exitCode).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith("Error: string error")
  })

  test("json mode: AppError without hint", () => {
    const err = new GitError()
    expect(() => handleError(err, "json")).toThrow("process.exit(5)")
    expect(exitCode).toBe(5)
    const output = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(output).toEqual({
      success: false,
      error: "not a git repository",
      code: "GIT_ERROR",
    })
  })

  test("json mode: AppError with hint", () => {
    const err = new InvalidQueryError("q", new Error("other"))
    expect(() => handleError(err, "json")).toThrow("process.exit(2)")
    const output = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(output.success).toBe(false)
    expect(output.code).toBe("INVALID_QUERY")
    expect(output.hint).toBeDefined()
  })

  test("json mode: plain Error", () => {
    expect(() => handleError(new Error("boom"), "json")).toThrow(
      "process.exit(1)",
    )
    const output = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(output).toEqual({ success: false, error: "boom" })
  })
})
