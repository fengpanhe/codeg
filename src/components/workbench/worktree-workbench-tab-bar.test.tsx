import { act, fireEvent, render, screen } from "@testing-library/react"
import {
  useWorkbenchStore,
  __resetWorkbenchStoreForTests,
} from "@/stores/workbench-store"
import {
  useWorktreeTabsStore,
  __resetWorktreeTabsStoreForTests,
} from "@/stores/worktree-tabs-store"
import { MAX_WORKTREE_TABS } from "@/lib/worktree-tabs-persistence"
import { WorktreeWorkbenchTabBar } from "./worktree-workbench-tab-bar"
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        allFolders: [
          { id: 1, name: "project", parent_id: null },
          { id: 2, name: "branch", parent_id: 1 },
        ],
      }),
    { getState: () => ({ setActiveFolderId: vi.fn() }) }
  ),
}))
beforeEach(() => {
  localStorage.clear()
  __resetWorkbenchStoreForTests()
  __resetWorktreeTabsStoreForTests()
  useWorktreeTabsStore.getState().hydrate()
})
it("renders pin prefix, all temporary entries and explicit pin/close controls", () => {
  const store = useWorktreeTabsStore.getState()
  store.openWorktree(1)
  store.setPinned(useWorktreeTabsStore.getState().activeTabId!, true)
  store.openWorktree(2)
  store.createEmptyTab()
  store.createEmptyTab()
  render(<WorktreeWorkbenchTabBar />)
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "project-root",
    "project-branch",
    "emptyTab",
    "emptyTab",
  ])
  expect(screen.getByText("pinned")).toBeVisible()
  fireEvent.click(screen.getByRole("button", { name: "unpin project-root" }))
  expect(useWorktreeTabsStore.getState().tabs).toHaveLength(4)
  expect(
    useWorktreeTabsStore.getState().tabs.every((tab) => !tab.isPinned)
  ).toBe(true)
})
it("+ preserves inner scope and existing lookup wins over filling blank", () => {
  useWorktreeTabsStore.getState().openWorktree(1)
  render(<WorktreeWorkbenchTabBar />)
  fireEvent.click(screen.getByRole("button", { name: "newTab" }))
  expect(useWorkbenchStore.getState().activeScopeId).toBe(1)
  const blank = useWorktreeTabsStore.getState().activeTabId
  fireEvent.click(screen.getByRole("tab", { name: "project-root" }))
  expect(useWorktreeTabsStore.getState().activeTabId).not.toBe(blank)
  expect(
    useWorktreeTabsStore.getState().tabs.find((tab) => tab.id === blank)
      ?.scopeId
  ).toBeNull()
})
it("disables append at capacity while retaining activation and unpin", () => {
  act(() =>
    useWorktreeTabsStore.setState({
      tabs: Array.from({ length: MAX_WORKTREE_TABS }, (_, i) => ({
        id: `cap-${i}`,
        scopeId: i === 0 ? 1 : null,
        isPinned: i === 0,
      })),
      activeTabId: "cap-0",
    })
  )
  render(<WorktreeWorkbenchTabBar />)
  expect(screen.getByRole("button", { name: "newTab" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "newTab" })).toHaveAttribute(
    "title",
    "capacity"
  )
}, 30000)
