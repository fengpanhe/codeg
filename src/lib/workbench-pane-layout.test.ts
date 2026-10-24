import { leafIds, computeRects } from "@/lib/tab-group-layout"
import {
  __resetWorkbenchStoreForTests,
  useWorkbenchStore,
} from "@/stores/workbench-store"
import {
  workbenchPaneLayout,
  workbenchPaneGroup,
  paneSelectedTabId,
} from "./workbench-pane-layout"

beforeEach(() => {
  localStorage.clear()
  __resetWorkbenchStoreForTests()
  useWorkbenchStore.getState().hydrate()
})

it("keeps an editor split out of the conversation layout, including empty splits and restart", () => {
  const store = useWorkbenchStore.getState()
  store.openTab(1, { id: "chat", entityId: "chat", type: "conversation" })
  store.openTab(1, { id: "file", entityId: "file", type: "file" })
  const root = store.workspaces["1"]?.focusedGroupId ?? "g-main"
  const empty = store.split(1, root, "right", "files")
  let ws = useWorkbenchStore.getState().workspaces["1"]
  expect(leafIds(workbenchPaneLayout(ws, "conversation"))).toEqual([root])
  expect(leafIds(workbenchPaneLayout(ws, "files"))).toEqual([root, empty])
  __resetWorkbenchStoreForTests()
  useWorkbenchStore.getState().hydrate()
  ws = useWorkbenchStore.getState().workspaces["1"]
  expect(leafIds(workbenchPaneLayout(ws, "files"))).toEqual([root, empty])
  expect(workbenchPaneGroup(ws, "files")).toBe(empty)
})

it("remembers independent pane widths for legacy mixed groups and after restart", () => {
  const store = useWorkbenchStore.getState()
  const root = "g-main"
  store.openTab(1, { id: "c1", entityId: "c1", type: "conversation" })
  store.openTab(1, { id: "f1", entityId: "f1", type: "file" })
  const other = store.split(1, root, "right", "conversation")
  store.openTab(
    1,
    { id: "c2", entityId: "c2", type: "conversation" },
    { groupId: other }
  )
  store.openTab(
    1,
    { id: "f2", entityId: "f2", type: "file" },
    { groupId: other }
  )
  const split = useWorkbenchStore.getState().workspaces["1"].groupLayout
  if (split.type !== "split") throw new Error("Expected a split")
  store.resizePaneSplit(1, "conversation", split.id, 0, 0.7)
  let ws = useWorkbenchStore.getState().workspaces["1"]
  expect(
    computeRects(workbenchPaneLayout(ws, "conversation")).groups.get(root)?.w
  ).toBeCloseTo(70)
  expect(
    computeRects(workbenchPaneLayout(ws, "files")).groups.get(root)?.w
  ).toBeCloseTo(50)
  __resetWorkbenchStoreForTests()
  useWorkbenchStore.getState().hydrate()
  ws = useWorkbenchStore.getState().workspaces["1"]
  expect(
    computeRects(workbenchPaneLayout(ws, "conversation")).groups.get(root)?.w
  ).toBeCloseTo(70)
  expect(
    computeRects(workbenchPaneLayout(ws, "files")).groups.get(root)?.w
  ).toBeCloseTo(50)
})

it("opens new tabs in their pane's remembered group even when the other pane is focused", () => {
  const store = useWorkbenchStore.getState()
  store.openTab(1, { id: "chat", entityId: "chat", type: "conversation" })
  const files = store.split(1, "g-main", "right", "files")
  store.openTab(
    1,
    { id: "file", entityId: "file", type: "file" },
    { groupId: files }
  )
  store.activateTab(1, "chat")
  store.openTab(1, { id: "new-file", entityId: "new-file", type: "file" })
  store.openTab(1, {
    id: "new-chat",
    entityId: "new-chat",
    type: "conversation",
  })
  const ws = useWorkbenchStore.getState().workspaces["1"]
  expect(ws.groupOf["new-file"]).toBe(files)
  expect(ws.groupOf["new-chat"]).toBe("g-main")
})

it("retains each group's conversation selection while editor tabs are selected elsewhere", () => {
  const store = useWorkbenchStore.getState()
  const root = "g-main"
  store.openTab(1, { id: "c1", entityId: "c1", type: "conversation" })
  store.openTab(1, { id: "c2", entityId: "c2", type: "conversation" })
  const other = store.split(1, root, "right", "conversation")
  store.openTab(
    1,
    { id: "c3", entityId: "c3", type: "conversation" },
    { groupId: other }
  )
  store.openTab(
    1,
    { id: "c4", entityId: "c4", type: "conversation" },
    { groupId: other }
  )
  store.openTab(
    1,
    { id: "f1", entityId: "f1", type: "file" },
    { groupId: root }
  )
  let ws = useWorkbenchStore.getState().workspaces["1"]
  expect(paneSelectedTabId(ws, "conversation", root)).toBe("c2")
  expect(paneSelectedTabId(ws, "conversation", other)).toBe("c4")
  __resetWorkbenchStoreForTests()
  useWorkbenchStore.getState().hydrate()
  ws = useWorkbenchStore.getState().workspaces["1"]
  expect(paneSelectedTabId(ws, "conversation", root)).toBe("c2")
  expect(paneSelectedTabId(ws, "conversation", other)).toBe("c4")
})

it("preserves conversation geometry when splitting or merging the editor beside mixed legacy groups", () => {
  const store = useWorkbenchStore.getState()
  const root = "g-main"
  store.openTab(1, { id: "c1", entityId: "c1", type: "conversation" })
  store.openTab(1, { id: "f1", entityId: "f1", type: "file" })
  const other = store.split(1, root, "right", "conversation")
  store.openTab(
    1,
    { id: "c2", entityId: "c2", type: "conversation" },
    { groupId: other }
  )
  let ws = useWorkbenchStore.getState().workspaces["1"]
  const before = computeRects(workbenchPaneLayout(ws, "conversation"))
  const editor = store.split(1, root, "right", "files")
  store.openTab(
    1,
    { id: "f2", entityId: "f2", type: "file" },
    { groupId: editor }
  )
  ws = useWorkbenchStore.getState().workspaces["1"]
  expect(computeRects(workbenchPaneLayout(ws, "conversation"))).toEqual(before)
  store.unsplitAll(1, "files")
  ws = useWorkbenchStore.getState().workspaces["1"]
  expect(computeRects(workbenchPaneLayout(ws, "conversation"))).toEqual(before)
  expect(ws.groupOf.c2).toBe(other)
  expect(leafIds(workbenchPaneLayout(ws, "files"))).toEqual([root])
})

it("merges only one pane when both share a legacy group", () => {
  const store = useWorkbenchStore.getState()
  store.openTab(1, { id: "c1", entityId: "c1", type: "conversation" })
  store.openTab(1, { id: "f1", entityId: "f1", type: "file" })
  const other = store.split(1, "g-main", "down", "conversation")
  store.openTab(
    1,
    { id: "c2", entityId: "c2", type: "conversation" },
    { groupId: other }
  )
  store.openTab(
    1,
    { id: "f2", entityId: "f2", type: "file" },
    { groupId: other }
  )
  const before = workbenchPaneLayout(
    useWorkbenchStore.getState().workspaces["1"],
    "files"
  )
  store.dissolveGroup(1, other, "conversation")
  const ws = useWorkbenchStore.getState().workspaces["1"]
  expect(ws.groupOf.c2).toBe("g-main")
  expect(ws.groupOf.f2).toBe(other)
  expect(workbenchPaneLayout(ws, "files")).toEqual(before)
})
