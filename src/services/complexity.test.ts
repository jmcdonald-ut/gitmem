import { describe, test, expect } from "bun:test"
import { computeComplexity, isBinary, isGenerated } from "@services/complexity"

describe("computeComplexity", () => {
  test("handles empty content", () => {
    const result = computeComplexity("")
    expect(result.linesOfCode).toBe(0)
    expect(result.indentComplexity).toBe(0)
    expect(result.maxIndent).toBe(0)
  })

  test("counts non-blank lines", () => {
    const content = "line 1\n\nline 3\n\n"
    const result = computeComplexity(content)
    expect(result.linesOfCode).toBe(2)
  })

  test("computes indent levels from spaces", () => {
    const content = [
      "function foo() {",
      "    if (true) {",
      "        return 1",
      "    }",
      "}",
    ].join("\n")
    const result = computeComplexity(content)
    expect(result.linesOfCode).toBe(5)
    // indent levels: 0, 1, 2, 1, 0 = sum 4
    expect(result.indentComplexity).toBe(4)
    expect(result.maxIndent).toBe(2)
  })

  test("handles tabs", () => {
    const content = "no indent\n\tone tab\n\t\ttwo tabs"
    const result = computeComplexity(content)
    expect(result.linesOfCode).toBe(3)
    // indent levels: 0, 1, 2
    expect(result.indentComplexity).toBe(3)
    expect(result.maxIndent).toBe(2)
  })

  test("handles mixed tabs and spaces", () => {
    const content = "\t  code" // tab(4) + 2 spaces = 6 leading, floor(6/4) = 1
    const result = computeComplexity(content)
    expect(result.linesOfCode).toBe(1)
    expect(result.indentComplexity).toBe(1)
    expect(result.maxIndent).toBe(1)
  })

  test("respects custom tabWidth", () => {
    const content = "  code" // 2 spaces with tabWidth=2 => level 1
    const result = computeComplexity(content, 2)
    expect(result.indentComplexity).toBe(1)
    expect(result.maxIndent).toBe(1)
  })

  test("skips blank-only lines", () => {
    const content = "   \n\t\n  \t  \nactual code"
    const result = computeComplexity(content)
    expect(result.linesOfCode).toBe(1)
    expect(result.indentComplexity).toBe(0)
    expect(result.maxIndent).toBe(0)
  })

  test("computes realistic TypeScript complexity", () => {
    const content = [
      "export class Foo {",
      "    private bar: string",
      "",
      "    constructor() {",
      "        this.bar = 'hello'",
      "        if (true) {",
      "            console.log('deep')",
      "        }",
      "    }",
      "}",
    ].join("\n")
    const result = computeComplexity(content)
    expect(result.linesOfCode).toBe(9)
    // levels: 0, 1, 1, 2, 2, 3, 2, 1, 0 = 12
    expect(result.indentComplexity).toBe(12)
    expect(result.maxIndent).toBe(3)
  })
})

describe("isBinary", () => {
  test("returns false for text content", () => {
    const buf = Buffer.from("Hello, world!\nThis is text.\n")
    expect(isBinary(buf)).toBe(false)
  })

  test("returns true for content with NUL byte", () => {
    const buf = Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f])
    expect(isBinary(buf)).toBe(true)
  })

  test("returns false for empty buffer", () => {
    expect(isBinary(Buffer.alloc(0))).toBe(false)
  })

  test("only checks first 8KB", () => {
    const buf = Buffer.alloc(16384, 0x41) // all 'A's
    buf[10000] = 0 // NUL after 8KB
    expect(isBinary(buf)).toBe(false)
  })

  test("detects NUL within first 8KB of large buffer", () => {
    const buf = Buffer.alloc(16384, 0x41)
    buf[4000] = 0 // NUL within first 8KB
    expect(isBinary(buf)).toBe(true)
  })
})

describe("isGenerated", () => {
  test("detects lock files by exact name", () => {
    expect(isGenerated("package-lock.json")).toBe(true)
    expect(isGenerated("yarn.lock")).toBe(true)
    expect(isGenerated("bun.lockb")).toBe(true)
    expect(isGenerated("pnpm-lock.yaml")).toBe(true)
    expect(isGenerated("Gemfile.lock")).toBe(true)
    expect(isGenerated("Cargo.lock")).toBe(true)
    expect(isGenerated("composer.lock")).toBe(true)
    expect(isGenerated("poetry.lock")).toBe(true)
    expect(isGenerated("go.sum")).toBe(true)
  })

  test("detects lock files in subdirectories", () => {
    expect(isGenerated("frontend/package-lock.json")).toBe(true)
    expect(isGenerated("deep/nested/yarn.lock")).toBe(true)
  })

  test("detects minified files", () => {
    expect(isGenerated("dist/bundle.min.js")).toBe(true)
    expect(isGenerated("styles.min.css")).toBe(true)
  })

  test("detects sourcemaps", () => {
    expect(isGenerated("bundle.js.map")).toBe(true)
  })

  test("detects .lock extension", () => {
    expect(isGenerated("some-custom.lock")).toBe(true)
  })

  test("returns false for normal source files", () => {
    expect(isGenerated("src/main.ts")).toBe(false)
    expect(isGenerated("package.json")).toBe(false)
    expect(isGenerated("README.md")).toBe(false)
    expect(isGenerated("src/lock-service.ts")).toBe(false)
  })
})
