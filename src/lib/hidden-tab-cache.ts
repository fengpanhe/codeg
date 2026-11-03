export const HIDDEN_TAB_TIMEOUT_MS = 10 * 60_000
export const HIDDEN_CONVERSATION_CACHE_LIMIT = 5
export const HIDDEN_FILE_CACHE_LIMIT = 20
export const TAB_CACHE_SWEEP_MS = 30_000

interface CachedTab {
  visible: boolean
  visited: boolean
  hiddenAt: number
  suspended: boolean
}

/** Tab metadata outlives its heavy cache. Showing a tab always wakes it. */
export class HiddenTabCache {
  private tabs = new Map<string, CachedTab>()
  private snapshot: ReadonlySet<string> = new Set()
  private listeners = new Set<() => void>()
  getSnapshot = (): ReadonlySet<string> => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  update(
    ids: readonly string[],
    visibleIds: ReadonlySet<string>,
    now: number,
    timeoutMs: number,
    hiddenLimit: number
  ): Set<string> {
    const open = new Set(ids)
    for (const id of this.tabs.keys()) {
      if (!open.has(id)) this.tabs.delete(id)
    }
    for (const id of ids) {
      const visible = visibleIds.has(id)
      const prior = this.tabs.get(id)
      this.tabs.set(id, {
        visible,
        visited: visible || (prior?.visited ?? false),
        hiddenAt: prior?.visible || !prior ? now : prior.hiddenAt,
        suspended: visible ? false : (prior?.suspended ?? true),
      })
    }
    const retained = [...this.tabs.entries()]
      .filter(([, tab]) => !tab.visible && tab.visited && !tab.suspended)
      .sort((a, b) => b[1].hiddenAt - a[1].hiddenAt)
    retained.forEach(([, tab], index) => {
      if (index >= hiddenLimit || now - tab.hiddenAt >= timeoutMs) {
        tab.suspended = true
      }
    })
    const next = new Set(
      [...this.tabs.entries()]
        .filter(([, tab]) => !tab.visible && tab.suspended)
        .map(([id]) => id)
    )
    if (
      next.size !== this.snapshot.size ||
      [...next].some((id) => !this.snapshot.has(id))
    ) {
      this.snapshot = next
      for (const listener of this.listeners) listener()
    }
    return next
  }
}
