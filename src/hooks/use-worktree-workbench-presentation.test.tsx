import { act, render, screen, waitFor } from "@testing-library/react"
import { useWorktreeWorkbenchPresentation } from "./use-worktree-workbench-presentation"
import {
  useWorkbenchStore,
  __resetWorkbenchStoreForTests,
} from "@/stores/workbench-store"
import {
  useWorktreeTabsStore,
  __resetWorktreeTabsStoreForTests,
} from "@/stores/worktree-tabs-store"
import { worktreeTabsStorageKey } from "@/lib/worktree-tabs-persistence"
function Probe() {
  const { isEmptyWorkbench, activeOuterScopeId } =
    useWorktreeWorkbenchPresentation()
  return (
    <output data-testid="presentation">
      {String(isEmptyWorkbench)}:{String(activeOuterScopeId)}
    </output>
  )
}
beforeEach(() => {
  localStorage.clear()
  __resetWorkbenchStoreForTests()
  __resetWorktreeTabsStoreForTests()
})
it("treats missing/blank outer scope as empty only in new mode and global as concrete", () => {
  render(<Probe />)
  expect(screen.getByTestId("presentation")).toHaveTextContent("false:null")
  act(() => useWorkbenchStore.getState().setUiMode("unified"))
  expect(screen.getByTestId("presentation")).toHaveTextContent("true:null")
  act(() => useWorktreeTabsStore.getState().openWorktree("global"))
  expect(screen.getByTestId("presentation")).toHaveTextContent("false:global")
  act(() => useWorktreeTabsStore.getState().createEmptyTab())
  expect(screen.getByTestId("presentation")).toHaveTextContent("true:null")
  expect(useWorkbenchStore.getState().activeScopeId).toBe("global")
})
it("hydrates again when a backend reset clears hydrated", async () => {
  render(<Probe />)
  expect(useWorktreeTabsStore.getState().hydrated).toBe(true)
  localStorage.setItem(
    worktreeTabsStorageKey(),
    JSON.stringify({
      version: 1,
      tabs: [{ id: "restored", scopeId: 7, isPinned: true }],
      activeTabId: "restored",
    })
  )
  act(() => __resetWorktreeTabsStoreForTests())
  await waitFor(() =>
    expect(screen.getByTestId("presentation")).toHaveTextContent("false:7")
  )
  expect(useWorktreeTabsStore.getState().hydrated).toBe(true)
})
