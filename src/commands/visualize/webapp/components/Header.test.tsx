/// <reference lib="dom" />
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, mock, test } from "bun:test"

import { Header } from "@visualize-app/components/Header"
import "@visualize-app/test-setup"

afterEach(cleanup)

describe("Header", () => {
  test("renders repo name", () => {
    const onNavigate = mock(() => {})
    const { getByText } = render(
      <Header
        repoName="my-repo"
        pathPrefix=""
        currentPath=""
        unindexedCount={0}
        onNavigate={onNavigate}
      />,
    )
    expect(getByText("my-repo")).toBeTruthy()
  })

  test("renders path prefix segments as muted", () => {
    const onNavigate = mock(() => {})
    const { container } = render(
      <Header
        repoName="my-repo"
        pathPrefix="src/commands/"
        currentPath=""
        unindexedCount={0}
        onNavigate={onNavigate}
      />,
    )
    const prefixSegments = container.querySelectorAll(".prefix-segment")
    expect(prefixSegments.length).toBe(2)
    expect(prefixSegments[0].textContent).toBe("src")
    expect(prefixSegments[1].textContent).toBe("commands")
  })

  test("renders breadcrumb path segments", () => {
    const onNavigate = mock(() => {})
    const { getByText } = render(
      <Header
        repoName="my-repo"
        pathPrefix=""
        currentPath="src/services/"
        unindexedCount={0}
        onNavigate={onNavigate}
      />,
    )
    expect(getByText("src")).toBeTruthy()
    expect(getByText("services")).toBeTruthy()
  })

  test("calls onNavigate when breadcrumb segment is clicked", () => {
    const onNavigate = mock(() => {})
    const { getByText } = render(
      <Header
        repoName="my-repo"
        pathPrefix=""
        currentPath="src/services/"
        unindexedCount={0}
        onNavigate={onNavigate}
      />,
    )
    fireEvent.click(getByText("src"))
    expect(onNavigate).toHaveBeenCalledWith("src/")
  })

  test("calls onNavigate with empty string when repo name clicked", () => {
    const onNavigate = mock(() => {})
    const { getByText } = render(
      <Header
        repoName="my-repo"
        pathPrefix=""
        currentPath="src/"
        unindexedCount={0}
        onNavigate={onNavigate}
      />,
    )
    fireEvent.click(getByText("my-repo"))
    expect(onNavigate).toHaveBeenCalledWith("")
  })

  test("shows unindexed banner when count > 0", () => {
    const onNavigate = mock(() => {})
    const { getByText } = render(
      <Header
        repoName="my-repo"
        pathPrefix=""
        currentPath=""
        unindexedCount={42}
        onNavigate={onNavigate}
      />,
    )
    expect(getByText("42 files not yet indexed")).toBeTruthy()
  })

  test("hides unindexed banner when count is 0", () => {
    const onNavigate = mock(() => {})
    const { queryByText } = render(
      <Header
        repoName="my-repo"
        pathPrefix=""
        currentPath=""
        unindexedCount={0}
        onNavigate={onNavigate}
      />,
    )
    expect(queryByText(/files not yet indexed/)).toBeNull()
  })
})
