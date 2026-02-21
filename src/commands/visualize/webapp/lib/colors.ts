/// <reference lib="dom" />
import { interpolateRgb } from "d3-interpolate"
import { scaleLinear } from "d3-scale"

/** Classification colors referencing CSS custom properties from styles.css. */
export const COLORS: Record<string, string> = {
  "bug-fix": "var(--red)",
  feature: "var(--green)",
  refactor: "var(--yellow)",
  docs: "var(--blue)",
  chore: "var(--gray)",
  perf: "var(--purple)",
  test: "var(--cyan)",
  style: "var(--white)",
}

/** Score heatmap: green → yellow → red. Uses hex values for d3 interpolation. */
export const scoreColor = scaleLinear<string>()
  .domain([0, 0.5, 1])
  .range(["#3EBD93", "#F7C948", "#EF4E4E"])
  .interpolate(interpolateRgb)
