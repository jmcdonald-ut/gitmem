/// <reference lib="dom" />
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type MouseEvent,
} from "react"
import {
  hierarchy as d3hierarchy,
  pack as d3pack,
  type HierarchyCircularNode,
} from "d3-hierarchy"
import { interpolateZoom } from "d3-interpolate"
import { scoreColor } from "@visualize-app/lib/colors"
import { Tooltip, type TooltipData } from "@visualize-app/components/Tooltip"
import type { HierarchyNode, HierarchyResult } from "@visualize-app/types"

interface CirclePackingProps {
  hierarchy: HierarchyResult
  onSelect: (path: string) => void
  selectedPath: string | null
  focusPath: string
  onFocusChange: (path: string) => void
}

type PackedNode = HierarchyCircularNode<HierarchyNode>

export function CirclePacking({
  hierarchy,
  onSelect,
  selectedPath,
  focusPath,
  onFocusChange,
}: CirclePackingProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null)
  const animationRef = useRef<number>(0)
  const [isAnimating, setIsAnimating] = useState(false)

  // Build the packed layout
  const { root, allNodes, leafNodes, nodeByPath } = useMemo(() => {
    const h = d3hierarchy(hierarchy.root)
      .sum((d) => (d.children ? 0 : d.loc || 1))
      .sort((a, b) => (b.value || 0) - (a.value || 0))

    const packLayout = d3pack<HierarchyNode>()
      .size([dimensions.width, dimensions.height])
      .padding(3)

    const packed = packLayout(h) as PackedNode

    const all = packed.descendants()
    const leaves = all.filter((d) => !d.children)
    const byPath = new Map(all.map((d) => [d.data.path, d]))

    return {
      root: packed,
      allNodes: all,
      leafNodes: leaves,
      nodeByPath: byPath,
    }
  }, [hierarchy, dimensions])

  // Track view state - reset when root layout changes
  const viewRef = useRef<[number, number, number]>([root.x, root.y, root.r * 2])
  const [view, setView] = useState<[number, number, number]>([
    root.x,
    root.y,
    root.r * 2,
  ])
  const [prevRoot, setPrevRoot] = useState(root)
  if (prevRoot !== root) {
    setPrevRoot(root)
    setView([root.x, root.y, root.r * 2])
  }

  // Sync viewRef when root layout changes (effect runs after render)
  useEffect(() => {
    viewRef.current = [root.x, root.y, root.r * 2]
  }, [root])

  // Measure container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let timeout: ReturnType<typeof setTimeout>
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        clearTimeout(timeout)
        timeout = setTimeout(() => {
          setDimensions({
            width: entry.contentRect.width || 800,
            height: entry.contentRect.height || 600,
          })
        }, 150)
      }
    })
    obs.observe(el)
    return () => {
      clearTimeout(timeout)
      obs.disconnect()
    }
  }, [])

  // Cancel animation on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(animationRef.current)
  }, [])

  // Zoom animation — reads start view from ref to avoid re-creating on every frame
  const zoomTo = useCallback((target: PackedNode) => {
    const targetView: [number, number, number] = [
      target.x,
      target.y,
      target.r * 2,
    ]
    const startView = viewRef.current

    if (
      Math.abs(startView[0] - targetView[0]) < 0.1 &&
      Math.abs(startView[1] - targetView[1]) < 0.1 &&
      Math.abs(startView[2] - targetView[2]) < 0.1
    )
      return

    const interp = interpolateZoom(startView, targetView)
    const duration = 500
    const startTime = performance.now()

    cancelAnimationFrame(animationRef.current)

    const animate = (time: number) => {
      const t = Math.min((time - startTime) / duration, 1)
      setIsAnimating(t < 1)
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      const v = interp(eased)
      const newView: [number, number, number] = [v[0], v[1], v[2]]
      viewRef.current = newView
      setView(newView)
      if (t < 1) {
        animationRef.current = requestAnimationFrame(animate)
      }
    }
    animationRef.current = requestAnimationFrame(animate)
  }, [])

  // Handle focus changes (from breadcrumb, details panel, etc.)
  useEffect(() => {
    const target = focusPath === "" ? root : (nodeByPath.get(focusPath) ?? root)
    zoomTo(target)
  }, [focusPath, root, nodeByPath, zoomTo])

  // Circle click via event delegation on <g>
  const handleGClick = useCallback(
    (e: MouseEvent<SVGGElement>) => {
      const circle = (e.target as Element).closest("circle")
      if (!circle) return
      e.stopPropagation()
      const path = circle.getAttribute("data-path")
      if (path === null) return
      const node = nodeByPath.get(path)
      if (!node) return

      if (
        node.x === root.x &&
        node.y === root.y &&
        node.r === root.r &&
        focusPath === ""
      ) {
        onSelect("")
        return
      }

      const currentFocus =
        focusPath === "" ? root : (nodeByPath.get(focusPath) ?? root)
      if (currentFocus === node) {
        const parent = (node.parent as PackedNode | null) || root
        onFocusChange(parent === root ? "" : parent.data.path)
        onSelect(parent === root ? "" : parent.data.path)
      } else if (node.children) {
        onFocusChange(node.data.path)
        onSelect(node.data.path)
      } else {
        const parent = (node.parent as PackedNode | null) || root
        onFocusChange(parent === root ? "" : parent.data.path)
        onSelect(node.data.path)
      }
    },
    [root, focusPath, nodeByPath, onFocusChange, onSelect],
  )

  const handleSvgClick = useCallback(() => {
    const currentFocus =
      focusPath === "" ? root : (nodeByPath.get(focusPath) ?? root)
    if (currentFocus !== root) {
      const parent = (currentFocus.parent as PackedNode | null) || root
      onFocusChange(parent === root ? "" : parent.data.path)
      onSelect(parent === root ? "" : parent.data.path)
    }
  }, [focusPath, root, nodeByPath, onFocusChange, onSelect])

  // Tooltip via event delegation — position updates use refs (no re-render)
  const handleCircleOver = useCallback(
    (e: MouseEvent<SVGGElement>) => {
      const circle = (e.target as Element).closest("circle")
      if (!circle) return
      const path = circle.getAttribute("data-path")
      if (!path) return
      const node = nodeByPath.get(path)
      if (!node) return
      setTooltipData({
        path: node.data.path || node.data.name,
        isLeaf: !node.children,
        loc: node.data.loc,
        changes: node.data.changes,
        score: node.data.score,
        indexed: node.data.indexed,
      })
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect || !tooltipRef.current) return
      tooltipRef.current.style.left = `${e.clientX - rect.left + 12}px`
      tooltipRef.current.style.top = `${e.clientY - rect.top - 10}px`
    },
    [nodeByPath],
  )

  const handleCircleOut = useCallback((e: MouseEvent<SVGGElement>) => {
    const related = e.relatedTarget as Element | null
    if (related?.closest?.("circle")) return
    setTooltipData(null)
  }, [])

  const handleCircleMove = useCallback((e: MouseEvent<SVGGElement>) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || !tooltipRef.current) return
    tooltipRef.current.style.left = `${e.clientX - rect.left + 12}px`
    tooltipRef.current.style.top = `${e.clientY - rect.top - 10}px`
  }, [])

  const k = (Math.min(dimensions.width, dimensions.height) / view[2]) * 0.95

  // Single transform on <g> instead of per-circle position recalculation
  const transform = `translate(${dimensions.width / 2}, ${dimensions.height / 2}) scale(${k}) translate(${-view[0]}, ${-view[1]})`

  // Circle elements only depend on layout — no callbacks attached per-circle
  const circleElements = useMemo(
    () =>
      allNodes.map((node) => {
        const fill = node.children
          ? "rgba(255,255,255,0.03)"
          : !node.data.indexed
            ? "#486581"
            : scoreColor(node.data.score || 0)
        const stroke = node.children ? "rgba(255,255,255,0.08)" : "none"
        const sw = node.children ? 1 : 0
        const key = node.data.path || `node-${node.depth}-${node.x}`

        return (
          <circle
            key={key}
            data-testid={`circle-${key}`}
            data-path={node.data.path}
            cx={node.x}
            cy={node.y}
            r={node.r}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
            vectorEffect="non-scaling-stroke"
            cursor="pointer"
          />
        )
      }),
    [allNodes],
  )

  // Memoize label overlap resolution — skipped during animation
  const visibleLabels = useMemo(
    () =>
      isAnimating
        ? null
        : resolveOverlaps(
            leafNodes,
            view,
            k,
            dimensions.width,
            dimensions.height,
            selectedPath,
          ),
    [
      isAnimating,
      leafNodes,
      view,
      k,
      dimensions.width,
      dimensions.height,
      selectedPath,
    ],
  )

  return (
    <div className="viz-container" ref={containerRef}>
      <svg
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        preserveAspectRatio="xMidYMid meet"
        onClick={handleSvgClick}
      >
        <g
          transform={transform}
          onClick={handleGClick}
          onMouseOver={handleCircleOver}
          onMouseOut={handleCircleOut}
          onMouseMove={handleCircleMove}
        >
          {circleElements}
        </g>
        {visibleLabels && (
          <g>
            {leafNodes.map((node) => {
              if (!visibleLabels.has(node.data.path)) return null
              const tx = (node.x - view[0]) * k + dimensions.width / 2
              const ty = (node.y - view[1]) * k + dimensions.height / 2
              const fontSize = Math.min(node.r * k * 0.6, 12)

              return (
                <text
                  key={`label-${node.data.path}`}
                  x={tx}
                  y={ty}
                  textAnchor="middle"
                  dy="0.3em"
                  fill="#F0F4F8"
                  fontSize={fontSize}
                  pointerEvents="none"
                >
                  {node.data.name}
                </text>
              )
            })}
          </g>
        )}
      </svg>
      <Tooltip ref={tooltipRef} data={tooltipData} />
    </div>
  )
}

