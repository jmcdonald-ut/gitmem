/// <reference lib="dom" />
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, mock, test } from "bun:test"

import { useDetails } from "@visualize-app/hooks/useDetails"
import "@visualize-app/test-setup"

const originalFetch = globalThis.fetch

function DetailsTest({ path }: { path: string | null }) {
  const { data, loading, error } = useDetails(path)
  return (
    <div>
      {loading && <span data-testid="loading">Loading</span>}
      {error && <span data-testid="error">{error}</span>}
      {data && <span data-testid="data">{data.type}</span>}
      {!loading && !data && !error && <span data-testid="empty">No data</span>}
    </div>
  )
}

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

describe("useDetails", () => {
  test("sets data to null on fetch failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("Network error")),
    ) as unknown as typeof fetch

    const { getByTestId } = render(<DetailsTest path="src/foo.ts" />)

    await waitFor(() => {
      expect(getByTestId("error").textContent).toBe("Network error")
    })
  })

  test("sets error on non-ok HTTP response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Server Error", { status: 500 })),
    ) as unknown as typeof fetch

    const { getByTestId } = render(<DetailsTest path="src/foo.ts" />)

    await waitFor(() => {
      expect(getByTestId("error").textContent).toBe("HTTP 500")
    })
  })
})
