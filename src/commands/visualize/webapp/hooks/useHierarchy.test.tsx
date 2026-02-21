/// <reference lib="dom" />
import "@visualize-app/test-setup"
import { describe, test, expect, mock, afterEach } from "bun:test"
import { render, waitFor, cleanup } from "@testing-library/react"
import { useHierarchy } from "@visualize-app/hooks/useHierarchy"

const originalFetch = globalThis.fetch

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

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

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

  test("sets error on non-ok HTTP response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Server Error", { status: 500 })),
    ) as unknown as typeof fetch

    const { getByTestId } = render(<HierarchyTest />)

    await waitFor(() => {
      expect(getByTestId("error").textContent).toBe("HTTP 500")
    })
  })
})
