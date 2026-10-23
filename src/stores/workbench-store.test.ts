import { beforeEach, describe, expect, it } from "vitest"
import { firstLeafId, leafIds } from "@/lib/tab-group-layout"
import {
  sanitizePersistedWorkbenchState,
  workbenchStorageKey,
} from "@/lib/workbench-persistence"
import { scopeKey } from "@/types/workbench"
import {
  __resetWorkbenchStoreForTests,
  getActiveWorkspace,
  groupOfWorkbenchTab,
  selectActiveWorkbenchTab,
  useWorkbenchStore,
} from "./workbench-store"

function state() {
  return useWorkbenchStore.getState()
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  __resetWorkbenchStoreForTests()
})

describe("workbench store", () => {
  it("keeps tab refs, active scope, and right panel state isolated by scope", () => {
    state().hydrate()
    state().openTab(1, { id: "c1", type: "conversation", entityId: "c1" })
    state().patchRightPanel(1, {
      isOpen: false,
      width: 380,
      fileTreeFocusedPath: "src/a.ts",
    })
    state().openTab(2, { id: "c2", type: "conversation", entityId: "c2" })

    expect(state().workspaces["1"].classicRatio).toBe(0.56)
    expect(state().activeScopeId).toBe(2)
    expect(state().workspaces["1"].tabRefs.map((tab) => tab.id)).toEqual(["c1"])
    expect(state().workspaces["2"].tabRefs.map((tab) => tab.id)).toEqual(["c2"])
    expect(state().workspaces["1"].rightPanelState).toMatchObject({
      isOpen: false,
      width: 380,
      fileTreeFocusedPath: "src/a.ts",
    })
    expect(state().workspaces["2"].rightPanelState).toMatchObject({
      isOpen: false,
      width: 320,
      activeTab: "session_details",
      fileTreeFocusedPath: null,
    })
  })

  it("supports mixed split groups, moving tabs, and partition reordering", () => {
    state().hydrate()
    state().openTab(1, { id: "c1", type: "conversation", entityId: "c1" })
    const root = firstLeafId(state().workspaces["1"].groupLayout)
    state().openTab(1, { id: "f1", type: "file", entityId: "file:/a" })
    state().openTab(1, { id: "f2", type: "file", entityId: "file:/b" })
    const right = state().split(1, root, "right")
    state().moveTab(1, "f1", right, 0)

    let workspace = state().workspaces["1"]
    expect(leafIds(workspace.groupLayout)).toEqual([root, right])
    expect(groupOfWorkbenchTab(workspace, "f1")).toBe(right)
    expect(selectActiveWorkbenchTab(state())?.id).toBe("f1")

    state().moveTab(1, "f2", right, 1)
    state().reorderGroupTabs(1, right, ["f2", "f1"])
    workspace = state().workspaces["1"]
    expect(workspace.tabRefs.map((tab) => tab.id)).toEqual(["c1", "f2", "f1"])
  })

  it("reconciles conversations without forcing focus away from active file tabs", () => {
    state().hydrate()
    state().openTab(1, { id: "c1", type: "conversation", entityId: "c1" })
    state().openTab(1, { id: "f1", type: "file", entityId: "file:/a" })

    state().reconcileConversations([{ id: "c1", folderId: 1 }], "c1", true)

    expect(selectActiveWorkbenchTab(state())?.id).toBe("f1")
    expect(state().workspaces["1"].lastConversationTabId).toBe("c1")
    expect(state().workspaces["1"].lastFileTabId).toBe("f1")
  })

  it("preserves mixed manual order through passive reconciliation and hydration", () => {
    state().hydrate()
    state().openTab(1, { id: "c1", type: "conversation", entityId: "c1" })
    state().openTab(1, { id: "c2", type: "conversation", entityId: "c2" })
    state().openTab(1, { id: "f1", type: "file", entityId: "file:/a" })
    const group = firstLeafId(state().workspaces["1"].groupLayout)
    state().reorderGroupTabs(1, group, ["f1", "c2", "c1"])
    const incoming = [
      { id: "c1", folderId: 1 },
      { id: "c2", folderId: 1 },
    ]
    for (const known of [false, true, true]) {
      state().reconcileConversations(incoming, "c1", known)
      expect(state().workspaces["1"].tabRefs.map((ref) => ref.id)).toEqual([
        "f1",
        "c2",
        "c1",
      ])
    }
    __resetWorkbenchStoreForTests()
    state().hydrate()
    state().reconcileConversations(incoming, "c2", true)
    expect(state().workspaces["1"].tabRefs.map((ref) => ref.id)).toEqual([
      "f1",
      "c2",
      "c1",
    ])
    state().reconcileConversations(
      [
        { id: "c2", folderId: 1 },
        { id: "c3", folderId: 1 },
      ],
      "c2",
      true
    )
    expect(state().workspaces["1"].tabRefs.map((ref) => ref.id)).toEqual([
      "f1",
      "c2",
      "c3",
    ])
  })

  it("preserves unhydrated refs and layout when conversation snapshot is unknown", () => {
    state().hydrate()
    state().openTab(1, { id: "c1", type: "conversation", entityId: "c1" })
    state().openTab(1, { id: "f1", type: "file", entityId: "file:/a" })
    const root = firstLeafId(state().workspaces["1"].groupLayout)
    const right = state().split(1, root, "right")
    state().moveTab(1, "f1", right)

    state().reconcileConversations([], null, false)

    const workspace = state().workspaces["1"]
    expect(workspace.tabRefs.map((tab) => tab.id)).toEqual(["c1", "f1"])
    expect(leafIds(workspace.groupLayout)).toEqual([root, right])
    expect(groupOfWorkbenchTab(workspace, "f1")).toBe(right)
  })

  it("preserves scopes for unconfirmed prune lists and detaches with authority", () => {
    state().hydrate()
    state().openTab(7, { id: "c7", type: "conversation", entityId: "c7" })
    state().openTab(7, { id: "f7", type: "file", entityId: "file:/w7/a" })

    state().pruneScopes([])

    expect(state().workspaces["7"].tabRefs.map((tab) => tab.id)).toEqual([
      "c7",
      "f7",
    ])

    state().pruneScopes([], { authoritative: true })

    expect(state().workspaces["7"]).toBeUndefined()
    expect(state().activeScopeId).toBe("global")
    expect(state().workspaces.global.tabRefs.map((tab) => tab.id)).toEqual([
      "c7",
      "f7",
    ])
  })

  it("opens into a target group using group-local indexes", () => {
    state().hydrate()
    state().openTab(1, { id: "a", type: "conversation", entityId: "a" })
    state().openTab(1, { id: "b", type: "conversation", entityId: "b" })
    const root = firstLeafId(state().workspaces["1"].groupLayout)
    const right = state().split(1, root, "right")
    state().moveTab(1, "b", right)

    state().openTab(
      1,
      { id: "c", type: "file", entityId: "file:/c" },
      { groupId: right, index: 0 }
    )

    const workspace = state().workspaces["1"]
    expect(workspace.tabRefs.map((tab) => tab.id)).toEqual(["a", "c", "b"])
    expect(groupOfWorkbenchTab(workspace, "c")).toBe(right)
    expect(groupOfWorkbenchTab(workspace, "a")).toBe(root)
  })

  it("imports legacy conversation group assignments by folder scope", () => {
    state().hydrate()
    state().reconcileConversations(
      [
        { id: "c1", folderId: 1 },
        { id: "c2", folderId: 2 },
      ],
      "c1",
      true,
      {
        groupLayout: {
          type: "split",
          id: "s-right",
          orientation: "horizontal",
          children: [
            { type: "group", id: "g-main" },
            { type: "group", id: "g-right" },
          ],
          ratios: [0.5, 0.5],
        },
        groupOf: { c1: "g-right", c2: "g-right" },
        groupSelection: { "g-right": "c1" },
        tileByGroup: { "g-right": true },
      }
    )

    expect(groupOfWorkbenchTab(state().workspaces["1"], "c1")).toBe("g-right")
    expect(state().workspaces["2"].tabRefs.map((tab) => tab.id)).toEqual(["c2"])
    expect(state().workspaces["2"].groupOf.c1).toBeUndefined()
  })

  it("falls back instead of crashing on corrupt nested legacy layouts", () => {
    state().hydrate()

    expect(() =>
      state().reconcileConversations([{ id: "c1", folderId: 1 }], "c1", true, {
        groupLayout: {
          type: "split",
          id: "s-corrupt",
          orientation: "horizontal",
          children: [
            { type: "definitely-not-a-layout" },
            { type: "group", id: "g-ok" },
          ],
          ratios: [0.5, 0.5],
        },
        groupOf: { c1: "g-ok" },
      })
    ).not.toThrow()

    const workspace = state().workspaces["1"]
    expect(workspace.groupLayout).toEqual({ type: "group", id: "g-main" })
    expect(workspace.groupOf).toEqual({ c1: "g-main" })
  })

  it("hydrates sanitized persisted state and ignores duplicate ids/deep layout", () => {
    const key = workbenchStorageKey()
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        activeScopeId: 1,
        uiMode: "unified",
        workspaces: {
          [scopeKey(1)]: {
            version: 1,
            scopeId: 1,
            tabRefs: [
              { id: "f1", type: "file", entityId: "file:/a" },
              { id: "f1", type: "file", entityId: "file:/dup" },
              { id: "bad", type: "unknown", entityId: "x" },
            ],
            groupLayout: {
              type: "split",
              id: "s-bad",
              orientation: "horizontal",
              children: [
                { type: "group", id: "g-main" },
                { type: "group", id: "g-main" },
              ],
              ratios: [0.5, 0.5],
            },
            groupOf: { f1: "missing" },
            groupSelection: { missing: "f1" },
            tileByGroup: { missing: true },
            focusedGroupId: "missing",
            rightPanelState: {
              isOpen: false,
              width: 9999,
              activeTab: "git",
              fileTreeExpandedPaths: ["a", "a", 42],
              git: {
                activeView: "log",
                selectedBranch: "main",
                selectedAuthor: "Ada",
                scrollTop: 12,
              },
            },
          },
        },
      })
    )

    state().hydrate()

    const workspace = getActiveWorkspace(state())
    expect(state().uiMode).toBe("unified")
    expect(workspace.tabRefs).toEqual([
      { id: "f1", type: "file", entityId: "file:/a" },
    ])
    expect(workspace.groupLayout).toEqual({ type: "group", id: "g-main" })
    expect(workspace.groupOf).toEqual({ f1: "g-main" })
    expect(workspace.rightPanelState.width).toBe(900)
    expect(workspace.rightPanelState.fileTreeExpandedPaths).toEqual(["a"])
    expect(workspace.rightPanelState.git.selectedBranch).toBe("main")
    expect(workspace.rightPanelState.git.selectedAuthor).toBe("Ada")
  })

  it("falls back on extremely deep persisted layouts without overflowing", () => {
    let deep: unknown = { type: "group", id: "g-leaf" }
    for (let i = 0; i < 20_000; i += 1) {
      deep = {
        type: "split",
        id: `s-${i}`,
        orientation: "horizontal",
        children: [deep, { type: "group", id: `g-${i}` }],
        ratios: [0.5, 0.5],
      }
    }

    expect(() =>
      sanitizePersistedWorkbenchState({
        version: 1,
        activeScopeId: 1,
        uiMode: "unified",
        workspaces: {
          [scopeKey(1)]: {
            version: 1,
            scopeId: 1,
            tabRefs: [{ id: "f1", type: "file", entityId: "file:/a" }],
            groupLayout: deep,
            groupOf: { f1: "g-leaf" },
            groupSelection: { "g-leaf": "f1" },
            tileByGroup: {},
            focusedGroupId: "g-leaf",
            rightPanelState: {},
          },
        },
      })
    ).not.toThrow()

    const parsed = sanitizePersistedWorkbenchState({
      version: 1,
      activeScopeId: 1,
      uiMode: "unified",
      workspaces: {
        [scopeKey(1)]: {
          version: 1,
          scopeId: 1,
          tabRefs: [{ id: "f1", type: "file", entityId: "file:/a" }],
          groupLayout: deep,
          groupOf: { f1: "g-leaf" },
          groupSelection: { "g-leaf": "f1" },
          tileByGroup: {},
          focusedGroupId: "g-leaf",
          rightPanelState: {},
        },
      },
    })

    expect(parsed?.workspaces["1"].groupLayout).toEqual({
      type: "group",
      id: "g-main",
    })
    expect(parsed?.workspaces["1"].groupOf).toEqual({ f1: "g-main" })
  })

  it("persists bound draft conversation layout under canonical ids", () => {
    state().hydrate()
    state().reconcileConversations(
      [
        {
          id: "new-runtime-1",
          folderId: 1,
          persistenceId: "conv-1-codex-42",
        },
      ],
      "new-runtime-1",
      true
    )
    const root = firstLeafId(state().workspaces["1"].groupLayout)
    const right = state().split(1, root, "right")
    state().moveTab(1, "new-runtime-1", right)

    expect(state().workspaces["1"].tabRefs.map((tab) => tab.id)).toEqual([
      "new-runtime-1",
    ])
    expect(state().workspaces["1"].groupOf["new-runtime-1"]).toBe(right)

    state().openTab(
      1,
      { id: "f1", type: "file", entityId: "file:/a" },
      { groupId: root, background: true }
    )

    type PersistedWorkspaceSlice = {
      tabRefs: Array<{ id: string; entityId: string; type: string }>
      groupOf: Record<string, string>
      groupSelection: Record<string, string>
      lastConversationTabId: string | null
    }
    const raw = localStorage.getItem(workbenchStorageKey())
    expect(raw).toBeTruthy()
    const persisted = JSON.parse(raw as string) as {
      workspaces: Record<string, PersistedWorkspaceSlice>
    }
    expect(persisted.workspaces["1"].tabRefs).toEqual([
      {
        id: "conv-1-codex-42",
        type: "conversation",
        entityId: "conv-1-codex-42",
      },
      { id: "f1", type: "file", entityId: "file:/a" },
    ])
    expect(persisted.workspaces["1"].groupOf["conv-1-codex-42"]).toBe(right)
    expect(persisted.workspaces["1"].groupOf["new-runtime-1"]).toBeUndefined()
    expect(persisted.workspaces["1"].groupSelection[right]).toBe(
      "conv-1-codex-42"
    )
    expect(persisted.workspaces["1"].lastConversationTabId).toBe(
      "conv-1-codex-42"
    )

    __resetWorkbenchStoreForTests()
    state().hydrate()
    state().reconcileConversations(
      [
        {
          id: "conv-1-codex-42",
          folderId: 1,
          persistenceId: "conv-1-codex-42",
        },
      ],
      "conv-1-codex-42",
      true
    )

    expect(state().workspaces["1"].groupOf["conv-1-codex-42"]).toBe(right)
    expect(state().workspaces["1"].groupSelection[right]).toBe(
      "conv-1-codex-42"
    )
  })

  it("filters browser refs from persisted snapshots while keeping core refs", () => {
    state().hydrate()
    const root = "g-main"
    state().openTab(1, { id: "c1", type: "conversation", entityId: "c1" })
    state().openTab(1, { id: "f1", type: "file", entityId: "file:/a" })
    state().openTab(1, { id: "d1", type: "diff", entityId: "diff:/a" })
    const right = state().split(1, root, "right")
    state().openTab(
      1,
      { id: "b1", type: "browser", entityId: "browser-session-old" },
      { groupId: right }
    )

    expect(state().workspaces["1"].tabRefs.map((tab) => tab.id)).toEqual([
      "c1",
      "f1",
      "d1",
      "b1",
    ])

    const raw = localStorage.getItem(workbenchStorageKey())
    expect(raw).toBeTruthy()
    const persisted = JSON.parse(raw as string) as {
      workspaces: Record<
        string,
        {
          tabRefs: Array<{ id: string }>
          groupLayout: import("@/lib/tab-group-layout").LayoutNode
          groupOf: Record<string, string>
          groupSelection: Record<string, string>
        }
      >
    }
    expect(persisted.workspaces["1"].tabRefs.map((tab) => tab.id)).toEqual([
      "c1",
      "f1",
      "d1",
    ])
    expect(persisted.workspaces["1"].groupOf.b1).toBeUndefined()
    expect(leafIds(persisted.workspaces["1"].groupLayout as never)).toEqual([
      root,
      right,
    ])

    const parsed = sanitizePersistedWorkbenchState({
      version: 1,
      activeScopeId: 1,
      uiMode: "unified",
      workspaces: {
        [scopeKey(1)]: {
          version: 1,
          scopeId: 1,
          tabRefs: [
            { id: "c1", type: "conversation", entityId: "c1" },
            { id: "b1", type: "browser", entityId: "browser-session-old" },
            { id: "f1", type: "file", entityId: "file:/a" },
            { id: "d1", type: "diff", entityId: "diff:/a" },
          ],
          groupLayout: state().workspaces["1"].groupLayout,
          groupOf: { c1: root, b1: right, f1: root, d1: root },
          groupSelection: { [root]: "f1", [right]: "b1" },
          tileByGroup: {},
          focusedGroupId: right,
          lastFileTabId: "b1",
          rightPanelState: {},
        },
      },
    })

    expect(parsed?.workspaces["1"].tabRefs.map((tab) => tab.id)).toEqual([
      "c1",
      "f1",
      "d1",
    ])
    expect(parsed?.workspaces["1"].groupOf).toEqual({
      c1: root,
      f1: root,
      d1: root,
    })
    expect(parsed?.workspaces["1"].groupSelection).toEqual({ [root]: "f1" })
    expect(parsed?.workspaces["1"].focusedGroupId).toBe(right)
    expect(parsed?.workspaces["1"].lastFileTabId).toBeNull()
  })

  it.each([{ version: 2, workspaces: {} }, { version: 1 }, ["invalid"]])(
    "retains rejected valid JSON snapshots after UI actions: %j",
    (snapshot) => {
      const key = workbenchStorageKey()
      const raw = JSON.stringify(snapshot)
      localStorage.setItem(key, raw)
      state().hydrate()
      state().activateScope(2)
      state().openTab(2, { id: "c1", type: "conversation", entityId: "c1" })
      state().patchRightPanel(2, { isOpen: true })
      expect(localStorage.getItem(key)).toBe(raw)
    }
  )

  it("writes a new snapshot when storage genuinely has no cache", () => {
    const key = workbenchStorageKey()
    state().hydrate()
    state().activateScope(2)
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
      version: 1,
      activeScopeId: 2,
    })
  })

  it("does not overwrite good persisted state after failed hydration", () => {
    const key = workbenchStorageKey()
    localStorage.setItem(key, "{not-json")

    state().hydrate()
    state().openTab(1, { id: "c1", type: "conversation", entityId: "c1" })

    expect(localStorage.getItem(key)).toBe("{not-json")
  })
})
