/// <reference lib="dom" />
import "@visualize-app/test-setup"
import { describe, test, expect, mock, afterEach } from "bun:test"
import { render, fireEvent, cleanup } from "@testing-library/react"
import { DetailsPanel } from "@visualize-app/components/DetailsPanel"
import type {
  RootDetails,
  DirectoryDetails,
  FileDetails,
} from "@visualize-app/types"

afterEach(cleanup)

describe("DetailsPanel", () => {
  test("shows loading state", () => {
    const onNavigate = mock(() => {})
    const { getByText } = render(
      <DetailsPanel
        data={null}
        totalTracked={0}
        loading={true}
        onNavigate={onNavigate}
      />,
    )
    expect(getByText("Loading...")).toBeTruthy()
  })

  test("renders root details", () => {
    const onNavigate = mock(() => {})
    const data: RootDetails = {
      type: "root",
      totalCommits: 100,
      enrichedCommits: 80,
      enrichmentPct: 80,
      hotspots: [{ file: "src/foo.ts", changes: 10, score: 0.5 }],
      coupledPairs: [],
      trendSummary: null,
    }
    const { getByText } = render(
      <DetailsPanel
        data={data}
        totalTracked={50}
        loading={false}
        onNavigate={onNavigate}
      />,
    )
    expect(getByText("Repository Overview")).toBeTruthy()
    expect(getByText("80%")).toBeTruthy()
    expect(getByText("10 changes")).toBeTruthy()
  })

  test("renders directory details", () => {
    const onNavigate = mock(() => {})
    const data: DirectoryDetails = {
      type: "directory",
      path: "src/",
      fileCount: 10,
      stats: {
        total_changes: 50,
        current_loc: 1000,
        current_complexity: 5.2,
        bug_fix_count: 3,
        feature_count: 5,
        refactor_count: 2,
        docs_count: 0,
        chore_count: 0,
        perf_count: 0,
        test_count: 0,
        style_count: 0,
      },
      hotspots: [],
      contributors: [{ name: "Alice", commits: 20 }],
      coupled: [],
      trendSummary: null,
    }
    const { getByText } = render(
      <DetailsPanel
        data={data}
        totalTracked={50}
        loading={false}
        onNavigate={onNavigate}
      />,
    )
    expect(getByText("src/")).toBeTruthy()
    expect(getByText("Alice")).toBeTruthy()
    expect(getByText("20 commits")).toBeTruthy()
  })

  test("renders file details", () => {
    const onNavigate = mock(() => {})
    const data: FileDetails = {
      type: "file",
      path: "src/foo.ts",
      stats: {
        total_changes: 10,
        current_loc: 200,
        current_complexity: 3.5,
        bug_fix_count: 2,
        feature_count: 5,
        refactor_count: 3,
        docs_count: 0,
        chore_count: 0,
        perf_count: 0,
        test_count: 0,
        style_count: 0,
        first_seen: "2025-01-01",
        last_changed: "2025-06-01",
        total_additions: 300,
      },
      contributors: [],
      coupled: [{ file: "src/bar.ts", count: 5, ratio: 0.6 }],
      trendSummary: null,
    }
    const { getByText } = render(
      <DetailsPanel
        data={data}
        totalTracked={50}
        loading={false}
        onNavigate={onNavigate}
      />,
    )
    expect(getByText("src/foo.ts")).toBeTruthy()
    expect(getByText("2025-01-01")).toBeTruthy()
    expect(getByText("60%")).toBeTruthy()
  })

  test("renders 'No index data' when file has no stats", () => {
    const onNavigate = mock(() => {})
    const data: FileDetails = {
      type: "file",
      path: "src/unknown.ts",
      stats: null,
      contributors: [],
      coupled: [],
      trendSummary: null,
    }
    const { getByText } = render(
      <DetailsPanel
        data={data}
        totalTracked={50}
        loading={false}
        onNavigate={onNavigate}
      />,
    )
    expect(getByText("No index data for this file")).toBeTruthy()
  })

  test("renders root with coupled pairs", () => {
    const onNavigate = mock(() => {})
    const data: RootDetails = {
      type: "root",
      totalCommits: 100,
      enrichedCommits: 80,
      enrichmentPct: 80,
      hotspots: [],
      coupledPairs: [{ fileA: "src/a.ts", fileB: "src/b.ts", count: 15 }],
      trendSummary: null,
    }
    const { getByText } = render(
      <DetailsPanel
        data={data}
        totalTracked={50}
        loading={false}
        onNavigate={onNavigate}
      />,
    )
    expect(getByText("Top Coupled Pairs")).toBeTruthy()
    expect(getByText("15")).toBeTruthy()
  })

  test("renders directory with hotspots", () => {
    const onNavigate = mock(() => {})
    const data: DirectoryDetails = {
      type: "directory",
      path: "src/",
      fileCount: 10,
      stats: null,
      hotspots: [{ file: "src/foo.ts", changes: 20, score: 0.5 }],
      contributors: [],
      coupled: [],
      trendSummary: null,
    }
    const { getByText } = render(
      <DetailsPanel
        data={data}
        totalTracked={50}
        loading={false}
        onNavigate={onNavigate}
      />,
    )
    expect(getByText("Hotspots")).toBeTruthy()
    expect(getByText("20")).toBeTruthy()
  })

  test("renders directory with external coupling", () => {
    const onNavigate = mock(() => {})
    const data: DirectoryDetails = {
      type: "directory",
      path: "src/",
      fileCount: 10,
      stats: null,
      hotspots: [],
      contributors: [],
      coupled: [{ file: "lib/utils.ts", count: 8, ratio: 0.75 }],
      trendSummary: null,
    }
    const { getByText } = render(
      <DetailsPanel
        data={data}
        totalTracked={50}
        loading={false}
        onNavigate={onNavigate}
      />,
    )
    expect(getByText("External Coupling")).toBeTruthy()
    expect(getByText("75%")).toBeTruthy()
  })

  test("calls onNavigate when file link is clicked", () => {
    const onNavigate = mock(() => {})
    const data: RootDetails = {
      type: "root",
      totalCommits: 10,
      enrichedCommits: 10,
      enrichmentPct: 100,
      hotspots: [{ file: "src/foo.ts", changes: 5, score: 0.3 }],
      coupledPairs: [],
      trendSummary: null,
    }
    const { getByText } = render(
      <DetailsPanel
        data={data}
        totalTracked={10}
        loading={false}
        onNavigate={onNavigate}
      />,
    )
    fireEvent.click(getByText("src/foo.ts"))
    expect(onNavigate).toHaveBeenCalledWith("src/foo.ts")
  })
})
