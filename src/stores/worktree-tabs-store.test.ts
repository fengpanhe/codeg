import { beforeEach, describe, expect, it } from "vitest"
import {
  __resetWorkbenchStoreForTests,
  useWorkbenchStore,
} from "@/stores/workbench-store"
import {
  __resetWorktreeTabsStoreForTests,
  useWorktreeTabsStore,
} from "@/stores/worktree-tabs-store"
import {
  WORKTREE_TABS_PERSISTENCE_VERSION,
  worktreeTabsStorageKey,
} from "@/lib/worktree-tabs-persistence"
import { activateWorkbenchScopeWithOuterTab } from "@/lib/worktree-tabs-navigation"

function state() {
  return useWorktreeTabsStore.getState()
}

function currentId() {
  return state().activeTabId
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  __resetWorkbenchStoreForTests()
  __resetWorktreeTabsStoreForTests()
})

describe("worktree tabs store", () => {
  it("activates an existing worktree tab instead of replacing empty or temporary tabs", () => {
    state().hydrate()
    state().openWorktree(1)
    const a = currentId()
    expect(a).toBeTruthy()
    state().setPinned(a as string, true)
    state().createEmptyTab()
    const blank = currentId()
    state().openWorktree(1)

    expect(currentId()).toBe(a)
    expect(state().tabs.find((tab) => tab.id === blank)?.scopeId).toBeNull()

    state().setPinned(a as string, false)
    expect(state().tabs).toHaveLength(2)
  })

  it("fills the active temporary tab but opens next to a pinned tab", () => {
    state().hydrate()
    state().createEmptyTab()
    const blank = currentId()
    state().openWorktree(1)

    expect(currentId()).toBe(blank)
    expect(state().tabs).toEqual([{ id: blank, scopeId: 1, isPinned: false }])

    state().setPinned(blank as string, true)
    state().openWorktree(2)

    expect(state().tabs).toEqual([
      { id: blank, scopeId: 1, isPinned: true },
      { id: currentId(), scopeId: 2, isPinned: false },
    ])
  })

  it("keeps empty tabs separate from global scope and retains hidden workbench state", () => {
    useWorkbenchStore.getState().hydrate()
    state().hydrate()
    state().openWorktree(1)
    useWorkbenchStore
      .getState()
      .openTab(1, { id: "c1", type: "conversation", entityId: "c1" })

    state().createEmptyTab()

    expect(
      state().tabs.find((tab) => tab.id === currentId())?.scopeId
    ).toBeNull()
    expect(useWorkbenchStore.getState().activeScopeId).toBe(1)

    state().openWorktree(2)
    expect(useWorkbenchStore.getState().workspaces["1"].tabRefs).toEqual([
      { id: "c1", type: "conversation", entityId: "c1" },
    ])
    expect(useWorkbenchStore.getState().activeScopeId).toBe(2)
  })

  it("hydrates a selected empty tab without filling it from retained workbench scope", () => {
    localStorage.setItem(
      worktreeTabsStorageKey(),
      JSON.stringify({
        version: WORKTREE_TABS_PERSISTENCE_VERSION,
        activeTabId: "blank",
        tabs: [
          { id: "scope-1", scopeId: 1, isPinned: false },
          { id: "blank", scopeId: null, isPinned: false },
        ],
      })
    )
    useWorkbenchStore.getState().hydrate()
    useWorkbenchStore.getState().activateScope(1)

    state().hydrate()

    expect(currentId()).toBe("blank")
    expect(state().tabs.find((tab) => tab.id === "blank")?.scopeId).toBeNull()
    expect(useWorkbenchStore.getState().activeScopeId).toBe(1)
  })

  it("preserves rejected caches by disabling writes until a backend reset", () => {
    const key = worktreeTabsStorageKey()
    localStorage.setItem(key, "{not-json")

    state().hydrate()
    state().openWorktree(1)

    expect(localStorage.getItem(key)).toBe("{not-json")

    __resetWorktreeTabsStoreForTests()
    localStorage.removeItem(key)
    state().hydrate()
    state().openWorktree(1)

    expect(JSON.parse(localStorage.getItem(key) as string)).toMatchObject({
      version: WORKTREE_TABS_PERSISTENCE_VERSION,
      tabs: [{ scopeId: 1, isPinned: false }],
    })
  })

  it("allocates new ids after hydrated persisted ids", () => {
    localStorage.setItem(
      worktreeTabsStorageKey(),
      JSON.stringify({
        version: WORKTREE_TABS_PERSISTENCE_VERSION,
        activeTabId: "worktree-tab-7",
        tabs: [{ id: "worktree-tab-7", scopeId: null, isPinned: false }],
      })
    )

    state().hydrate()
    state().createEmptyTab()

    expect(state().tabs.map((tab) => tab.id)).toEqual([
      "worktree-tab-7",
      "worktree-tab-8",
    ])
  })

  it("syncs explicit outer navigation while passive workbench changes leave blank selected", () => {
    useWorkbenchStore.getState().hydrate()
    state().hydrate()
    state().openWorktree(1)
    state().createEmptyTab()
    const blank = currentId()

    useWorkbenchStore.getState().activateScope(1)

    expect(currentId()).toBe(blank)
    expect(state().tabs.find((tab) => tab.id === blank)?.scopeId).toBeNull()

    activateWorkbenchScopeWithOuterTab(1)

    expect(state().tabs.find((tab) => tab.id === blank)?.scopeId).toBeNull()
    expect(state().tabs.find((tab) => tab.id === currentId())?.scopeId).toBe(1)
  })
})
