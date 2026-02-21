import { Command } from "@commander-js/extra-typings"
import { describe, expect, test } from "bun:test"

import {
  type ScopeConfig,
  type ScopeSpec,
  addScopeOptions,
  buildScopeClauses,
  matchesScope,
  normalizePattern,
  patternToLike,
  resolveScope,
} from "@/scope"

describe("resolveScope", () => {
  test("config-only: uses config include and exclude", () => {
    const config: ScopeConfig = {
      include: ["src/"],
      exclude: ["*.test.*"],
    }
    const result = resolveScope({}, config)
    expect(result.include).toEqual(["src/"])
    expect(result.exclude).toEqual(["*.test.*"])
  })

  test("flags-only: uses flag include and exclude", () => {
    const result = resolveScope({
      include: ["lib/"],
      exclude: ["*.spec.*"],
    })
    expect(result.include).toEqual(["lib/"])
    expect(result.exclude).toEqual(["*.spec.*"])
  })

  test("flags include replaces config include", () => {
    const config: ScopeConfig = {
      include: ["src/"],
      exclude: ["*.test.*"],
    }
    const result = resolveScope({ include: ["lib/"] }, config)
    expect(result.include).toEqual(["lib/"])
    // Config exclude is still preserved
    expect(result.exclude).toEqual(["*.test.*"])
  })

  test("flags exclude appends to config exclude", () => {
    const config: ScopeConfig = { exclude: ["*.test.*"] }
    const result = resolveScope({ exclude: ["*.spec.*"] }, config)
    expect(result.exclude).toEqual(["*.test.*", "*.spec.*"])
  })

  test("--all clears everything", () => {
    const config: ScopeConfig = {
      include: ["src/"],
      exclude: ["*.test.*"],
    }
    const result = resolveScope({ all: true }, config)
    expect(result.include).toEqual([])
    expect(result.exclude).toEqual([])
  })

  test("deduplicates patterns", () => {
    const result = resolveScope({
      include: ["src/", "src/"],
      exclude: ["*.test.*", "*.test.*"],
    })
    expect(result.include).toEqual(["src/"])
    expect(result.exclude).toEqual(["*.test.*"])
  })

  test("normalizes patterns", () => {
    const result = resolveScope({
      include: ["./src/", "/lib/"],
    })
    expect(result.include).toEqual(["src/", "lib/"])
  })

  test("empty flags with no config returns empty scope", () => {
    const result = resolveScope({})
    expect(result.include).toEqual([])
    expect(result.exclude).toEqual([])
  })
})

describe("normalizePattern", () => {
  test("strips leading ./", () => {
    expect(normalizePattern("./src/")).toBe("src/")
  })

  test("strips leading /", () => {
    expect(normalizePattern("/src/")).toBe("src/")
  })

  test("leaves normal patterns unchanged", () => {
    expect(normalizePattern("src/")).toBe("src/")
    expect(normalizePattern("*.test.*")).toBe("*.test.*")
  })
})

describe("patternToLike", () => {
  test("prefix: no wildcards appends %", () => {
    expect(patternToLike("src/")).toBe("src/%")
  })

  test("wildcards: * becomes %", () => {
    expect(patternToLike("*.test.*")).toBe("%.test.%")
  })

  test("escapes literal underscores", () => {
    expect(patternToLike("*__test__*")).toBe("%\\_\\_test\\_\\_%")
  })

  test("escapes literal % in pattern", () => {
    expect(patternToLike("100%done")).toBe("100\\%done%")
  })

  test("prefix with underscore", () => {
    expect(patternToLike("__tests__/")).toBe("\\_\\_tests\\_\\_/%")
  })
})

