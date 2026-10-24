import { act, render, screen } from "@testing-library/react"
import { StatusBar } from "./status-bar"
import {
  useWorkbenchStore,
  __resetWorkbenchStoreForTests,
} from "@/stores/workbench-store"
import {
  useWorktreeTabsStore,
  __resetWorktreeTabsStoreForTests,
} from "@/stores/worktree-tabs-store"
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))
vi.mock("./status-bar-stats", () => ({ StatusBarStats: () => null }))
vi.mock("./status-bar-tasks", () => ({ StatusBarTasks: () => null }))
vi.mock("./status-bar-alerts", () => ({ StatusBarAlerts: () => null }))
vi.mock("./status-bar-mcp", () => ({ StatusBarMcp: () => null }))
vi.mock("./status-bar-computer", () => ({ StatusBarComputer: () => null }))
vi.mock("./status-bar-update", () => ({ StatusBarUpdate: () => null }))
vi.mock("./command-dropdown", () => ({
  CommandDropdown: () => <button>project-command</button>,
}))
vi.mock("./quick-actions-dropdown", () => ({
  QuickActionsDropdown: () => <button>global-actions</button>,
}))
it("keeps global footer actions and mode switch while hiding project commands on a blank", () => {
  localStorage.clear()
  __resetWorkbenchStoreForTests()
  __resetWorktreeTabsStoreForTests()
  useWorkbenchStore.getState().setUiMode("unified")
  useWorktreeTabsStore.getState().createEmptyTab()
  render(<StatusBar />)
  expect(screen.queryByText("project-command")).toBeNull()
  expect(screen.getByText("global-actions")).toBeVisible()
  expect(screen.getByRole("group", { name: "interfaceMode" })).toBeVisible()
  act(() => useWorktreeTabsStore.getState().openWorktree(1))
  expect(screen.getByText("project-command")).toBeVisible()
  act(() => useWorktreeTabsStore.getState().createEmptyTab())
  act(() => useWorkbenchStore.getState().setUiMode("classic"))
  expect(screen.getByText("project-command")).toBeVisible()
})
