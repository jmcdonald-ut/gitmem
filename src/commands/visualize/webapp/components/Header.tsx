/// <reference lib="dom" />

interface HeaderProps {
  repoName: string
  pathPrefix: string
  currentPath: string
  unindexedCount: number
  onNavigate: (path: string) => void
}

export function Header({
  repoName,
  pathPrefix,
  currentPath,
  unindexedCount,
  onNavigate,
}: HeaderProps) {
  const prefixParts = pathPrefix ? pathPrefix.replace(/\/$/, "").split("/") : []

  let pathParts: { label: string; path: string }[] = []
  if (currentPath) {
    const isDir = currentPath.endsWith("/")
    const segments = currentPath.replace(/\/$/, "").split("/")
    pathParts = segments.map((seg, i) => {
      const isLast = i === segments.length - 1
      const segmentPath =
        segments.slice(0, i + 1).join("/") + (!isLast || isDir ? "/" : "")
      return { label: seg, path: segmentPath }
    })
  }

  return (
    <div className="header">
      <h1>gitmem</h1>
      <div className="breadcrumb">
        <span onClick={() => onNavigate("")}>{repoName}</span>
        {prefixParts.map((part, i) => (
          <span key={`prefix-${i}`}>
            {" / "}
            <span className="prefix-segment">{part}</span>
          </span>
        ))}
        {pathParts.map((part, i) => (
          <span key={`path-${i}`}>
            {" / "}
            <span onClick={() => onNavigate(part.path)}>{part.label}</span>
          </span>
        ))}
      </div>
      {unindexedCount > 0 && (
        <div className="banner">{unindexedCount} files not yet indexed</div>
      )}
    </div>
  )
}
