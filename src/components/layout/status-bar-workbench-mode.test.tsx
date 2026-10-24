import { act, fireEvent, render, screen } from "@testing-library/react"
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
  expect(screen.getByRole("button", { name: "classic" })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  fireEvent.click(screen.getByRole("button", { name: "unified" }))
  expect(screen.getByRole("button", { name: "unified" })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  act(() => {
    __resetWorkbenchStoreForTests()
    useWorkbenchStore.getState().hydrate()
  })
  expect(useWorkbenchStore.getState().uiMode).toBe("unified")
  fireEvent.click(screen.getByRole("button", { name: "classic" }))
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
