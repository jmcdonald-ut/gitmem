import { describe, test, expect, spyOn } from "bun:test"
import { resolveFormat, formatOutput } from "@/output"

describe("resolveFormat", () => {
  test("defaults to text when no options provided", () => {
    expect(resolveFormat({})).toBe("text")
  })

  test("returns json when --format json", () => {
    expect(resolveFormat({ format: "json" })).toBe("json")
  })

  test("returns text when --format text", () => {
    expect(resolveFormat({ format: "text" })).toBe("text")
  })

  test("returns json when --json shorthand", () => {
    expect(resolveFormat({ json: true })).toBe("json")
  })

  test("--json takes precedence over --format text", () => {
    expect(resolveFormat({ format: "text", json: true })).toBe("json")
  })
})

describe("formatOutput", () => {
  test("returns false for text format", () => {
    expect(formatOutput("text", { foo: "bar" })).toBe(false)
  })

  test("returns true and writes JSON for json format", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {})
    const result = formatOutput("json", { key: "value" })
    expect(result).toBe(true)
    expect(spy).toHaveBeenCalledWith(JSON.stringify({ key: "value" }, null, 2))
    spy.mockRestore()
  })

  test("handles nested objects and null values", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {})
    const data = { nested: { a: 1 }, empty: null }
    formatOutput("json", data)
    expect(spy).toHaveBeenCalledWith(JSON.stringify(data, null, 2))
    spy.mockRestore()
  })
})
