import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { workbenchStorageKey } from "@/lib/workbench-persistence"
import {
  __resetWorkbenchStoreForTests,
  useWorkbenchStore,
} from "@/stores/workbench-store"

import { AuxPanelProvider, useAuxPanelContext } from "./aux-panel-context"

vi.mock("@/hooks/use-platform", () => ({
  detectPlatform: () => "macos",
}))
vi.mock("@/lib/platform", () => ({
  isDesktop: () => false,
}))

function state() {
  return useWorkbenchStore.getState()
}

function Harness() {
  const ctx = useAuxPanelContext()
  return (
    <div>
      <div data-testid="scope">{String(ctx.activeScopeId)}</div>
      <div data-testid="open">{String(ctx.isOpen)}</div>
      <div data-testid="restored">{String(ctx.restored)}</div>
      <div data-testid="tab">{ctx.activeTab}</div>
      <div data-testid="pending">{ctx.pendingRevealPath ?? "none"}</div>
      <div data-testid="focused">{ctx.fileTreeFocusedPath ?? "none"}</div>
      <button onClick={() => ctx.revealInFileTree("src/a.ts")}>reveal</button>
      <button
        onClick={() =>
          ctx.patchFileTreeState(ctx.activeScopeId, {
            fileTreeFocusedPath: "src/focused.ts",
            fileTreeExpandedPaths: ["src"],
            fileTreeScrollTop: 42,
          })
        }
      >
        patch tree
      </button>
      <button
        onClick={() =>
          ctx.consumePendingRevealPath(ctx.activeScopeId, "src/a.ts")
        }
      >
        consume current
      </button>
    </div>
  )
}

function renderProvider() {
  return render(
    <AuxPanelProvider>
      <Harness />
    </AuxPanelProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  __resetWorkbenchStoreForTests()
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1024,
  })
})

describe("AuxPanelProvider scoped workbench state", () => {
  it("imports legacy right panel storage only after workbench hydration identifies an active scope", async () => {
    localStorage.setItem(
      "workspace:right-sidebar",
      JSON.stringify({ isOpen: true, width: 444 })
    )

    renderProvider()

    expect(screen.getByTestId("restored")).toHaveTextContent("false")
    expect(state().workspaces.global).toBeUndefined()

    act(() => {
      state().hydrate()
    })

    expect(screen.getByTestId("restored")).toHaveTextContent("false")

    act(() => {
      state().openTab(1, { id: "c1", type: "conversation", entityId: "c1" })
    })

    await waitFor(() => {
      expect(screen.getByTestId("restored")).toHaveTextContent("true")
    })
    expect(state().workspaces["1"].rightPanelState).toMatchObject({
      isOpen: true,
      width: 444,
      activeTab: "session_details",
    })
  })

  it("does not let legacy right panel storage overwrite an existing workbench cache", async () => {
    localStorage.setItem(
      "workspace:right-sidebar",
      JSON.stringify({ isOpen: true, width: 444 })
    )

    act(() => {
      state().hydrate()
      state().openTab(1, { id: "c1", type: "conversation", entityId: "c1" })
    })
    localStorage.setItem(workbenchStorageKey(), JSON.stringify({ version: 1 }))

    renderProvider()

    await waitFor(() => {
      expect(screen.getByTestId("restored")).toHaveTextContent("true")
    })
    expect(state().workspaces["1"].rightPanelState).toMatchObject({
      isOpen: false,
      width: 320,
      activeTab: "session_details",
    })
  })

  it("writes active right-panel actions and explicit file-tree patches to their owning scopes", async () => {
    const user = userEvent.setup()
    act(() => {
      state().hydrate()
      state().openTab(1, { id: "c1", type: "conversation", entityId: "c1" })
      state().openTab(2, { id: "c2", type: "conversation", entityId: "c2" })
      state().activateScope(1)
    })

    renderProvider()
    await waitFor(() => {
      expect(screen.getByTestId("restored")).toHaveTextContent("true")
    })

    await user.click(screen.getByRole("button", { name: "reveal" }))
    await user.click(screen.getByRole("button", { name: "patch tree" }))

    expect(state().workspaces["1"].rightPanelState).toMatchObject({
      isOpen: true,
      activeTab: "file_tree",
      pendingRevealPath: "src/a.ts",
      fileTreeFocusedPath: "src/focused.ts",
      fileTreeExpandedPaths: ["src"],
      fileTreeScrollTop: 42,
    })
    expect(state().workspaces["2"].rightPanelState).toMatchObject({
      pendingRevealPath: null,
      fileTreeFocusedPath: null,
      fileTreeExpandedPaths: [],
      fileTreeScrollTop: 0,
    })

    act(() => {
      state().activateScope(2)
    })
    await waitFor(() => {
      expect(screen.getByTestId("scope")).toHaveTextContent("2")
    })

    await user.click(screen.getByRole("button", { name: "reveal" }))
    await user.click(screen.getByRole("button", { name: "consume current" }))

    expect(state().workspaces["1"].rightPanelState.pendingRevealPath).toBe(
      "src/a.ts"
    )
    expect(state().workspaces["2"].rightPanelState.pendingRevealPath).toBeNull()
  })
})
