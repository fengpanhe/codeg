import { act, fireEvent, render, screen } from "@testing-library/react"
import { WorkbenchProjectSidebar } from "./workbench-project-sidebar"
import {
  useWorkbenchStore,
  __resetWorkbenchStoreForTests,
} from "@/stores/workbench-store"
import {
  useWorktreeTabsStore,
  __resetWorktreeTabsStoreForTests,
} from "@/stores/worktree-tabs-store"
import {
  useAppWorkspaceStore,
  resetAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import { MAX_WORKTREE_TABS } from "@/lib/worktree-tabs-persistence"
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/contexts/sidebar-context", () => ({
  useSidebarContext: () => ({ isOpen: true, toggle: vi.fn() }),
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({ openConversations: vi.fn() }),
}))
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))
vi.mock("@/hooks/use-platform", () => ({
  usePlatform: () => ({ isMac: false }),
}))
vi.mock("@/hooks/use-appearance", () => ({
  useZoomLevel: () => ({ zoomLevel: 100 }),
}))
vi.mock("@/components/layout/new-folder-dropdown", () => ({
  NewFolderDropdown: () => <button>open-folder</button>,
}))
beforeEach(() => {
  localStorage.clear()
  __resetWorkbenchStoreForTests()
  __resetWorktreeTabsStoreForTests()
  resetAppWorkspaceStore()
  const folders = [
    { id: 1, name: "app", path: "/app", parent_id: null, kind: "project" },
    {
      id: 2,
      name: "feature",
      path: "/feature",
      parent_id: 1,
      kind: "worktree",
    },
  ]
  useAppWorkspaceStore.setState({
    folders: folders as never,
    allFolders: [
      ...folders,
      { id: 3, name: "closed", parent_id: null },
      { id: 4, name: "chat", kind: "chat" },
    ] as never,
  })
  useWorkbenchStore.getState().setUiMode("unified")
})
it("shows only open folder families and add/open actions", () => {
  render(<WorkbenchProjectSidebar />)
  expect(screen.getByRole("button", { name: "app-root" })).toBeVisible()
  expect(screen.getByRole("button", { name: "app-feature" })).toBeVisible()
  expect(screen.queryByRole("button", { name: "closed-root" })).toBeNull()
  expect(screen.queryByRole("button", { name: "chat-root" })).toBeNull()
  expect(screen.getByRole("button", { name: "open-folder" })).toBeVisible()
})
it("fills blank on navigation, selects existing entry first, and clears highlight on +", () => {
  useWorktreeTabsStore.getState().openWorktree(1)
  const rootId = useWorktreeTabsStore.getState().activeTabId
  useWorktreeTabsStore.getState().createEmptyTab()
  render(<WorkbenchProjectSidebar />)
  const root = screen.getByRole("button", { name: "app-root" })
  expect(root).not.toHaveAttribute("aria-current")
  fireEvent.click(root)
  expect(useWorktreeTabsStore.getState().activeTabId).toBe(rootId)
  expect(root).toHaveAttribute("aria-current", "page")
  act(() => useWorktreeTabsStore.getState().createEmptyTab())
  expect(root).not.toHaveAttribute("aria-current")
  fireEvent.click(screen.getByRole("button", { name: "app-feature" }))
  expect(useWorkbenchStore.getState().activeScopeId).toBe(2)
})
it("reports capacity refusal without switching retained inner scope", () => {
  useWorkbenchStore.getState().activateScope(1)
  useWorktreeTabsStore.setState({
    tabs: Array.from({ length: MAX_WORKTREE_TABS }, (_, index) => ({
      id: String(index),
      scopeId: index === 0 ? 1 : null,
      isPinned: true,
    })),
    activeTabId: "0",
    hydrated: true,
  })
  render(<WorkbenchProjectSidebar />)
  fireEvent.click(screen.getByRole("button", { name: "app-feature" }))
  expect(screen.getByRole("alert")).toHaveTextContent("capacity")
  expect(useWorkbenchStore.getState().activeScopeId).toBe(1)
})
