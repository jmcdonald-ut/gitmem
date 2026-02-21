import { describe, expect, test } from "bun:test"

import {
  filterByTrackedFiles,
  filterPairsByTrackedFiles,
  isGenerated,
} from "@/file-filter"

describe("isGenerated", () => {
  test("matches generated filenames", () => {
    expect(isGenerated("package-lock.json")).toBe(true)
    expect(isGenerated("yarn.lock")).toBe(true)
  })

  test("does not match normal files", () => {
    expect(isGenerated("src/main.ts")).toBe(false)
    expect(isGenerated("package.json")).toBe(false)
  })
})

describe("filterByTrackedFiles", () => {
  test("filters items to only tracked files", () => {
    const items = [
      { file_path: "a.ts", total: 5 },
      { file_path: "b.ts", total: 3 },
      { file_path: "c.ts", total: 1 },
    ]
    const tracked = new Set(["a.ts", "c.ts"])
    const result = filterByTrackedFiles(items, tracked, 10)
    expect(result).toEqual([
      { file_path: "a.ts", total: 5 },
      { file_path: "c.ts", total: 1 },
    ])
  })

  test("respects limit after filtering", () => {
    const items = [
      { file_path: "a.ts" },
      { file_path: "b.ts" },
      { file_path: "c.ts" },
    ]
    const tracked = new Set(["a.ts", "b.ts", "c.ts"])
    const result = filterByTrackedFiles(items, tracked, 2)
    expect(result).toEqual([{ file_path: "a.ts" }, { file_path: "b.ts" }])
  })

  test("returns empty array when no files are tracked", () => {
    const items = [{ file_path: "a.ts" }, { file_path: "b.ts" }]
    const result = filterByTrackedFiles(items, new Set(), 10)
    expect(result).toEqual([])
  })
})

describe("filterPairsByTrackedFiles", () => {
  test("filters pairs where both files must be tracked", () => {
    const pairs = [
      { file_a: "a.ts", file_b: "b.ts", count: 5 },
      { file_a: "a.ts", file_b: "c.ts", count: 3 },
      { file_a: "b.ts", file_b: "c.ts", count: 1 },
    ]
    const tracked = new Set(["a.ts", "b.ts"])
    const result = filterPairsByTrackedFiles(pairs, tracked, 10)
    expect(result).toEqual([{ file_a: "a.ts", file_b: "b.ts", count: 5 }])
  })

  test("respects limit after filtering", () => {
    const pairs = [
      { file_a: "a.ts", file_b: "b.ts" },
      { file_a: "a.ts", file_b: "c.ts" },
      { file_a: "b.ts", file_b: "c.ts" },
    ]
    const tracked = new Set(["a.ts", "b.ts", "c.ts"])
    const result = filterPairsByTrackedFiles(pairs, tracked, 2)
    expect(result.length).toBe(2)
  })

  test("returns empty when one file in each pair is not tracked", () => {
    const pairs = [
      { file_a: "a.ts", file_b: "deleted.ts" },
      { file_a: "deleted2.ts", file_b: "b.ts" },
    ]
    const tracked = new Set(["a.ts", "b.ts"])
    const result = filterPairsByTrackedFiles(pairs, tracked, 10)
    expect(result).toEqual([])
  })
})
