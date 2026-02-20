/// <reference lib="dom" />
import { describe, test, expect } from "bun:test"
import { COLORS, scoreColor } from "./colors"

describe("COLORS", () => {
  test("has all classification colors as CSS custom property references", () => {
    expect(COLORS["bug-fix"]).toBe("var(--red)")
    expect(COLORS["feature"]).toBe("var(--green)")
    expect(COLORS["refactor"]).toBe("var(--yellow)")
    expect(COLORS["docs"]).toBe("var(--blue)")
    expect(COLORS["chore"]).toBe("var(--gray)")
    expect(COLORS["perf"]).toBe("var(--purple)")
    expect(COLORS["test"]).toBe("var(--cyan)")
    expect(COLORS["style"]).toBe("var(--white)")
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
