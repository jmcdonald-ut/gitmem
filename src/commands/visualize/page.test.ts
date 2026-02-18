import { describe, test, expect } from "bun:test"
import { escapeHtml, generatePage } from "@commands/visualize/page"
import type { HierarchyResult } from "@commands/visualize/hierarchy"

describe("escapeHtml", () => {
  test("escapes ampersands", () => {
    expect(escapeHtml("a&b")).toBe("a&amp;b")
  })

  test("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    )
  })

  test("escapes double quotes", () => {
    expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;")
  })

  test("handles string with all special characters", () => {
    expect(escapeHtml('&<>"')).toBe("&amp;&lt;&gt;&quot;")
  })

  test("returns empty string unchanged", () => {
    expect(escapeHtml("")).toBe("")
  })

  test("returns plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world")
  })
})

describe("generatePage", () => {
  const minimalHierarchy: HierarchyResult = {
    root: { name: "", path: "", indexed: false, children: [] },
    totalTracked: 0,
    totalIndexed: 0,
    unindexedCount: 0,
  }

  test("returns valid HTML document", () => {
    const html = generatePage(minimalHierarchy, "my-repo")
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("</html>")
  })

  test("escapes repo name in title", () => {
    const html = generatePage(minimalHierarchy, '<script>alert("xss")</script>')
    expect(html).toContain(
      "<title>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; — gitmem visualize</title>",
    )
  })

  test("includes client-side esc() function", () => {
    const html = generatePage(minimalHierarchy, "repo")
    expect(html).toContain("function esc(s)")
    expect(html).toContain('.replace(/&/g, "&amp;")')
  })

  test("includes unindexed banner when files are unindexed", () => {
    const hierarchy: HierarchyResult = {
      ...minimalHierarchy,
      unindexedCount: 42,
    }
    const html = generatePage(hierarchy, "repo")
    expect(html).toContain("42 files not yet indexed")
  })

  test("omits unindexed banner when all files are indexed", () => {
    const html = generatePage(minimalHierarchy, "repo")
    expect(html).not.toContain("files not yet indexed")
  })

  test("embeds hierarchy data as JSON", () => {
    const hierarchy: HierarchyResult = {
      root: {
        name: "",
        path: "",
        indexed: true,
        children: [
          { name: "a.ts", path: "a.ts", indexed: true, loc: 100, score: 0.5 },
        ],
      },
      totalTracked: 1,
      totalIndexed: 1,
      unindexedCount: 0,
    }
    const html = generatePage(hierarchy, "repo")
    expect(html).toContain('"name":"a.ts"')
  })
})
