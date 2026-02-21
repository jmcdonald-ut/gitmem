/// <reference lib="dom" />
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, mock, test } from "bun:test"

import { useHierarchy } from "@visualize-app/hooks/useHierarchy"
import "@visualize-app/test-setup"

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
