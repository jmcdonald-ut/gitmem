/// <reference lib="dom" />
import type { DetailsResponse } from "../types"
import { fmt, smartTruncate } from "../lib/format"
import { StatGrid } from "./StatGrid"
import { ClassificationBar } from "./ClassificationBar"
import { TrendIndicator } from "./TrendIndicator"

interface DetailsPanelProps {
  data: DetailsResponse | null
  totalTracked: number
  loading: boolean
  error?: string | null
  onNavigate: (path: string) => void
}

function FileLink({
  filePath,
  maxChars,
  onNavigate,
}: {
  filePath: string
  maxChars: number
  onNavigate: (path: string) => void
}) {
  const display = smartTruncate(filePath, maxChars)
  return (
    <span
      data-testid={`file-link-${filePath}`}
      className="clickable"
      title={filePath}
      onClick={() => onNavigate(filePath)}
    >
      {display}
    </span>
  )
}

export function DetailsPanel({
  data,
  totalTracked,
  loading,
  error,
  onNavigate,
}: DetailsPanelProps) {
  if (error) {
    return (
      <div className="details">
        <div className="loading">Failed to load details: {error}</div>
      </div>
    )
  }

  if (loading || !data) {
    return (
      <div className="details">
        <div className="loading">Loading...</div>
      </div>
    )
  }

  if (data.type === "root") {
    return (
      <div className="details">
        <h2>Repository Overview</h2>
        <StatGrid
          items={[
            { value: fmt(data.totalCommits), label: "Total commits" },
            { value: fmt(data.enrichedCommits), label: "Enriched" },
            { value: data.enrichmentPct + "%", label: "Enrichment" },
            { value: fmt(totalTracked), label: "Tracked files" },
          ]}
        />

        {data.hotspots.length > 0 && (
          <>
            <h3>Top Hotspots</h3>
            {data.hotspots.map((h) => (
              <div key={h.file} className="list-item">
                <span className="list-file">
                  <FileLink
                    filePath={h.file}
                    maxChars={40}
                    onNavigate={onNavigate}
                  />
                </span>
                <span className="list-value">{h.changes} changes</span>
              </div>
            ))}
          </>
        )}

        {data.coupledPairs.length > 0 && (
          <>
            <h3>Top Coupled Pairs</h3>
            {data.coupledPairs.map((p, i) => (
              <div key={i} className="list-item">
                <span
                  className="list-file"
                  style={{ maxWidth: "90%", fontSize: 12 }}
                >
                  <FileLink
                    filePath={p.fileA}
                    maxChars={30}
                    onNavigate={onNavigate}
                  />
                  <span className="separator"> &harr; </span>
                  <FileLink
                    filePath={p.fileB}
                    maxChars={30}
                    onNavigate={onNavigate}
                  />
                </span>
                <span className="list-value">{p.count}</span>
              </div>
            ))}
          </>
        )}

        <TrendIndicator trend={data.trendSummary} />
      </div>
    )
  }

  if (data.type === "directory") {
    return (
      <div className="details">
        <h2>{data.path}</h2>
        <StatGrid
          items={[
            { value: fmt(data.fileCount), label: "Files" },
            ...(data.stats
              ? [
                  {
                    value: fmt(data.stats.current_loc ?? 0),
                    label: "LOC",
                  },
                  {
                    value: fmt(data.stats.total_changes),
                    label: "Total changes",
                  },
                  {
                    value: (data.stats.current_complexity ?? 0).toFixed(1),
                    label: "Avg complexity",
                  },
                ]
              : []),
          ]}
        />

        {data.stats && <ClassificationBar stats={data.stats} />}

        {data.hotspots.length > 0 && (
          <>
            <h3>Hotspots</h3>
            {data.hotspots.map((h) => (
              <div key={h.file} className="list-item">
                <span className="list-file">
                  <FileLink
                    filePath={h.file}
                    maxChars={40}
                    onNavigate={onNavigate}
                  />
                </span>
                <span className="list-value">{h.changes}</span>
              </div>
            ))}
          </>
        )}

        {data.contributors.length > 0 && (
          <>
            <h3>Contributors</h3>
            {data.contributors.map((c) => (
              <div key={c.name} className="list-item">
                <span>{c.name}</span>
                <span className="list-value">{c.commits} commits</span>
              </div>
            ))}
          </>
        )}

        {data.coupled.length > 0 && (
          <>
            <h3>External Coupling</h3>
            {data.coupled.map((c) => (
              <div key={c.file} className="list-item">
                <span className="list-file">
                  <FileLink
                    filePath={c.file}
                    maxChars={40}
                    onNavigate={onNavigate}
                  />
                </span>
                <span className="list-value">
                  {(c.ratio * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </>
        )}

        <TrendIndicator trend={data.trendSummary} />
      </div>
    )
  }

  // data.type === "file"
  return (
    <div className="details">
      <h2>{data.path}</h2>
      {data.stats ? (
        <>
          <StatGrid
            items={[
              { value: fmt(data.stats.current_loc ?? 0), label: "LOC" },
              {
                value: fmt(data.stats.total_changes),
                label: "Changes",
              },
              {
                value: (data.stats.current_complexity ?? 0).toFixed(1),
                label: "Complexity",
              },
              {
                value: data.stats.first_seen
                  ? data.stats.first_seen.slice(0, 10)
                  : "\u2014",
                label: "First seen",
              },
              {
                value: data.stats.last_changed
                  ? data.stats.last_changed.slice(0, 10)
                  : "\u2014",
                label: "Last changed",
              },
              {
                value: fmt(data.stats.total_additions ?? 0),
                label: "Additions",
              },
            ]}
          />
          <ClassificationBar stats={data.stats} />
        </>
      ) : (
        <div className="loading">No index data for this file</div>
      )}

      {data.contributors.length > 0 && (
        <>
          <h3>Contributors</h3>
          {data.contributors.map((c) => (
            <div key={c.name} className="list-item">
              <span>{c.name}</span>
              <span className="list-value">{c.commits} commits</span>
            </div>
          ))}
        </>
      )}

      {data.coupled.length > 0 && (
        <>
          <h3>Coupled Files</h3>
          {data.coupled.map((c) => (
            <div key={c.file} className="list-item">
              <span className="list-file">
                <FileLink
                  filePath={c.file}
                  maxChars={40}
                  onNavigate={onNavigate}
                />
              </span>
              <span className="list-value">{(c.ratio * 100).toFixed(0)}%</span>
            </div>
          ))}
        </>
      )}

      <TrendIndicator trend={data.trendSummary} />
    </div>
  )
}
