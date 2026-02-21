const GENERATED_FILENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "Gemfile.lock",
  "Cargo.lock",
  "composer.lock",
  "poetry.lock",
  "go.sum",
])

const GENERATED_EXTENSIONS = [".min.js", ".min.css", ".map", ".lock"]

export function isGenerated(filePath: string): boolean {
  const basename = filePath.split("/").pop() ?? ""
  if (GENERATED_FILENAMES.has(basename)) return true
  for (const ext of GENERATED_EXTENSIONS) {
    if (filePath.endsWith(ext)) return true
  }
  return false
}

export function filterByTrackedFiles<T extends { file_path: string }>(
  items: T[],
  trackedFiles: Set<string>,
  limit: number,
): T[] {
  return items.filter((r) => trackedFiles.has(r.file_path)).slice(0, limit)
}

export function filterPairsByTrackedFiles<
  T extends { file_a: string; file_b: string },
>(pairs: T[], trackedFiles: Set<string>, limit: number): T[] {
  return pairs
    .filter((p) => trackedFiles.has(p.file_a) && trackedFiles.has(p.file_b))
    .slice(0, limit)
}
