/// <reference lib="dom" />
import { COLORS } from "../lib/colors"
import type { ClassificationCounts } from "../types"

const TYPES = [
  { key: "bug_fix_count", label: "bug-fix", color: COLORS["bug-fix"] },
  { key: "feature_count", label: "feature", color: COLORS["feature"] },
  { key: "refactor_count", label: "refactor", color: COLORS["refactor"] },
  { key: "docs_count", label: "docs", color: COLORS["docs"] },
  { key: "chore_count", label: "chore", color: COLORS["chore"] },
  { key: "perf_count", label: "perf", color: COLORS["perf"] },
  { key: "test_count", label: "test", color: COLORS["test"] },
  { key: "style_count", label: "style", color: COLORS["style"] },
] as const

interface ClassificationBarProps {
  stats: ClassificationCounts
}

export function ClassificationBar({ stats }: ClassificationBarProps) {
  const total = TYPES.reduce((sum, t) => sum + stats[t.key], 0)
  if (total === 0) return null

  return (
    <>
      <h3>Classification</h3>
      <div className="class-bar">
        {TYPES.map((t) => {
          const pct = (stats[t.key] / total) * 100
          if (pct <= 0) return null
          return (
            <div
              key={t.key}
              style={{ width: `${pct}%`, background: t.color }}
              title={`${t.label}: ${stats[t.key]}`}
            />
          )
        })}
      </div>
      <div className="class-legend">
        {TYPES.map((t) => {
          if (stats[t.key] <= 0) return null
          return (
            <span key={t.key}>
              <span className="dot" style={{ background: t.color }} />
              {t.label} {stats[t.key]}
            </span>
          )
        })}
      </div>
    </>
  )
}
