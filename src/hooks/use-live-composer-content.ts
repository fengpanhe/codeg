"use client"

import { useCallback, useSyncExternalStore } from "react"
import {
  hasLiveComposerContent,
  subscribeLiveComposerContent,
} from "@/lib/message-input-draft"

export function useLiveComposerContent(key: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => subscribeLiveComposerContent(key, listener),
    [key]
  )
  const snapshot = useCallback(() => hasLiveComposerContent(key), [key])
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
