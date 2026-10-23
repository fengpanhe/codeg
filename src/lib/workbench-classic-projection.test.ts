import {
  classicGroup,
  classicSelectedTabId,
  classicTabRefs,
} from "./workbench-classic-projection"
import {
  __resetWorkbenchStoreForTests,
  useWorkbenchStore,
} from "@/stores/workbench-store"

it("projects visible classic strips without including hidden group tabs or changing layout", () => {
  __resetWorkbenchStoreForTests()
  const store = useWorkbenchStore.getState()
  store.openTab(1, { id: "chat", entityId: "chat", type: "conversation" })
  store.openTab(1, { id: "hidden-file", entityId: "hidden-file", type: "file" })
  const first = useWorkbenchStore.getState().workspaces["1"].focusedGroupId
  const second = store.split(1, first, "right")
  store.openTab(
    1,
    { id: "shown-file", entityId: "shown-file", type: "file" },
    { groupId: second }
  )
  const ws = useWorkbenchStore.getState().workspaces["1"]
  const before = JSON.stringify(ws)
  expect(classicGroup(ws, "conversation")).toBe(first)
  expect(classicTabRefs(ws, "conversation").map((tab) => tab.id)).toEqual([
    "chat",
  ])
  expect(classicTabRefs(ws, "files").map((tab) => tab.id)).toEqual([
    "shown-file",
  ])
  expect(classicSelectedTabId(ws, "conversation")).toBe("chat")
  expect(classicSelectedTabId(ws, "files")).toBe("shown-file")
  expect(JSON.stringify(ws)).toBe(before)
})
