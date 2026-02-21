import { parsePositiveInt } from "./parse-int"
import { describe, expect, test } from "bun:test"
import { InvalidArgumentError } from "commander"

describe("parsePositiveInt", () => {
  test("parses valid positive integers", () => {
    expect(parsePositiveInt("1")).toBe(1)
    expect(parsePositiveInt("10")).toBe(10)
    expect(parsePositiveInt("999")).toBe(999)
  })

  test("rejects NaN", () => {
    expect(() => parsePositiveInt("abc")).toThrow(InvalidArgumentError)
    expect(() => parsePositiveInt("")).toThrow(InvalidArgumentError)
    expect(() => parsePositiveInt("twelve")).toThrow(InvalidArgumentError)
  })

  test("rejects zero", () => {
    expect(() => parsePositiveInt("0")).toThrow(InvalidArgumentError)
  })

  test("rejects negative numbers", () => {
    expect(() => parsePositiveInt("-1")).toThrow(InvalidArgumentError)
    expect(() => parsePositiveInt("-100")).toThrow(InvalidArgumentError)
  })

  test("rejects floats by truncating then validating", () => {
    expect(parsePositiveInt("3.7")).toBe(3)
  })
})
