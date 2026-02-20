/// <reference lib="dom" />
import "../test-setup"
import { describe, test, expect, mock, afterEach } from "bun:test"
import { render, waitFor, cleanup } from "@testing-library/react"
import { useHierarchy } from "./useHierarchy"

function HierarchyTest() {
  const { data, loading, error } = useHierarchy()
  return (
    <div>
      {loading && <span data-testid="loading">Loading</span>}
      {error && <span data-testid="error">{error}</span>}
      {data && <span data-testid="data">{data.repoName}</span>}
    </div>
  )
}

afterEach(cleanup)

describe("useHierarchy", () => {
  test("sets error on fetch failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("Network error")),
    ) as unknown as typeof fetch

    const { getByTestId } = render(<HierarchyTest />)

    await waitFor(() => {
      expect(getByTestId("error").textContent).toBe("Network error")
    })
  })
})
