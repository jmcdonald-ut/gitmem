/// <reference lib="dom" />
import type { TrendSummary } from "@/types"

function trendClass(dir: string): string {
  if (dir === "increasing") return "trend-up"
  if (dir === "decreasing") return "trend-down"
  return "trend-stable"
}

function trendArrow(dir: string): string {
  if (dir === "increasing") return "\u25B2"
  if (dir === "decreasing") return "\u25BC"
  return "\u25B6"
}

export function TrendIndicator({ trend }: { trend: TrendSummary | null }) {
  if (!trend) return null

  return (
    <>
      <h3>Trends</h3>
      <div className={`trend-indicator ${trendClass(trend.direction)}`}>
        {trendArrow(trend.direction)} Activity: {trend.direction} (
        {trend.recent_avg} vs {trend.historical_avg}/period)
      </div>
      <br />
      <div className={`trend-indicator ${trendClass(trend.bug_fix_trend)}`}>
        {trendArrow(trend.bug_fix_trend)} Bug fixes: {trend.bug_fix_trend}
      </div>
      <br />
      <div className={`trend-indicator ${trendClass(trend.complexity_trend)}`}>
        {trendArrow(trend.complexity_trend)} Complexity:{" "}
        {trend.complexity_trend}
      </div>
    </>
  )
}
