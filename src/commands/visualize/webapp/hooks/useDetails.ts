/// <reference lib="dom" />
import { useState, useEffect, useRef } from "react"
import type { DetailsResponse } from "../types"

export function useDetails(path: string | null) {
  const [data, setData] = useState<DetailsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const controllerRef = useRef<AbortController | null>(null)

  // Reset loading state when path changes (React pattern for adjusting state on prop change)
  const [prevPath, setPrevPath] = useState(path)
  if (prevPath !== path) {
    setPrevPath(path)
    setLoading(true)
  }

  useEffect(() => {
    if (controllerRef.current) controllerRef.current.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    const query = path || "/"
    fetch(`/api/details?path=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((d: DetailsResponse) => {
        setData(d)
        setLoading(false)
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setData(null)
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [path])

  return { data, loading }
}
