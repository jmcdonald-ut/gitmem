/// <reference lib="dom" />
import type { TrendSummary } from "@/types"
import type { HierarchyResult } from "@commands/visualize/hierarchy"

export type {
  HierarchyResult,
  HierarchyNode,
} from "@commands/visualize/hierarchy"

export interface HierarchyResponse extends HierarchyResult {
  repoName: string
  pathPrefix: string
}

export interface ClassificationCounts {
  bug_fix_count: number
  feature_count: number
  refactor_count: number
  docs_count: number
  chore_count: number
  perf_count: number
  test_count: number
  style_count: number
}

export interface BaseStats extends ClassificationCounts {
  total_changes: number
  current_loc: number | null
  current_complexity: number | null
  first_seen?: string
  last_changed?: string
  total_additions?: number
  total_deletions?: number
}

interface Hotspot {
  file: string
  changes: number
  score: number
}

interface Contributor {
  name: string
  commits: number
}

interface CoupledFile {
  file: string
  count: number
  ratio: number
}

interface CoupledPair {
  fileA: string
  fileB: string
  count: number
}

export interface RootDetails {
  type: "root"
  totalCommits: number
  enrichedCommits: number
  enrichmentPct: number
  hotspots: Hotspot[]
  coupledPairs: CoupledPair[]
  trendSummary: TrendSummary | null
}

export interface DirectoryDetails {
  type: "directory"
  path: string
  fileCount: number
  stats: BaseStats | null
  hotspots: Hotspot[]
  contributors: Contributor[]
  coupled: CoupledFile[]
  trendSummary: TrendSummary | null
}

export interface FileDetails {
  type: "file"
  path: string
  stats: BaseStats | null
  contributors: Contributor[]
  coupled: CoupledFile[]
  trendSummary: TrendSummary | null
}

export type DetailsResponse = RootDetails | DirectoryDetails | FileDetails
