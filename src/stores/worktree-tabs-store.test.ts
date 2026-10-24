import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  __resetWorkbenchStoreForTests,
  useWorkbenchStore,
} from "@/stores/workbench-store"
import {
  __resetWorktreeTabsStoreForTests,
  useWorktreeTabsStore,
} from "@/stores/worktree-tabs-store"
import { resetTabStore, useTabStore } from "@/stores/tab-store"
import {
  WORKTREE_TABS_PERSISTENCE_VERSION,
  MAX_WORKTREE_TABS,
  readPersistedWorktreeTabsState,
  worktreeTabsStorageKey,
} from "@/lib/worktree-tabs-persistence"
import { activateWorkbenchScopeWithOuterTab } from "@/lib/worktree-tabs-navigation"
import type { WorktreeWorkbenchTab } from "@/types/workbench"
import {
  resetAppWorkspaceStore,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"

const listOpenedTabsMock = vi.fn()

vi.mock("@/lib/api", () => ({
  listOpenedTabs: (...args: unknown[]) => listOpenedTabsMock(...args),
  saveOpenedTabs: vi.fn(),
  getFolderConversation: vi.fn(),
}))

function state() {
  return useWorktreeTabsStore.getState()
}

function currentId() {
  return state().activeTabId
}

function blankTabs(count: number, pinned = true): WorktreeWorkbenchTab[] {
  return Array.from({ length: count }, (_, index) => ({
    id: "seed-" + index,
    scopeId: null,
    isPinned: pinned,
  }))
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  listOpenedTabsMock.mockReset()
  listOpenedTabsMock.mockResolvedValue({ version: 1, items: [] })
  resetAppWorkspaceStore()
  useAppWorkspaceStore.setState({
    folders: [
      { id: 1, path: "/repo-a" },
      { id: 2, path: "/repo-b" },
    ] as never,
    allFolders: [
      { id: 1, path: "/repo-a" },
      { id: 2, path: "/repo-b" },
    ] as never,
    foldersHydrated: true,
    conversations: [],
    conversationsLoading: false,
  })
  resetTabStore()
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

  it.each([
    "9007199254740990",
    "9007199254740991",
    "9007199254740992",
    "9".repeat(100),
    "0009007199254740991",
    "0007",
  ])(
    "keeps accepted suffix %s unique through append, close and restore",
    (suffix) => {
      const restoredId = `worktree-tab-${suffix}`
      localStorage.setItem(
        worktreeTabsStorageKey(),
        JSON.stringify({
          version: WORKTREE_TABS_PERSISTENCE_VERSION,
          activeTabId: restoredId,
          tabs: [
            { id: restoredId, scopeId: null, isPinned: true },
            { id: "worktree-tab-1", scopeId: null, isPinned: true },
          ],
        })
      )
      state().hydrate()
      expect(state().openWorktree(1)).toBe(true)
      expect(state().createEmptyTab()).toBe(true)
      expect(new Set(state().tabs.map((tab) => tab.id)).size).toBe(4)
      expect(readPersistedWorktreeTabsState()).toMatchObject({
        ok: true,
        state: { tabs: state().tabs, activeTabId: currentId() },
      })
      const closedId = currentId()!
      state().closeTab(closedId)
      const remaining = state().tabs
      expect(remaining).toHaveLength(3)
      expect(remaining[0].id).toBe(restoredId)
      expect(remaining.some((tab) => tab.id === closedId)).toBe(false)
      __resetWorktreeTabsStoreForTests()
      state().hydrate()
      expect(state().tabs).toEqual(remaining)
    }
  )

  it("checks live ids before every append", () => {
    state().hydrate()
    useWorktreeTabsStore.setState({
      tabs: [{ id: "worktree-tab-1", scopeId: null, isPinned: true }],
      activeTabId: "worktree-tab-1",
    })
    state().createEmptyTab()
    expect(state().tabs.map((tab) => tab.id)).toEqual([
      "worktree-tab-1",
      "worktree-tab-2",
    ])
  })

  it("persists and rehydrates the last allowed append", () => {
    state().hydrate()
    useWorktreeTabsStore.setState({
      tabs: blankTabs(MAX_WORKTREE_TABS - 1),
      activeTabId: "seed-0",
      hydrated: true,
    })

    expect(state().openWorktree(1)).toBe(true)

    const raw = localStorage.getItem(worktreeTabsStorageKey())
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw as string).tabs).toHaveLength(MAX_WORKTREE_TABS)

    __resetWorktreeTabsStoreForTests()
    state().hydrate()

    expect(state().tabs).toHaveLength(MAX_WORKTREE_TABS)
    expect(state().tabs.find((tab) => tab.id === currentId())?.scopeId).toBe(1)
  })

  it("refuses over-limit appends without mutating state or writing storage", () => {
    state().hydrate()
    useWorkbenchStore.getState().hydrate()
    useWorkbenchStore.getState().activateScope(2)
    useWorktreeTabsStore.setState({
      tabs: blankTabs(MAX_WORKTREE_TABS),
      activeTabId: "seed-0",
      hydrated: true,
    })
    const before = state()
    localStorage.setItem(worktreeTabsStorageKey(), "sentinel")

    expect(state().canOpenWorktree(1)).toBe(false)
    expect(state().openWorktree(1)).toBe(false)
    expect(state().createEmptyTab()).toBe(false)

    expect(state().tabs).toEqual(before.tabs)
    expect(state().activeTabId).toBe(before.activeTabId)
    expect(useWorkbenchStore.getState().activeScopeId).toBe(2)
    expect(localStorage.getItem(worktreeTabsStorageKey())).toBe("sentinel")
  })

  it("allows existing activation, temporary reuse, and unpin at capacity", () => {
    state().hydrate()
    useWorkbenchStore.getState().hydrate()
    const full = blankTabs(MAX_WORKTREE_TABS)
    full[3] = { id: "scope-1", scopeId: 1, isPinned: true }
    useWorktreeTabsStore.setState({
      tabs: full,
      activeTabId: "seed-0",
      hydrated: true,
    })

    expect(state().openWorktree(1)).toBe(true)
    expect(currentId()).toBe("scope-1")
    expect(state().tabs).toHaveLength(MAX_WORKTREE_TABS)

    state().setPinned("scope-1", false)
    expect(state().tabs.find((tab) => tab.id === "scope-1")?.isPinned).toBe(
      false
    )

    useWorktreeTabsStore.setState({
      tabs: blankTabs(MAX_WORKTREE_TABS, false),
      activeTabId: "seed-0",
      hydrated: true,
    })

    expect(state().openWorktree(2)).toBe(true)
    expect(state().tabs).toHaveLength(MAX_WORKTREE_TABS)
    expect(state().tabs.find((tab) => tab.id === "seed-0")?.scopeId).toBe(2)
  })

  it("keeps inner scope and conversation focus unchanged when a bridged switch is refused", () => {
    useWorkbenchStore.getState().hydrate()
    useWorkbenchStore.getState().activateScope(1)
    state().hydrate()
    useWorktreeTabsStore.setState({
      tabs: blankTabs(MAX_WORKTREE_TABS),
      activeTabId: "seed-0",
      hydrated: true,
    })
    useTabStore.setState({
      rawTabs: [
        {
          id: "conv-1-codex-11",
          kind: "conversation",
          folderId: 1,
          conversationId: 11,
          agentType: "codex",
          title: "One",
          isPinned: true,
        },
        {
          id: "conv-2-grok-22",
          kind: "conversation",
          folderId: 2,
          conversationId: 22,
          agentType: "grok",
          title: "Two",
          isPinned: true,
        },
      ] as never,
      activeTabId: "conv-1-codex-11",
    })

    useTabStore.getState().switchTab("conv-2-grok-22")

    expect(useTabStore.getState().activeTabId).toBe("conv-1-codex-11")
    expect(state().activeTabId).toBe("seed-0")
    expect(useWorkbenchStore.getState().activeScopeId).toBe(1)
  })

  it("keeps inner scope and existing-open focus unchanged when bridged open is refused", () => {
    useWorkbenchStore.getState().hydrate()
    useWorkbenchStore.getState().activateScope(1)
    state().hydrate()
    useWorktreeTabsStore.setState({
      tabs: blankTabs(MAX_WORKTREE_TABS),
      activeTabId: "seed-0",
      hydrated: true,
    })
    useTabStore.setState({
      rawTabs: [
        {
          id: "conv-1-codex-11",
          kind: "conversation",
          folderId: 1,
          conversationId: 11,
          agentType: "codex",
          title: "One",
          isPinned: true,
        },
        {
          id: "conv-2-grok-22",
          kind: "conversation",
          folderId: 2,
          conversationId: 22,
          agentType: "grok",
          title: "Two",
          isPinned: false,
        },
      ] as never,
      activeTabId: "conv-1-codex-11",
    })

    useTabStore.getState().openTab(2, 22, "grok", true)

    expect(useTabStore.getState().activeTabId).toBe("conv-1-codex-11")
    expect(useTabStore.getState().rawTabs[1]?.isPinned).toBe(false)
    expect(state().activeTabId).toBe("seed-0")
    expect(useWorkbenchStore.getState().activeScopeId).toBe(1)
  })

  it("syncs existing conversation open paths from a selected blank", () => {
    useWorkbenchStore.getState().hydrate()
    state().hydrate()
    useTabStore.getState().openTab(1, 11, "codex", true)
    const existingOuter = currentId()
    state().createEmptyTab()
    const blank = currentId()

    useTabStore.getState().openTab(1, 11, "codex", true)

    expect(state().tabs.find((tab) => tab.id === blank)?.scopeId).toBeNull()
    expect(currentId()).toBe(existingOuter)
    expect(useWorkbenchStore.getState().activeScopeId).toBe(1)
  })

  it("syncs explicit switchTab paths from a selected blank", () => {
    useWorkbenchStore.getState().hydrate()
    state().hydrate()
    useTabStore.getState().openTab(1, 11, "codex", true)
    useTabStore.getState().openTab(2, 22, "grok", true)
    state().createEmptyTab()
    const blank = currentId()

    useTabStore.getState().switchTab("conv-2-grok-22")

    expect(state().tabs.find((tab) => tab.id === blank)?.scopeId).toBeNull()
    expect(state().tabs.find((tab) => tab.id === currentId())?.scopeId).toBe(2)
    expect(useWorkbenchStore.getState().activeScopeId).toBe(2)
  })

  it("keeps selected blank during passive tab-store hydrate recovery", async () => {
    listOpenedTabsMock.mockRejectedValueOnce(new Error("backend down"))
    useWorkbenchStore.getState().hydrate()
    state().hydrate()
    state().openWorktree(1)
    useTabStore.getState().openTab(1, 11, "codex", true)
    state().createEmptyTab()
    const blank = currentId()

    useTabStore.getState().hydrate()
    await Promise.resolve()
    await Promise.resolve()

    expect(currentId()).toBe(blank)
    expect(state().tabs.find((tab) => tab.id === blank)?.scopeId).toBeNull()
  })

  it.each([false, true])(
    "restores delayed incoming B selection without navigating (selected blank: %s)",
    async (blank) => {
      const snapshot = {
        version: 2,
        items: [
          {
            folder_id: 1,
            conversation_id: 11,
            agent_type: "codex",
            is_pinned: true,
            is_active: false,
          },
          {
            folder_id: 2,
            conversation_id: 21,
            agent_type: "codex",
            is_pinned: true,
            is_active: false,
          },
          {
            folder_id: 2,
            conversation_id: 22,
            agent_type: "codex",
            is_pinned: true,
            is_active: true,
          },
        ],
      }
      let finish!: (value: typeof snapshot) => void
      listOpenedTabsMock.mockImplementationOnce(
        () =>
          new Promise<typeof snapshot>((resolve) => {
            finish = resolve
          })
      )
      useWorkbenchStore.getState().hydrate()
      useWorkbenchStore.getState().setUiMode("unified")
      localStorage.setItem(
        worktreeTabsStorageKey(),
        JSON.stringify({
          version: WORKTREE_TABS_PERSISTENCE_VERSION,
          activeTabId: "outer-a",
          tabs: [
            { id: "outer-a", scopeId: 1, isPinned: true },
            { id: "outer-b", scopeId: 2, isPinned: false },
          ],
        })
      )
      state().hydrate()
      if (blank) state().createEmptyTab()
      const selectedOuter = currentId()
      const cancel = useTabStore.getState().hydrate()
      expect(useWorkbenchStore.getState().activeScopeId).toBe(1)
      finish(snapshot)
      await Promise.resolve()
      await Promise.resolve()
      expect(useTabStore.getState().tabsHydrated).toBe(true)
      expect(currentId()).toBe(selectedOuter)
      expect(
        state().tabs.find((tab) => tab.id === selectedOuter)?.scopeId
      ).toBe(blank ? null : 1)
      expect(useWorkbenchStore.getState().activeScopeId).toBe(1)
      expect(useAppWorkspaceStore.getState().activeFolderId).toBe(1)
      expect(useTabStore.getState().activeTabId).toBe("conv-1-codex-11")
      const b = useWorkbenchStore.getState().workspaces["2"]
      expect(b.lastConversationTabId).toBe("conv-2-codex-22")
      expect(b.groupSelection[b.focusedGroupId]).toBe("conv-2-codex-22")
      state().activateTab("outer-b")
      expect(useTabStore.getState().activeTabId).toBe("conv-2-codex-22")
      cancel()
    }
  )

  it.each([false, true])(
    "restores delayed B draft recovery without navigating (selected blank: %s)",
    async (blank) => {
      localStorage.setItem(
        "workspace:tab-groups:v1",
        JSON.stringify({
          layout: { type: "group", id: "g-main" },
          assignments: {},
          selection: {},
          tileByGroup: {},
          activeDraft: "new-b",
          drafts: [
            {
              id: "new-a",
              folderId: 1,
              index: 0,
              group: "g-main",
              agentType: "codex",
            },
            {
              id: "new-b",
              folderId: 2,
              index: 1,
              group: "g-main",
              agentType: "codex",
            },
          ],
        })
      )
      resetTabStore()
      useWorkbenchStore.getState().hydrate()
      useWorkbenchStore.getState().setUiMode("unified")
      state().hydrate()
      state().openWorktree(1)
      if (blank) state().createEmptyTab()
      const outerA = currentId()
      let fail!: (reason: Error) => void
      listOpenedTabsMock.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = reject
          })
      )
      const error = new Error("expected draft recovery failure")
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      const cancel = useTabStore.getState().hydrate()
      try {
        fail(error)
        await Promise.resolve()
        await Promise.resolve()
        expect(log).toHaveBeenCalledExactlyOnceWith(
          "[TabStore] listOpenedTabs failed:",
          error
        )
        expect(useTabStore.getState().tabsHydrated).toBe(true)
        expect(currentId()).toBe(outerA)
        expect(state().tabs.find((tab) => tab.id === outerA)?.scopeId).toBe(
          blank ? null : 1
        )
        expect(useWorkbenchStore.getState().activeScopeId).toBe(1)
        expect(useAppWorkspaceStore.getState().activeFolderId).toBe(1)
        expect(useTabStore.getState().activeTabId).toBe("new-a")
        const b = useWorkbenchStore.getState().workspaces["2"]
        expect(b.lastConversationTabId).toBe("new-b")
        expect(b.groupSelection[b.focusedGroupId]).toBe("new-b")
        state().createEmptyTab()
        state().openWorktree(2)
        expect(useTabStore.getState().activeTabId).toBe("new-b")
      } finally {
        cancel()
        log.mockRestore()
      }
    }
  )

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
