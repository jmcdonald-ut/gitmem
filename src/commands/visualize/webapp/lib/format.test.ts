/// <reference lib="dom" />
import { describe, expect, test } from "bun:test"

import { fmt, smartTruncate } from "@visualize-app/lib/format"

describe("fmt", () => {
  test("formats a number with locale string", () => {
    const result = fmt(1234)
    expect(result).toBe("1,234")
  })

  test("returns em dash for null", () => {
    expect(fmt(null)).toBe("\u2014")
  })

  test("returns em dash for undefined", () => {
    expect(fmt(undefined)).toBe("\u2014")
  })

  test("formats zero", () => {
    expect(fmt(0)).toBe("0")
  })
})

describe("smartTruncate", () => {
  test("returns short paths unchanged", () => {
    expect(smartTruncate("src/foo.ts", 40)).toBe("src/foo.ts")
  })

  test("returns empty string unchanged", () => {
    expect(smartTruncate("", 40)).toBe("")
  })

  test("truncates long paths with ellipsis", () => {
    const long = "src/commands/visualize/webapp/components/CirclePacking.tsx"
    const result = smartTruncate(long, 30)
    expect(result).toContain("/.../")
    expect(result.length).toBeLessThanOrEqual(30)
  })

  test("returns two-segment paths unchanged even if long", () => {
    const path = "very-long-directory-name/very-long-file-name.tsx"
    expect(smartTruncate(path, 10)).toBe(path)
  })

  test("includes more segments from the end when space allows", () => {
    const path = "src/a/b/c/d/e.ts"
    const result = smartTruncate(path, 15)
    // Should include extra segment "d" beyond the minimum "src/.../e.ts"
    expect(result).toBe("src/.../d/e.ts")
  })
})
