/**
 * Searches all rendered frames for one matching the predicate.
 * Uses the frames array (not lastFrame) so it finds frames even after
 * useApp().exit() unmounts the component — which on CI can happen
 * before the next event loop tick.
 */
export async function waitForFrame(
  frames: readonly string[],
  predicate: (frame: string) => boolean,
  timeout = 2000,
): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const match = frames.find(predicate)
    if (match) return match
    await new Promise((r) => setTimeout(r, 10))
  }
  return frames[frames.length - 1] ?? ""
}
