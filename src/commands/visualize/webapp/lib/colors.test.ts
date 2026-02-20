/// <reference lib="dom" />
import { describe, test, expect } from "bun:test"
import { COLORS, scoreColor } from "./colors"

describe("COLORS", () => {
  test("has all classification colors", () => {
    expect(COLORS["bug-fix"]).toBe("#EF4E4E")
    expect(COLORS["feature"]).toBe("#3EBD93")
    expect(COLORS["refactor"]).toBe("#F7C948")
    expect(COLORS["docs"]).toBe("#47A3F3")
    expect(COLORS["chore"]).toBe("#9FB3C8")
    expect(COLORS["perf"]).toBe("#9446ED")
    expect(COLORS["test"]).toBe("#38BEC9")
    expect(COLORS["style"]).toBe("#F0F4F8")
  })
})

describe("scoreColor", () => {
  test("returns green at 0", () => {
    expect(scoreColor(0)).toMatch(/rgb/)
  })

  test("returns red at 1", () => {
    expect(scoreColor(1)).toMatch(/rgb/)
  })

  test("returns a color at midpoint", () => {
    expect(scoreColor(0.5)).toMatch(/rgb/)
  })

  test("returns different colors for different scores", () => {
    const low = scoreColor(0)
    const high = scoreColor(1)
    expect(low).not.toBe(high)
  })
})
