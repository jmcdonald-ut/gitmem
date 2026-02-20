/// <reference lib="dom" />
import { useState, useEffect } from "react"
import type { HierarchyResponse } from "../types"

export function useHierarchy() {
  const [data, setData] = useState<HierarchyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/hierarchy", { signal: controller.signal })
      .then((r) => r.json())
      .then((d: HierarchyResponse) => {
        setData(d)
        setLoading(false)
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError(err.message)
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [])

  return { data, loading, error }
}
