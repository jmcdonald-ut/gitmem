/// <reference lib="dom" />

export function fmt(n: number | null | undefined): string {
  if (n == null) return "\u2014"
  return n.toLocaleString()
}

export function smartTruncate(filePath: string, maxChars: number): string {
  if (!filePath || filePath.length <= maxChars) return filePath
  const parts = filePath.split("/")
  if (parts.length <= 2) return filePath
  const first = parts[0]
  const last = parts[parts.length - 1]
  const min = first + "/.../" + last
  if (min.length >= maxChars) return min
  let end = last
  for (let i = parts.length - 2; i > 0; i--) {
    const candidate = first + "/.../" + parts.slice(i).join("/")
    if (candidate.length <= maxChars) {
      end = parts.slice(i).join("/")
    } else {
      break
    }
  }
  return first + "/.../" + end
}
