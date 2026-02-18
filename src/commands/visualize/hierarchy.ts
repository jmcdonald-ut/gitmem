import type { FileStatsRow } from "@/types"

export interface HierarchyNode {
  name: string
  path: string
  loc?: number
  score?: number
  changes?: number
  indexed: boolean
  children?: HierarchyNode[]
}

export interface HierarchyResult {
  root: HierarchyNode
  totalTracked: number
  totalIndexed: number
  unindexedCount: number
}

export function buildHierarchy(
  trackedFiles: string[],
  fileStats: Map<string, FileStatsRow>,
): HierarchyResult {
  const root: HierarchyNode = {
    name: "",
    path: "",
    indexed: false,
    children: [],
  }

  if (trackedFiles.length === 0) {
    return { root, totalTracked: 0, totalIndexed: 0, unindexedCount: 0 }
  }

  // Compute normalization values across all file stats
  let maxChanges = 0
  let maxComplexity = 0
  for (const stats of fileStats.values()) {
    if (stats.total_changes > maxChanges) maxChanges = stats.total_changes
    if (
      stats.current_complexity != null &&
      stats.current_complexity > maxComplexity
    )
      maxComplexity = stats.current_complexity
  }

  let totalIndexed = 0
  const leaves: HierarchyNode[] = []

  for (const filePath of trackedFiles) {
    const segments = filePath.split("/")
    let current = root

    // Build directory nodes
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]
      const dirPath = segments.slice(0, i + 1).join("/") + "/"
      let child = current.children!.find((c) => c.name === segment)
      if (!child) {
        child = {
          name: segment,
          path: dirPath,
          indexed: false,
          children: [],
        }
        current.children!.push(child)
      }
      current = child
    }

    // Create leaf node
    const fileName = segments[segments.length - 1]
    const stats = fileStats.get(filePath)
    const indexed = stats != null

    if (indexed) totalIndexed++

    let score = 0
    if (
      indexed &&
      maxChanges > 0 &&
      maxComplexity > 0 &&
      stats!.current_complexity != null
    ) {
      score =
        (stats!.total_changes / maxChanges) *
        (stats!.current_complexity / maxComplexity)
    }

    const leaf: HierarchyNode = {
      name: fileName,
      path: filePath,
      loc: indexed && stats!.current_loc != null ? stats!.current_loc : 1,
      score,
      changes: indexed ? stats!.total_changes : 0,
      indexed,
    }
    current.children!.push(leaf)
    leaves.push(leaf)

    // Mark ancestor directories as indexed if this file is indexed
    if (indexed) {
      let node = root
      for (let i = 0; i < segments.length - 1; i++) {
        const segment = segments[i]
        const child = node.children!.find((c) => c.name === segment)!
        child.indexed = true
        node = child
      }
      root.indexed = true
    }
  }

  // Rescale scores so the max observed score maps to 1.0
  let maxScore = 0
  for (const leaf of leaves) {
    if (leaf.score! > maxScore) maxScore = leaf.score!
  }
  if (maxScore > 0) {
    for (const leaf of leaves) {
      leaf.score = leaf.score! / maxScore
    }
  }

  return {
    root,
    totalTracked: trackedFiles.length,
    totalIndexed,
    unindexedCount: trackedFiles.length - totalIndexed,
  }
}
