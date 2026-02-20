/// <reference lib="dom" />
import "../test-setup"
import { describe, test, expect, mock, afterEach } from "bun:test"
import { render, waitFor, cleanup } from "@testing-library/react"
import { useDetails } from "./useDetails"

function DetailsTest({ path }: { path: string | null }) {
  const { data, loading } = useDetails(path)
  return (
    <div>
      {loading && <span data-testid="loading">Loading</span>}
      {data && <span data-testid="data">{data.type}</span>}
      {!loading && !data && <span data-testid="empty">No data</span>}
    </div>
  )
}

afterEach(cleanup)

describe("useDetails", () => {
  test("sets data to null on fetch failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("Network error")),
    ) as unknown as typeof fetch

    const { getByTestId } = render(<DetailsTest path="src/foo.ts" />)

    await waitFor(() => {
      expect(getByTestId("empty")).toBeTruthy()
    })
  })
})