export function resolveOverlaps(
  leafNodes: PackedNode[],
  view: [number, number, number],
  k: number,
  width: number,
  height: number,
  selectedPath: string | null,
): Set<string> {
  const candidates: {
    path: string
    left: number
    right: number
    top: number
    bottom: number
    screenR: number
    selected: boolean
  }[] = []

  for (const d of leafNodes) {
    const screenR = d.r * k
    if (screenR <= 18) continue
    const tx = (d.x - view[0]) * k + width / 2
    const ty = (d.y - view[1]) * k + height / 2
    const fontSize = Math.min(screenR * 0.6, 12)
    const textWidth = d.data.name.length * fontSize * 0.55
    const padding = 3
    candidates.push({
      path: d.data.path,
      left: tx - textWidth / 2 - padding,
      right: tx + textWidth / 2 + padding,
      top: ty - fontSize / 2 - padding,
      bottom: ty + fontSize / 2 + padding,
      screenR,
      selected: selectedPath === d.data.path,
    })
  }

  candidates.sort((a, b) => {
    if (a.selected !== b.selected) return a.selected ? -1 : 1
    return b.screenR - a.screenR
  })

  const kept: typeof candidates = []
  const visible = new Set<string>()
  for (const c of candidates) {
    let overlaps = false
    for (const p of kept) {
      if (
        c.left < p.right &&
        c.right > p.left &&
        c.top < p.bottom &&
        c.bottom > p.top
      ) {
        overlaps = true
        break
      }
    }
    if (!overlaps) {
      kept.push(c)
      visible.add(c.path)
    }
  }
  return visible
}
