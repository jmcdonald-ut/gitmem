/// <reference lib="dom" />
import "@visualize-app/test-setup"
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test"
import { render, waitFor, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { App } from "@visualize-app/App"

const hierarchyResponse = {
  root: {
    name: "",
    path: "",
    indexed: true,
    children: [
      { name: "a.ts", path: "a.ts", indexed: true, loc: 100, score: 0.5 },
      {
        name: "lib",
        path: "lib/",
        indexed: true,
        children: [
          {
            name: "b.ts",
            path: "lib/b.ts",
            indexed: true,
            loc: 50,
            score: 0.3,
          },
        ],
      },
    ],
  },
  totalTracked: 2,
  totalIndexed: 2,
  unindexedCount: 0,
  repoName: "test-repo",
  pathPrefix: "",
}

const rootDetailsResponse = {
  type: "root",
  totalCommits: 10,
  enrichedCommits: 8,
  enrichmentPct: 80,
  hotspots: [{ file: "a.ts", changes: 2865, score: 0.0924 }],
  coupledPairs: [],
  trendSummary: null,
}

const fileDrillInResponse = {
  type: "file",
  path: "a.ts",
  stats: {
    file_path: "a.ts",
    total_changes: 2,
    bug_fix_count: 0,
    feature_count: 0,
    refactor_count: 0,
    docs_count: 0,
    chore_count: 0,
    perf_count: 0,
    test_count: 0,
    style_count: 0,
    first_seen: "2023-12-22T11:16:08-07:00",
    last_changed: "2025-07-16T12:40:42-06:00",
    total_additions: 38,
    total_deletions: 1,
    current_loc: 29,
    current_complexity: 7,
    avg_complexity: 7,
    max_complexity: 7,
  },
  contributors: [
    {
      name: "Chandler Goat",
      commits: 1,
    },
    {
      name: "Beth Rigby",
      commits: 1,
    },
  ],
  coupled: [
    {
      file: "b.ts",
      count: 2,
      ratio: 1,
    },
  ],
  trendSummary: {
    direction: "stable",
    recent_avg: 1,
    historical_avg: 1,
    bug_fix_trend: "stable",
    complexity_trend: "stable",
  },
}

const originalFetch = globalThis.fetch

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

describe("App", () => {
  beforeEach(() => {
    const fetchMock = mock((url: string | URL | Request) => {
      const urlStr =
        typeof url === "string"
          ? url
          : url instanceof URL
            ? url.toString()
            : url.url
      if (urlStr.includes("/api/hierarchy")) {
        return Promise.resolve(new Response(JSON.stringify(hierarchyResponse)))
      }
      if (urlStr.includes("/api/details")) {
        const params = new URL(urlStr, "http://localhost").searchParams
        const path = params.get("path") ?? "/"
        const dataResponse =
          path === "/" ? rootDetailsResponse : fileDrillInResponse
        return Promise.resolve(new Response(JSON.stringify(dataResponse)))
      }
      return Promise.resolve(new Response("Not found", { status: 404 }))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  test("loads and renders hierarchy data", async () => {
    const { getByText } = render(<App />)

    await waitFor(() => {
      expect(getByText("test-repo")).toBeTruthy()
    })
  })

  test("fetches details on initial load", async () => {
    const { getByText } = render(<App />)

    await waitFor(() => {
      expect(getByText("Repository Overview")).toBeTruthy()
    })
  })

  test("supports drilling into a file by hotspot", async () => {
    const { getByText, getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByText("test-repo")).toBeTruthy()
    })

    await userEvent.click(getByTestId("file-link-a.ts"))

    await waitFor(() => {
      expect(getByText("Chandler Goat")).toBeTruthy()
      expect(getByText("Beth Rigby")).toBeTruthy()
    })
  })

  test("supports drilling into a file by clicking circle", async () => {
    const { getByText, getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByText("test-repo")).toBeTruthy()
    })

    await userEvent.click(getByTestId("circle-a.ts"))

    await waitFor(() => {
      expect(getByText("Chandler Goat")).toBeTruthy()
      expect(getByText("Beth Rigby")).toBeTruthy()
    })
  })

  test("shows loading state initially", async () => {
    const { getAllByText } = render(<App />)

    await waitFor(() => {
      expect(getAllByText("Loading...").length).toBeGreaterThan(0)
    })
  })

  test("navigates back to root via breadcrumb", async () => {
    const { getByText, getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByText("test-repo")).toBeTruthy()
    })

    // Drill into a file first
    await userEvent.click(getByTestId("file-link-a.ts"))
    await waitFor(() => {
      expect(getByText("Chandler Goat")).toBeTruthy()
    })

    // Click repo name breadcrumb to navigate back (calls handleNavigate(""))
    await userEvent.click(getByText("test-repo"))
    await waitFor(() => {
      expect(getByText("Repository Overview")).toBeTruthy()
    })
  })

  test("clicking a directory circle selects the directory", async () => {
    const { getByText, getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByText("test-repo")).toBeTruthy()
    })

    // Click a directory circle (calls handleSelect("lib/") which clears selectedPath)
    await userEvent.click(getByTestId("circle-lib/"))

    await waitFor(() => {
      // Directory details should be fetched for "lib/"
      expect(getByText("lib/")).toBeTruthy()
    })
  })
})

describe("App error handling", () => {
  test("shows error when hierarchy fetch fails", async () => {
    globalThis.fetch = mock((url: string | URL | Request) => {
      const urlStr =
        typeof url === "string"
          ? url
          : url instanceof URL
            ? url.toString()
            : url.url
      if (urlStr.includes("/api/hierarchy")) {
        return Promise.resolve(new Response("Server Error", { status: 500 }))
      }
      return Promise.resolve(new Response(JSON.stringify({})))
    }) as unknown as typeof fetch

    const { getByText } = render(<App />)

    await waitFor(() => {
      expect(getByText(/Failed to load/)).toBeTruthy()
    })
  })
})
