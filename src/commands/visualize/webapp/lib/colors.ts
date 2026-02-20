/// <reference lib="dom" />
import { scaleLinear } from "d3-scale"
import { interpolateRgb } from "d3-interpolate"

export const COLORS: Record<string, string> = {
  "bug-fix": "#EF4E4E",
  feature: "#3EBD93",
  refactor: "#F7C948",
  docs: "#47A3F3",
  chore: "#9FB3C8",
  perf: "#9446ED",
  test: "#38BEC9",
  style: "#F0F4F8",
}

export const scoreColor = scaleLinear<string>()
  .domain([0, 0.5, 1])
  .range(["#3EBD93", "#F7C948", "#EF4E4E"])
  .interpolate(interpolateRgb)
