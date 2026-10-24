"use client"

import { useEffect } from "react"
import { useWorkbenchStore } from "@/stores/workbench-store"
import { useWorktreeTabsStore } from "@/stores/worktree-tabs-store"

/** Presentation only: a blank never clears the retained inner scope. */
export function isEmptyWorkbenchPresentation() {
  const outer = useWorktreeTabsStore.getState()
  return (
    useWorkbenchStore.getState().uiMode === "unified" &&
    outer.tabs.find((tab) => tab.id === outer.activeTabId)?.scopeId == null
  )
}

export function useWorktreeWorkbenchPresentation() {
  const uiMode = useWorkbenchStore((state) => state.uiMode)
  const activeScopeId = useWorktreeTabsStore(
    (state) =>
      state.tabs.find((tab) => tab.id === state.activeTabId)?.scopeId ?? null
  )
  const hydrated = useWorktreeTabsStore((state) => state.hydrated)
  useEffect(() => {
    if (!hydrated) useWorktreeTabsStore.getState().hydrate()
  }, [hydrated])
  return {
    isWorkbench: uiMode === "unified",
    isEmptyWorkbench: uiMode === "unified" && activeScopeId == null,
    activeOuterScopeId: activeScopeId,
  }
}
