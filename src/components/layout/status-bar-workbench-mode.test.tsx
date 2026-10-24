import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  __resetWorkbenchStoreForTests,
  useWorkbenchStore,
} from "@/stores/workbench-store"
import { StatusBarWorkbenchMode } from "./status-bar-workbench-mode"

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))

it("switches and restores the selected interface from the existing status bar", () => {
  localStorage.clear()
  __resetWorkbenchStoreForTests()
  useWorkbenchStore.getState().hydrate()
  render(<StatusBarWorkbenchMode />)
  expect(screen.getByRole("switch", { name: "workbench" })).toHaveAttribute(
    "aria-checked",
    "false"
  )
  expect(screen.getAllByRole("switch")).toHaveLength(1)
  expect(screen.queryByRole("button", { name: "classic" })).toBeNull()
  fireEvent.click(screen.getByRole("switch", { name: "workbench" }))
  expect(screen.getByRole("switch", { name: "workbench" })).toHaveAttribute(
    "aria-checked",
    "true"
  )
  act(() => {
    __resetWorkbenchStoreForTests()
    useWorkbenchStore.getState().hydrate()
  })
  expect(useWorkbenchStore.getState().uiMode).toBe("unified")
  fireEvent.click(screen.getByRole("switch", { name: "workbench" }))
  expect(useWorkbenchStore.getState().uiMode).toBe("classic")
})

it("places the switch in both status bar variants without a new top toolbar", () => {
  const read = (path: string) =>
    readFileSync(resolve(process.cwd(), path), "utf8")
  const status = read("src/components/layout/status-bar.tsx")
  const surface = read("src/components/workbench/workbench-surface.tsx")
  expect(status.match(/<StatusBarWorkbenchMode \/>/g)).toHaveLength(2)
  expect(surface).not.toContain('t("interfaceMode")')
  expect(surface).not.toContain("setUiMode(")
})

it("toggles through its label and keyboard without adding another mode button", async () => {
  localStorage.clear()
  __resetWorkbenchStoreForTests()
  useWorkbenchStore.getState().hydrate()
  const user = userEvent.setup()
  render(<StatusBarWorkbenchMode />)
  const toggle = screen.getByRole("switch", { name: "workbench" })
  await user.click(screen.getByText("workbench"))
  expect(toggle).toBeChecked()
  act(() => toggle.focus())
  await user.keyboard(" ")
  expect(toggle).not.toBeChecked()
  expect(useWorkbenchStore.getState().uiMode).toBe("classic")
})
