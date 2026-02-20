/// <reference lib="dom" />
import { useState, useCallback } from "react"
import { useHierarchy } from "./hooks/useHierarchy"
import { useDetails } from "./hooks/useDetails"
import { Header } from "./components/Header"
import { CirclePacking } from "./components/CirclePacking"
import { DetailsPanel } from "./components/DetailsPanel"

export function App() {
  const { data: hierarchyData, loading: hierarchyLoading } = useHierarchy()
  const [focusPath, setFocusPath] = useState("")
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const detailsPath = selectedPath ?? focusPath
  const { data: detailsData, loading: detailsLoading } = useDetails(detailsPath)

  const handleNavigate = useCallback((path: string) => {
    // Determine if this is a directory or file
    if (!path || path.endsWith("/")) {
      setFocusPath(path)
      setSelectedPath(null)
    } else {
      // File path — find parent directory for focus
      const parts = path.split("/")
      const parentPath =
        parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : ""
      setFocusPath(parentPath)
      setSelectedPath(path)
    }
  }, [])

  const handleFocusChange = useCallback((path: string) => {
    setFocusPath(path)
  }, [])

  const handleSelect = useCallback((path: string) => {
    if (!path || path.endsWith("/")) {
      setSelectedPath(null)
    } else {
      setSelectedPath(path)
    }
  }, [])

  if (hierarchyLoading || !hierarchyData) {
    return (
      <div className="layout">
        <div className="header">
          <h1>gitmem</h1>
        </div>
        <div className="viz-container">
          <div className="loading">Loading...</div>
        </div>
        <div className="details">
          <div className="loading">Loading...</div>
        </div>
      </div>
    )
  }

  const breadcrumbPath = selectedPath ?? focusPath

  return (
    <div className="layout">
      <Header
        repoName={hierarchyData.repoName}
        pathPrefix={hierarchyData.pathPrefix}
        currentPath={breadcrumbPath}
        unindexedCount={hierarchyData.unindexedCount}
        onNavigate={handleNavigate}
      />
      <CirclePacking
        hierarchy={hierarchyData}
        onSelect={handleSelect}
        selectedPath={selectedPath}
        focusPath={focusPath}
        onFocusChange={handleFocusChange}
      />
      <DetailsPanel
        data={detailsData}
        totalTracked={hierarchyData.totalTracked}
        loading={detailsLoading}
        onNavigate={handleNavigate}
      />
    </div>
  )
}
