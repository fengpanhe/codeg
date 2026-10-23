import {
  popClosedTab,
  pushClosedTab,
  resetClosedTabStackForTests,
  snapshotFileTab,
} from "./closed-tab-stack"
import {
  __resetWorkbenchStoreForTests,
  useWorkbenchStore,
} from "@/stores/workbench-store"

beforeEach(() => {
  resetClosedTabStackForTests()
  __resetWorkbenchStoreForTests()
})

it("records the worktree and group-local slot for a file in a mixed group", () => {
  const store = useWorkbenchStore.getState()
  store.openTab(1, { id: "first", entityId: "first", type: "conversation" })
  const first = useWorkbenchStore.getState().workspaces["1"].focusedGroupId
  const second = store.split(1, first, "right")
  store.openTab(
    1,
    { id: "chat", entityId: "chat", type: "conversation" },
    { groupId: second }
  )
  store.openTab(
    1,
    { id: "file:/a", entityId: "file:/a", type: "file" },
    { groupId: second }
  )
  const snapshot = snapshotFileTab(
    { id: "file:/a", kind: "file", path: "/a", folderId: null },
    2
  )
  expect(snapshot).toMatchObject({
    scopeId: 1,
    groupId: second,
    groupIndex: 1,
    index: 2,
  })
})

it("keeps separate close records for one physical file referenced in two worktrees", () => {
  const store = useWorkbenchStore.getState()
  const ref = {
    id: "file:/shared",
    entityId: "file:/shared",
    type: "file" as const,
  }
  const entity = { id: ref.id, kind: "file", path: "/shared", folderId: null }
  store.openTab(1, ref)
  pushClosedTab(snapshotFileTab(entity, 0)!)
  store.closeTab(1, ref.id)
  store.openTab(2, ref)
  pushClosedTab(snapshotFileTab(entity, 0)!)
  expect(popClosedTab()?.scopeId).toBe(2)
  expect(popClosedTab()?.scopeId).toBe(1)
})