describe("buildScopeClauses", () => {
  test("empty scope returns no conditions", () => {
    const result = buildScopeClauses("file_path", {
      include: [],
      exclude: [],
    })
    expect(result.conditions).toEqual([])
    expect(result.params).toEqual([])
  })

  test("undefined scope returns no conditions", () => {
    const result = buildScopeClauses("file_path", undefined)
    expect(result.conditions).toEqual([])
    expect(result.params).toEqual([])
  })

  test("include-only: OR'd conditions", () => {
    const result = buildScopeClauses("file_path", {
      include: ["src/", "lib/"],
      exclude: [],
    })
    expect(result.conditions).toEqual([
      "(file_path LIKE ? ESCAPE '\\' OR file_path LIKE ? ESCAPE '\\')",
    ])
    expect(result.params).toEqual(["src/%", "lib/%"])
  })

  test("exclude-only: AND NOT conditions", () => {
    const result = buildScopeClauses("file_path", {
      include: [],
      exclude: ["*.test.*", "*.spec.*"],
    })
    expect(result.conditions).toEqual([
      "file_path NOT LIKE ? ESCAPE '\\'",
      "file_path NOT LIKE ? ESCAPE '\\'",
    ])
    expect(result.params).toEqual(["%.test.%", "%.spec.%"])
  })

  test("combined: include OR + exclude AND NOT", () => {
    const result = buildScopeClauses("fp", {
      include: ["src/"],
      exclude: ["*.test.*"],
    })
    expect(result.conditions).toEqual([
      "(fp LIKE ? ESCAPE '\\')",
      "fp NOT LIKE ? ESCAPE '\\'",
    ])
    expect(result.params).toEqual(["src/%", "%.test.%"])
  })

  test("uses the provided column name", () => {
    const result = buildScopeClauses("fs.file_path", {
      include: ["src/"],
      exclude: [],
    })
    expect(result.conditions[0]).toContain("fs.file_path")
  })
})

describe("matchesScope", () => {
  test("empty scope matches everything", () => {
    const scope: ScopeSpec = { include: [], exclude: [] }
    expect(matchesScope("src/main.ts", scope)).toBe(true)
    expect(matchesScope("lib/utils.js", scope)).toBe(true)
  })

  test("prefix include filters to matching files", () => {
    const scope: ScopeSpec = { include: ["src/"], exclude: [] }
    expect(matchesScope("src/main.ts", scope)).toBe(true)
    expect(matchesScope("lib/utils.js", scope)).toBe(false)
  })

  test("wildcard include matches patterns", () => {
    const scope: ScopeSpec = { include: ["*.ts"], exclude: [] }
    expect(matchesScope("src/main.ts", scope)).toBe(true)
    expect(matchesScope("src/main.js", scope)).toBe(false)
  })

  test("exclude removes matching files", () => {
    const scope: ScopeSpec = { include: [], exclude: ["*.test.*"] }
    expect(matchesScope("src/main.ts", scope)).toBe(true)
    expect(matchesScope("src/main.test.ts", scope)).toBe(false)
  })

  test("include + exclude interaction", () => {
    const scope: ScopeSpec = {
      include: ["src/"],
      exclude: ["*.test.*"],
    }
    expect(matchesScope("src/main.ts", scope)).toBe(true)
    expect(matchesScope("src/main.test.ts", scope)).toBe(false)
    expect(matchesScope("lib/main.ts", scope)).toBe(false)
  })

  test("multiple include patterns: match any", () => {
    const scope: ScopeSpec = {
      include: ["src/", "lib/"],
      exclude: [],
    }
    expect(matchesScope("src/main.ts", scope)).toBe(true)
    expect(matchesScope("lib/utils.ts", scope)).toBe(true)
    expect(matchesScope("test/foo.ts", scope)).toBe(false)
  })

  test("prefix exclude", () => {
    const scope: ScopeSpec = { include: [], exclude: ["test/"] }
    expect(matchesScope("test/foo.ts", scope)).toBe(false)
    expect(matchesScope("src/test/foo.ts", scope)).toBe(true)
  })
})

describe("addScopeOptions", () => {
  test("adds --include, --exclude, and --all options", () => {
    const cmd = addScopeOptions(new Command("test"))
    const optionNames = cmd.options.map((o) => o.long)
    expect(optionNames).toContain("--include")
    expect(optionNames).toContain("--exclude")
    expect(optionNames).toContain("--all")
  })

  test("--include is repeatable and collects values", () => {
    const cmd = addScopeOptions(new Command("test"))
    cmd.parse(["--include", "src/", "--include", "lib/"], { from: "user" })
    const opts = cmd.opts()
    expect(opts.include).toEqual(["src/", "lib/"])
  })

  test("--exclude is repeatable and collects values", () => {
    const cmd = addScopeOptions(new Command("test"))
    cmd.parse(["--exclude", "*.test.*", "--exclude", "*.spec.*"], {
      from: "user",
    })
    const opts = cmd.opts()
    expect(opts.exclude).toEqual(["*.test.*", "*.spec.*"])
  })
})
