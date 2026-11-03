"use client"

import {
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react"
import {
  HiddenTabCache,
  HIDDEN_TAB_TIMEOUT_MS,
  TAB_CACHE_SWEEP_MS,
} from "@/lib/hidden-tab-cache"

const EMPTY: ReadonlySet<string> = new Set()

export function useHiddenTabCache(
  ids: readonly string[],
  visibleIds: ReadonlySet<string>,
  enabled: boolean,
  hiddenLimit: number
): ReadonlySet<string> {
  const [cache] = useState(() => {
    const initial = new HiddenTabCache()
    initial.update(
      ids,
      enabled ? visibleIds : new Set(ids),
      Date.now(),
      HIDDEN_TAB_TIMEOUT_MS,
      hiddenLimit
    )
    return initial
  })
  const suspended = useSyncExternalStore(
    cache.subscribe,
    cache.getSnapshot,
    cache.getSnapshot
  )
  useLayoutEffect(() => {
    cache.update(
      ids,
      enabled ? visibleIds : new Set(ids),
      Date.now(),
      HIDDEN_TAB_TIMEOUT_MS,
      hiddenLimit
    )
  }, [cache, ids, visibleIds, enabled, hiddenLimit])
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => {
      cache.update(
        ids,
        visibleIds,
        Date.now(),
        HIDDEN_TAB_TIMEOUT_MS,
        hiddenLimit
      )
    }, TAB_CACHE_SWEEP_MS)
    return () => clearInterval(timer)
  }, [cache, ids, visibleIds, enabled, hiddenLimit])
  return enabled ? suspended : EMPTY
}
