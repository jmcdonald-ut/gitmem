import { describe, expect, test } from "bun:test"

import {
  DEFAULT_EXCLUDED,
  type FileCategory,
  filterByTrackedFiles,
  filterPairsByTrackedFiles,
  getExclusionPatterns,
  isExcluded,
  isGenerated,
  resolveExcludedCategories,
} from "@/file-filter"

describe("isExcluded", () => {
  describe("test category", () => {
    test("matches .test.* suffix", () => {
      expect(isExcluded("src/foo.test.ts", ["test"])).toBe(true)
      expect(isExcluded("src/foo.test.js", ["test"])).toBe(true)
      expect(isExcluded("foo.test.rb", ["test"])).toBe(true)
      expect(isExcluded("foo.test.py", ["test"])).toBe(true)
    })

    test("matches .spec.* suffix", () => {
      expect(isExcluded("src/foo.spec.ts", ["test"])).toBe(true)
      expect(isExcluded("foo.spec.rb", ["test"])).toBe(true)
    })

    test("matches _test.* suffix (Go convention)", () => {
      expect(isExcluded("pkg/foo_test.go", ["test"])).toBe(true)
      expect(isExcluded("foo_test.go", ["test"])).toBe(true)
    })

    test("matches _spec.* suffix (Ruby convention)", () => {
      expect(isExcluded("spec/models/user_spec.rb", ["test"])).toBe(true)
      expect(isExcluded("foo_spec.rb", ["test"])).toBe(true)
    })

    test("matches __tests__/ directory", () => {
      expect(isExcluded("src/__tests__/foo.ts", ["test"])).toBe(true)
    })

    test("matches test/ directory", () => {
      expect(isExcluded("test/integration.ts", ["test"])).toBe(true)
      expect(isExcluded("src/test/helper.ts", ["test"])).toBe(true)
    })

    test("matches tests/ directory", () => {
      expect(isExcluded("tests/unit.ts", ["test"])).toBe(true)
      expect(isExcluded("src/tests/unit.ts", ["test"])).toBe(true)
    })

    test("matches spec/ directory", () => {
      expect(isExcluded("spec/models/user.rb", ["test"])).toBe(true)
      expect(isExcluded("src/spec/foo.rb", ["test"])).toBe(true)
    })

    test("matches fixtures/ directory", () => {
      expect(isExcluded("fixtures/user.json", ["test"])).toBe(true)
      expect(isExcluded("src/fixtures/data.json", ["test"])).toBe(true)
    })

    test("matches __fixtures__/ directory", () => {
      expect(isExcluded("src/__fixtures__/mock-data.ts", ["test"])).toBe(true)
    })

    test("matches __mocks__/ directory", () => {
      expect(isExcluded("src/__mocks__/api.ts", ["test"])).toBe(true)
    })

    test("matches __snapshots__/ directory", () => {
      expect(isExcluded("src/__snapshots__/App.test.ts.snap", ["test"])).toBe(
        true,
      )
    })

    test("matches testdata/ directory (Go convention)", () => {
      expect(isExcluded("testdata/input.txt", ["test"])).toBe(true)
      expect(isExcluded("pkg/testdata/golden.json", ["test"])).toBe(true)
    })

    test("matches test-data/ directory", () => {
      expect(isExcluded("test-data/sample.csv", ["test"])).toBe(true)
      expect(isExcluded("src/test-data/mock.json", ["test"])).toBe(true)
    })

    test("does not match non-test files", () => {
      expect(isExcluded("src/main.ts", ["test"])).toBe(false)
      expect(isExcluded("src/testing.ts", ["test"])).toBe(false)
      expect(isExcluded("src/contest.ts", ["test"])).toBe(false)
    })
  })

  describe("docs category", () => {
    test("matches .md files", () => {
      expect(isExcluded("README.md", ["docs"])).toBe(true)
      expect(isExcluded("src/CHANGELOG.md", ["docs"])).toBe(true)
    })

    test("matches .mdx files", () => {
      expect(isExcluded("docs/intro.mdx", ["docs"])).toBe(true)
    })

    test("matches docs/ directory", () => {
      expect(isExcluded("docs/guide.html", ["docs"])).toBe(true)
      expect(isExcluded("src/docs/api.ts", ["docs"])).toBe(true)
    })

    test("does not match non-docs files", () => {
      expect(isExcluded("src/markdown-parser.ts", ["docs"])).toBe(false)
    })
  })

  describe("generated category", () => {
    test("matches lock filenames", () => {
      expect(isExcluded("package-lock.json", ["generated"])).toBe(true)
      expect(isExcluded("yarn.lock", ["generated"])).toBe(true)
      expect(isExcluded("bun.lockb", ["generated"])).toBe(true)
      expect(isExcluded("pnpm-lock.yaml", ["generated"])).toBe(true)
      expect(isExcluded("Gemfile.lock", ["generated"])).toBe(true)
      expect(isExcluded("Cargo.lock", ["generated"])).toBe(true)
      expect(isExcluded("composer.lock", ["generated"])).toBe(true)
      expect(isExcluded("poetry.lock", ["generated"])).toBe(true)
      expect(isExcluded("go.sum", ["generated"])).toBe(true)
    })

    test("matches lock filenames in subdirectories", () => {
      expect(isExcluded("frontend/package-lock.json", ["generated"])).toBe(true)
      expect(isExcluded("deep/nested/yarn.lock", ["generated"])).toBe(true)
    })

    test("matches .min.js and .min.css", () => {
      expect(isExcluded("dist/bundle.min.js", ["generated"])).toBe(true)
      expect(isExcluded("styles.min.css", ["generated"])).toBe(true)
    })

    test("matches .map files", () => {
      expect(isExcluded("bundle.js.map", ["generated"])).toBe(true)
    })

    test("matches .lock extension", () => {
      expect(isExcluded("some-custom.lock", ["generated"])).toBe(true)
    })

    test("does not match normal files", () => {
      expect(isExcluded("src/main.ts", ["generated"])).toBe(false)
      expect(isExcluded("package.json", ["generated"])).toBe(false)
      expect(isExcluded("src/lock-service.ts", ["generated"])).toBe(false)
    })
  })

  describe("multiple categories", () => {
    test("matches any of the given categories", () => {
      expect(isExcluded("src/foo.test.ts", ["test", "docs"])).toBe(true)
      expect(isExcluded("README.md", ["test", "docs"])).toBe(true)
      expect(isExcluded("src/main.ts", ["test", "docs"])).toBe(false)
    })

    test("uses DEFAULT_EXCLUDED when no categories given", () => {
      expect(isExcluded("src/foo.test.ts")).toBe(true)
      expect(isExcluded("README.md")).toBe(true)
      expect(isExcluded("yarn.lock")).toBe(true)
      expect(isExcluded("src/main.ts")).toBe(false)
    })

    test("empty categories excludes nothing", () => {
      expect(isExcluded("src/foo.test.ts", [])).toBe(false)
      expect(isExcluded("README.md", [])).toBe(false)
    })
  })
})

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

