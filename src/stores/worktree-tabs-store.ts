import { create } from "zustand"
import { registerBackendScopedStoreReset } from "@/stores/backend-scoped-store-reset"
import { useWorkbenchStore } from "@/stores/workbench-store"
import {
  readPersistedWorktreeTabsState,
  writePersistedWorktreeTabsState,
  WORKTREE_TABS_PERSISTENCE_VERSION,
  type PersistedWorktreeTabsState,
} from "@/lib/worktree-tabs-persistence"
import {
  scopeKey,
  type WorktreeTabsState,
  type WorktreeWorkbenchTab,
  type WorkspaceScopeId,
} from "@/types/workbench"

const initialState = {
  tabs: [] as WorktreeWorkbenchTab[],
  activeTabId: null as string | null,
  hydrated: false,
}

let persistenceEnabled = true
let nextTabSeq = 1

function normalizeScopeId(scopeId: WorkspaceScopeId): WorkspaceScopeId {
  if (scopeId === "global") return "global"
  return Number.isInteger(scopeId) && scopeId > 0 ? scopeId : "global"
}

function makeTabId(): string {
  const id = "worktree-tab-" + nextTabSeq
  nextTabSeq += 1
  return id
}

function seedNextTabSeq(tabs: readonly WorktreeWorkbenchTab[]): void {
  for (const tab of tabs) {
    const match = /^worktree-tab-(\d+)$/.exec(tab.id)
    if (!match) continue
    nextTabSeq = Math.max(nextTabSeq, Number(match[1]) + 1)
  }
}

function pinOrdered(tabs: WorktreeWorkbenchTab[]): WorktreeWorkbenchTab[] {
  return [
    ...tabs.filter((tab) => tab.isPinned),
    ...tabs.filter((tab) => !tab.isPinned),
  ]
}

function serializeState(state: WorktreeTabsState): PersistedWorktreeTabsState {
  return {
    version: WORKTREE_TABS_PERSISTENCE_VERSION,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
  }
}

function persist() {
  if (!persistenceEnabled) return
  const state = useWorktreeTabsStore.getState()
  if (!state.hydrated) return
  writePersistedWorktreeTabsState(serializeState(state))
}

function activateInnerScope(scopeId: WorkspaceScopeId | null) {
  if (scopeId == null) return
  useWorkbenchStore.getState().activateScope(scopeId)
}

function concreteScopeKey(scopeId: WorkspaceScopeId): string {
  return scopeKey(normalizeScopeId(scopeId))
}

export const useWorktreeTabsStore = create<WorktreeTabsState>((set, get) => ({
  ...initialState,

  hydrate: () => {
    if (get().hydrated) return
    const result = readPersistedWorktreeTabsState()
    persistenceEnabled = result.ok
    if (result.ok && result.state) {
      const tabs = pinOrdered(result.state.tabs)
      seedNextTabSeq(tabs)
      set({
        tabs,
        activeTabId: result.state.activeTabId,
        hydrated: true,
      })
      const active = result.state.tabs.find(
        (tab) => tab.id === result.state?.activeTabId
      )
      activateInnerScope(active?.scopeId ?? null)
      return
    }
    set({ hydrated: true })
  },

  openWorktree: (scopeId) => {
    const normalized = normalizeScopeId(scopeId)
    const targetKey = concreteScopeKey(normalized)
    set((state) => {
      const existing = state.tabs.find(
        (tab) => tab.scopeId != null && scopeKey(tab.scopeId) === targetKey
      )
      if (existing) return { activeTabId: existing.id }

      const active = state.tabs.find((tab) => tab.id === state.activeTabId)
      if (active && !active.isPinned) {
        return {
          tabs: pinOrdered(
            state.tabs.map((tab) =>
              tab.id === active.id ? { ...tab, scopeId: normalized } : tab
            )
          ),
          activeTabId: active.id,
        }
      }

      const tab: WorktreeWorkbenchTab = {
        id: makeTabId(),
        scopeId: normalized,
        isPinned: false,
      }
      return {
        tabs: pinOrdered([...state.tabs, tab]),
        activeTabId: tab.id,
      }
    })
    activateInnerScope(normalized)
    persist()
  },

  createEmptyTab: () => {
    const tab: WorktreeWorkbenchTab = {
      id: makeTabId(),
      scopeId: null,
      isPinned: false,
    }
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }))
    persist()
  },

  activateTab: (id) => {
    const tab = get().tabs.find((item) => item.id === id)
    if (!tab) return
    set({ activeTabId: id })
    activateInnerScope(tab.scopeId)
    persist()
  },

  closeTab: (id) => {
    let nextScope: WorkspaceScopeId | null | undefined
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id)
      if (index < 0) return {}
      const tabs = state.tabs.filter((tab) => tab.id !== id)
      let activeTabId = state.activeTabId
      if (activeTabId === id) {
        activeTabId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null
        nextScope = tabs.find((tab) => tab.id === activeTabId)?.scopeId ?? null
      }
      return { tabs, activeTabId }
    })
    if (nextScope !== undefined) activateInnerScope(nextScope)
    persist()
  },

  setPinned: (id, pinned) => {
    set((state) => {
      if (!state.tabs.some((tab) => tab.id === id)) return {}
      return {
        tabs: pinOrdered(
          state.tabs.map((tab) =>
            tab.id === id ? { ...tab, isPinned: pinned } : tab
          )
        ),
      }
    })
    persist()
  },
}))

export function __resetWorktreeTabsStoreForTests(): void {
  persistenceEnabled = true
  nextTabSeq = 1
  useWorktreeTabsStore.setState({ ...initialState })
}

registerBackendScopedStoreReset(() => {
  __resetWorktreeTabsStoreForTests()
})