describe("getExclusionPatterns", () => {
  test("returns test patterns", () => {
    const patterns = getExclusionPatterns(["test"])
    expect(patterns).toContain("%.test.%")
    expect(patterns).toContain("%.spec.%")
    expect(patterns).toContain("%\\_test.%")
    expect(patterns).toContain("%\\_spec.%")
    expect(patterns).toContain("%/__tests__/%")
    expect(patterns).toContain("%/__fixtures__/%")
    expect(patterns).toContain("%/__mocks__/%")
    expect(patterns).toContain("%/__snapshots__/%")
    expect(patterns).toContain("%/test/%")
    expect(patterns).toContain("%/tests/%")
    expect(patterns).toContain("%/spec/%")
    expect(patterns).toContain("%/fixtures/%")
    expect(patterns).toContain("%/testdata/%")
    expect(patterns).toContain("%/test-data/%")
  })

  test("returns docs patterns", () => {
    const patterns = getExclusionPatterns(["docs"])
    expect(patterns).toContain("%.md")
    expect(patterns).toContain("%.mdx")
    expect(patterns).toContain("%/docs/%")
  })

  test("returns generated patterns", () => {
    const patterns = getExclusionPatterns(["generated"])
    expect(patterns).toContain("%.min.js")
    expect(patterns).toContain("%.min.css")
    expect(patterns).toContain("%.map")
    expect(patterns).toContain("%.lock")
    expect(patterns).toContain("%package-lock.json")
    expect(patterns).toContain("%go.sum")
  })

  test("returns empty for no categories", () => {
    expect(getExclusionPatterns([])).toEqual([])
  })

  test("combines multiple categories", () => {
    const patterns = getExclusionPatterns(["test", "docs"])
    expect(patterns).toContain("%.test.%")
    expect(patterns).toContain("%.md")
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

describe("resolveExcludedCategories", () => {
  test("returns all categories by default", () => {
    expect(resolveExcludedCategories({})).toEqual(DEFAULT_EXCLUDED)
  })

  test("--all returns empty", () => {
    expect(resolveExcludedCategories({ all: true })).toEqual([])
  })

  test("--include-tests removes test", () => {
    const result = resolveExcludedCategories({ includeTests: true })
    expect(result).not.toContain("test")
    expect(result).toContain("docs")
    expect(result).toContain("generated")
  })

  test("--include-docs removes docs", () => {
    const result = resolveExcludedCategories({ includeDocs: true })
    expect(result).toContain("test")
    expect(result).not.toContain("docs")
    expect(result).toContain("generated")
  })

  test("--include-generated removes generated", () => {
    const result = resolveExcludedCategories({ includeGenerated: true })
    expect(result).toContain("test")
    expect(result).toContain("docs")
    expect(result).not.toContain("generated")
  })

  test("multiple flags combine", () => {
    const result = resolveExcludedCategories({
      includeTests: true,
      includeDocs: true,
    })
    expect(result).toEqual(["generated"] as FileCategory[])
  })
})
