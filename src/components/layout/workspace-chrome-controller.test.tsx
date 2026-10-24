import {
  act,
  createEvent,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  __resetWorkbenchStoreForTests,
  useWorkbenchStore,
} from "@/stores/workbench-store"
import {
  useWorktreeTabsStore,
  __resetWorktreeTabsStoreForTests,
} from "@/stores/worktree-tabs-store"
import { leafIds } from "@/lib/tab-group-layout"
import { DEFAULT_SHORTCUTS } from "@/lib/keyboard-shortcuts"
import {
  CLOSE_SHORTCUT_EVENT,
  type CloseShortcutPayload,
} from "@/lib/menu-close-shortcut"

import { WorkspaceChromeController } from "./workspace-chrome-controller"

const state = vi.hoisted(() => ({
  mode: "fusion" as "conversation" | "fusion",
  activePane: "conversation" as "conversation" | "files",
  filesMaximized: false,
  conversationMaximized: false,
  activeTabId: "conv-1" as string | null,
  activeFileTabId: "browser:tab-1" as string | null,
  desktop: true,
  chatMode: false,
  hasFolder: true,
  shortcuts: {} as Record<string, string>,
  listeners: new Map<string, (payload: unknown) => void>(),
  closedTab: null as null | {
    kind: "conversation"
    key: string
    index: number
    scopeId?: number | "global"
    folderId: number
    conversationId: number
    agentType: string
    title: string
    isPinned: boolean
  },
}))

const nav = vi.hoisted(() => ({
  activateWorkbenchScopeWithOuterTab: vi.fn(),
}))

const spies = vi.hoisted(() => ({
  closeTab: vi.fn(),
  openChatModeTab: vi.fn(),
  openTab: vi.fn(),
  closeFileTab: vi.fn(),
  switchTab: vi.fn(),
  switchFileTab: vi.fn(),
  closeAllFileTabs: vi.fn(),
  setActivePane: vi.fn(),
  closeCurrentWindow: vi.fn(() => Promise.resolve()),
  subscribe: vi.fn(),
}))

vi.mock("@/lib/api", () => ({ openSettingsWindow: vi.fn() }))
vi.mock("@/contexts/active-folder-context", () => ({
  useActiveFolder: () => ({
    activeFolder: state.hasFolder ? { id: 1, path: "/repo" } : null,
  }),
}))
vi.mock("@/hooks/use-is-active-chat-mode", () => ({
  useIsActiveChatMode: () => state.chatMode,
}))
vi.mock("@/contexts/sidebar-context", () => ({
  useSidebarContext: () => ({ toggle: vi.fn() }),
}))
vi.mock("@/contexts/aux-panel-context", () => ({
  useAuxPanelContext: () => ({ toggle: vi.fn() }),
}))
vi.mock("@/contexts/terminal-context", () => ({
  useTerminalContext: () => ({ toggle: vi.fn() }),
}))
vi.mock("@/contexts/tab-context", () => {
  const store = <T,>(
    selector: (s: {
      tabs: { id: string }[]
      activeTabId: string | null
      rawTabs: unknown[]
    }) => T
  ) =>
    selector({
      tabs: state.activeTabId ? [{ id: state.activeTabId }] : [],
      activeTabId: state.activeTabId,
      rawTabs: [],
    })
  store.getState = () => ({ rawTabs: [] })
  return {
    useTabActions: () => ({
      openNewConversationTab: vi.fn(),
      openChatModeTab: spies.openChatModeTab,
      openTab: spies.openTab,
      switchTab: spies.switchTab,
      closeTab: spies.closeTab,
    }),
    useTabStore: store,
  }
})
vi.mock("@/contexts/workspace-context", () => ({
  useWorkspaceView: () => ({
    mode: state.mode,
    activePane: state.activePane,
    filesMaximized: state.filesMaximized,
    conversationMaximized: state.conversationMaximized,
  }),
  useWorkspaceFileTabs: () => ({
    activeFileTabId: state.activeFileTabId,
    fileTabs: state.activeFileTabId ? [{ id: state.activeFileTabId }] : [],
  }),
  useWorkspaceActions: () => ({
    closeFileTab: spies.closeFileTab,
    closeAllFileTabs: spies.closeAllFileTabs,
    switchFileTab: spies.switchFileTab,
    openFilePreview: vi.fn(),
    openBrowserTab: vi.fn(),
    setActivePane: spies.setActivePane,
  }),
}))
vi.mock("@/contexts/workbench-route-context", () => ({
  useWorkbenchRoute: () => ({ openConversations: vi.fn() }),
}))
vi.mock("@/contexts/search-dialog-context", () => ({
  useSearchDialog: () => ({ open: false, setOpen: vi.fn() }),
}))
vi.mock("@/hooks/use-shortcut-settings", () => ({
  useShortcutSettings: () => ({ shortcuts: state.shortcuts }),
}))
vi.mock("@/stores/app-workspace-store", () => ({
  isConversationDeleted: () => false,
  useAppWorkspaceStore: {
    getState: () => ({
      getFolder: (id: number) =>
        state.hasFolder ? { id, path: "/repo" } : null,
    }),
  },
}))
vi.mock("@/lib/closed-tab-stack", () => ({
  popClosedTab: () => {
    const closed = state.closedTab
    state.closedTab = null
    return closed
  },
}))
vi.mock("@/lib/worktree-tabs-navigation", () => ({
  activateWorkbenchScopeWithOuterTab: (scopeId: unknown) =>
    nav.activateWorkbenchScopeWithOuterTab(scopeId),
}))
vi.mock("@/components/conversations/search-command-dialog", () => ({
  SearchCommandDialog: () => null,
}))
vi.mock("@/components/layout/workspace-folder-dialog", () => ({
  WorkspaceFolderDialog: () => null,
}))
vi.mock("@/lib/transport", () => ({
  isDesktop: () => state.desktop,
  getShellTransport: () => ({ subscribe: spies.subscribe }),
}))
vi.mock("@/lib/platform", () => ({
  closeCurrentWindow: spies.closeCurrentWindow,
}))
vi.mock("@/lib/browser/window-label", () => ({
  getCurrentWindowLabel: () => "main",
}))

/** Render, and hand back the ⌘W the app menu would deliver. */
async function renderController(): Promise<
  (payload: CloseShortcutPayload) => void
> {
  render(<WorkspaceChromeController />)
  await waitFor(() =>
    expect(state.listeners.has(CLOSE_SHORTCUT_EVENT)).toBe(true)
  )
  return (payload) => {
    act(() => state.listeners.get(CLOSE_SHORTCUT_EVENT)?.(payload))
  }
}

function mount(html: string): void {
  document.body.insertAdjacentHTML("beforeend", html)
}

function focusIframe(id: string): void {
  const frame = document.getElementById(id)
  vi.spyOn(document, "hasFocus").mockReturnValue(true)
  vi.spyOn(document, "activeElement", "get").mockReturnValue(frame)
}

beforeEach(() => {
  __resetWorkbenchStoreForTests()
  __resetWorktreeTabsStoreForTests()
  state.chatMode = false
  state.hasFolder = true
  nav.activateWorkbenchScopeWithOuterTab.mockReset()
  nav.activateWorkbenchScopeWithOuterTab.mockReturnValue(true)
  spies.openChatModeTab.mockClear()
  spies.openTab.mockClear()
  state.closedTab = null
  state.mode = "fusion"
  state.activePane = "conversation"
  state.filesMaximized = false
  state.conversationMaximized = false
  state.activeTabId = "conv-1"
  state.activeFileTabId = "browser:tab-1"
  state.desktop = true
  state.shortcuts = { ...DEFAULT_SHORTCUTS }
  state.listeners.clear()
  spies.closeTab.mockClear()
  spies.closeFileTab.mockClear()
  spies.switchTab.mockClear()
  spies.switchFileTab.mockClear()
  spies.closeAllFileTabs.mockClear()
  spies.setActivePane.mockClear()
  spies.closeCurrentWindow.mockClear()
  spies.subscribe.mockReset()
  spies.subscribe.mockImplementation(
    async (event: string, handler: (payload: unknown) => void) => {
      state.listeners.set(event, handler)
      return () => state.listeners.delete(event)
    }
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ""
})

describe("WorkspaceChromeController — ⌘W from the app menu", () => {
  it("closes the tab of the page that had focus, not the active pane's", async () => {
    mount(
      `<div data-workspace-pane="files"><div data-browser-surface="tab-1"></div></div>`
    )
    const press = await renderController()
    press({ window: "main", surfaceTabId: "tab-1" })
    expect(spies.closeFileTab).toHaveBeenCalledWith("browser:tab-1")
    expect(spies.closeTab).not.toHaveBeenCalled()
    expect(spies.setActivePane).toHaveBeenCalledWith("files")
    expect(spies.closeCurrentWindow).not.toHaveBeenCalled()
  })

  it("closes the conversation tab from an iframe in the transcript", async () => {
    state.activePane = "files"
    mount(
      `<div data-workspace-pane="conversation"><iframe id="frame"></iframe></div>`
    )
    focusIframe("frame")
    const press = await renderController()
    press({ window: "main", surfaceTabId: null })
    expect(spies.closeTab).toHaveBeenCalledWith("conv-1")
    expect(spies.closeFileTab).not.toHaveBeenCalled()
    expect(spies.setActivePane).toHaveBeenCalledWith("conversation")
    expect(spies.closeCurrentWindow).not.toHaveBeenCalled()
  })

  it("routes a page outside both panes the way the workspace routes ⌘W", async () => {
    state.activePane = "files"
    state.activeFileTabId = "file:%2Frepo%2Fa.html"
    // The side panel over a full-page route.
    mount(`<div><div data-browser-surface="tab-1"></div></div>`)
    const press = await renderController()
    press({ window: "main", surfaceTabId: "tab-1" })
    expect(spies.closeFileTab).toHaveBeenCalledWith("file:%2Frepo%2Fa.html")
    expect(spies.setActivePane).not.toHaveBeenCalled()
  })

  it("routes ⌘W that no view held by the active pane", async () => {
    // The page that had the keyboard was just closed by the previous ⌘W.
    state.activePane = "files"
    vi.spyOn(document, "hasFocus").mockReturnValue(false)
    const press = await renderController()
    press({ window: "main", surfaceTabId: null })
    expect(spies.closeFileTab).toHaveBeenCalledWith("browser:tab-1")
    expect(spies.closeCurrentWindow).not.toHaveBeenCalled()
  })

  // A press traced to a column the other one covers — reachable only where
  // the engine cannot report the hidden placeholder's visibility (no
  // `checkVisibility`, as here in jsdom) — must not move the pane into it,
  // and acts on the strip that is on screen.
  it("never moves the pane into a column a maximized conversation covers", async () => {
    state.conversationMaximized = true
    mount(
      `<div data-workspace-pane="files"><div data-browser-surface="tab-1"></div></div>`
    )
    const press = await renderController()
    press({ window: "main", surfaceTabId: "tab-1" })
    expect(spies.setActivePane).not.toHaveBeenCalled()
    expect(spies.closeTab).toHaveBeenCalledWith("conv-1")
    expect(spies.closeFileTab).not.toHaveBeenCalled()
  })

  // The file strip is hidden under the conversation: a pane last left on
  // "files" must not close a file tab nobody can see.
  it("routes ⌘W that no view held to a maximized conversation", async () => {
    state.activePane = "files"
    state.conversationMaximized = true
    vi.spyOn(document, "hasFocus").mockReturnValue(false)
    const press = await renderController()
    press({ window: "main", surfaceTabId: null })
    expect(spies.closeTab).toHaveBeenCalledWith("conv-1")
    expect(spies.closeFileTab).not.toHaveBeenCalled()
    expect(spies.closeCurrentWindow).not.toHaveBeenCalled()
  })

  it("still closes the window when the page heard ⌘W and let it through", async () => {
    mount(`<button id="button">x</button>`)
    vi.spyOn(document, "hasFocus").mockReturnValue(true)
    document.getElementById("button")?.focus()
    const press = await renderController()
    press({ window: "main", surfaceTabId: null })
    expect(spies.closeCurrentWindow).toHaveBeenCalledTimes(1)
    expect(spies.closeTab).not.toHaveBeenCalled()
    expect(spies.closeFileTab).not.toHaveBeenCalled()
  })

  it("closes the window when the pane it was pressed in has no tab", async () => {
    state.activeFileTabId = null
    mount(
      `<div data-workspace-pane="files"><div data-browser-surface="tab-1"></div></div>`
    )
    const press = await renderController()
    press({ window: "main", surfaceTabId: "tab-1" })
    expect(spies.closeCurrentWindow).toHaveBeenCalledTimes(1)
    expect(spies.closeTab).not.toHaveBeenCalled()
  })

  it("keeps ⌘W on the window for someone who moved close-tab elsewhere", async () => {
    state.shortcuts = { ...DEFAULT_SHORTCUTS, close_current_tab: "mod+shift+x" }
    mount(
      `<div data-workspace-pane="files"><div data-browser-surface="tab-1"></div></div>`
    )
    const press = await renderController()
    press({ window: "main", surfaceTabId: "tab-1" })
    expect(spies.closeCurrentWindow).toHaveBeenCalledTimes(1)
    expect(spies.closeFileTab).not.toHaveBeenCalled()
  })

  it("does nothing for a surface this window does not show", async () => {
    const press = await renderController()
    press({ window: "main", surfaceTabId: "tab-9" })
    expect(spies.closeTab).not.toHaveBeenCalled()
    expect(spies.closeFileTab).not.toHaveBeenCalled()
    expect(spies.closeCurrentWindow).not.toHaveBeenCalled()
  })

  it("ignores ⌘W pressed in another workspace window", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false)
    const press = await renderController()
    press({ window: "remote-workspace-2", surfaceTabId: null })
    expect(spies.closeTab).not.toHaveBeenCalled()
    expect(spies.closeFileTab).not.toHaveBeenCalled()
    expect(spies.closeCurrentWindow).not.toHaveBeenCalled()
  })

  it("listens only in the desktop app", () => {
    state.desktop = false
    render(<WorkspaceChromeController />)
    expect(spies.subscribe).not.toHaveBeenCalled()
  })
})

describe("WorkspaceChromeController — ⌘W the page hears", () => {
  it("closes the active pane's tab and keeps the keystroke from the menu", () => {
    render(<WorkspaceChromeController />)
    const event = createEvent.keyDown(document, { key: "w", metaKey: true })
    fireEvent(document, event)
    expect(spies.closeTab).toHaveBeenCalledWith("conv-1")
    expect(event.defaultPrevented).toBe(true)
  })

  it("closes the conversation tab while the conversation is maximized, whatever the pane", () => {
    state.activePane = "files"
    state.conversationMaximized = true
    render(<WorkspaceChromeController />)
    const event = createEvent.keyDown(document, { key: "w", metaKey: true })
    fireEvent(document, event)
    expect(spies.closeTab).toHaveBeenCalledWith("conv-1")
    expect(spies.closeFileTab).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  // The rest of the strip shortcuts follow the same rule: the numbered jump
  // picks from the conversation strip, and "close all file tabs" declines —
  // with the file strip hidden, it would empty a column nobody can see.
  it("keeps the other tab shortcuts off the hidden file strip while the conversation is maximized", () => {
    state.activePane = "files"
    state.conversationMaximized = true
    render(<WorkspaceChromeController />)

    const jump = createEvent.keyDown(document, {
      key: "1",
      code: "Digit1",
      metaKey: true,
    })
    fireEvent(document, jump)
    expect(spies.switchTab).toHaveBeenCalledWith("conv-1")
    expect(spies.switchFileTab).not.toHaveBeenCalled()
    expect(jump.defaultPrevented).toBe(true)

    const closeAll = createEvent.keyDown(document, {
      key: "w",
      metaKey: true,
      shiftKey: true,
    })
    fireEvent(document, closeAll)
    expect(spies.closeAllFileTabs).not.toHaveBeenCalled()
    expect(closeAll.defaultPrevented).toBe(false)
  })

  it("lets it through when the active pane has nothing to close", () => {
    state.activePane = "files"
    state.activeFileTabId = null
    render(<WorkspaceChromeController />)
    const event = createEvent.keyDown(document, { key: "w", metaKey: true })
    fireEvent(document, event)
    expect(spies.closeFileTab).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})

it("synchronizes outer navigation before reopening a closed conversation", () => {
  state.desktop = false
  state.closedTab = {
    kind: "conversation",
    key: "conv-2-grok-22",
    index: 0,
    scopeId: 2,
    folderId: 2,
    conversationId: 22,
    agentType: "grok",
    title: "Restored",
    isPinned: true,
  }
  render(<WorkspaceChromeController />)

  fireEvent.keyDown(document, { key: "t", ctrlKey: true, shiftKey: true })

  expect(nav.activateWorkbenchScopeWithOuterTab).toHaveBeenCalledWith(2)
  expect(spies.openTab).toHaveBeenCalledWith(2, 22, "grok", true, "Restored", {
    index: 0,
  })
})

it("does not reopen a closed conversation when outer capacity refuses", () => {
  nav.activateWorkbenchScopeWithOuterTab.mockReturnValue(false)
  state.desktop = false
  state.closedTab = {
    kind: "conversation",
    key: "conv-2-grok-22",
    index: 0,
    scopeId: 2,
    folderId: 2,
    conversationId: 22,
    agentType: "grok",
    title: "Restored",
    isPinned: true,
  }
  render(<WorkspaceChromeController />)

  fireEvent.keyDown(document, { key: "t", ctrlKey: true, shiftKey: true })

  expect(nav.activateWorkbenchScopeWithOuterTab).toHaveBeenCalledWith(2)
  expect(spies.openTab).not.toHaveBeenCalled()
})

it("creates a chat draft from the new-conversation shortcut without a project folder", async () => {
  state.chatMode = true
  state.hasFolder = false
  state.desktop = false
  render(<WorkspaceChromeController />)
  fireEvent.keyDown(document, { key: "t", ctrlKey: true })
  expect(spies.openChatModeTab).toHaveBeenCalledTimes(1)
})

it("closes an empty focused split instead of closing the window with other tabs open", async () => {
  state.desktop = false
  const store = useWorkbenchStore.getState()
  state.activePane = "files"
  store.openTab(1, { id: "document", type: "file", entityId: "document" })
  const first = useWorkbenchStore.getState().workspaces["1"].focusedGroupId
  const empty = store.split(1, first, "right")
  store.focusGroup(1, empty)
  store.setUiMode("unified")
  useWorktreeTabsStore.getState().openWorktree(1)
  render(<WorkspaceChromeController />)
  const event = createEvent.keyDown(document, { key: "w", ctrlKey: true })
  fireEvent(document, event)
  expect(event.defaultPrevented).toBe(true)
  expect(
    leafIds(useWorkbenchStore.getState().workspaces["1"].groupLayout)
  ).toEqual([first])
  expect(spies.closeCurrentWindow).not.toHaveBeenCalled()
  expect(spies.closeFileTab).not.toHaveBeenCalled()
})

it("cycles and closes only the focused pane even when a mixed group selected the other type", () => {
  state.desktop = false
  state.activePane = "files"
  const store = useWorkbenchStore.getState()
  store.openTab(1, { id: "chat", entityId: "chat", type: "conversation" })
  store.openTab(1, { id: "f1", entityId: "f1", type: "file" })
  store.openTab(1, { id: "f2", entityId: "f2", type: "file" })
  store.activateTab(1, "f1")
  store.activateTab(1, "chat")
  store.setUiMode("unified")
  useWorktreeTabsStore.getState().openWorktree(1)
  render(<WorkspaceChromeController />)
  const chord = state.shortcuts.next_tab.split("+")
  fireEvent.keyDown(document, {
    key: chord[chord.length - 1],
    ctrlKey: chord.includes("ctrl") || chord.includes("mod"),
    metaKey: chord.includes("meta"),
    shiftKey: chord.includes("shift"),
    altKey: chord.includes("alt"),
  })
  expect(useWorkbenchStore.getState().workspaces["1"].lastFileTabId).toBe("f2")
  expect(
    useWorkbenchStore.getState().workspaces["1"].lastConversationTabId
  ).toBe("chat")
  act(() => store.activateTab(1, "chat"))
  fireEvent.keyDown(document, { key: "w", ctrlKey: true })
  expect(spies.closeFileTab).toHaveBeenCalledWith("f2")
  expect(spies.closeTab).not.toHaveBeenCalled()
})

describe("empty outer entry shortcuts", () => {
  it.each(["t", "Tab", "s", "1"])(
    "blocks Ctrl+%s before hidden content listeners",
    async (key) => {
      useWorkbenchStore.getState().setUiMode("unified")
      useWorktreeTabsStore.getState().createEmptyTab()
      await renderController()
      const content = vi.fn()
      document.addEventListener("keydown", content)
      const event = createEvent.keyDown(document, {
        key,
        ctrlKey: true,
        cancelable: true,
      })
      fireEvent(document, event)
      expect(event.defaultPrevented).toBe(true)
      expect(content).not.toHaveBeenCalled()
      expect(spies.closeTab).not.toHaveBeenCalled()
      expect(spies.switchTab).not.toHaveBeenCalled()
      document.removeEventListener("keydown", content)
    }
  )
  it("closes a selected empty outer tab without closing retained content or the window", async () => {
    useWorktreeTabsStore.getState().openWorktree(1)
    useWorkbenchStore.getState().setUiMode("unified")
    useWorktreeTabsStore.getState().createEmptyTab()
    await renderController()
    const event = createEvent.keyDown(document, {
      key: "w",
      ctrlKey: true,
      cancelable: true,
    })
    fireEvent(document, event)
    expect(event.defaultPrevented).toBe(true)
    expect(useWorktreeTabsStore.getState().tabs).toHaveLength(1)
    expect(spies.closeTab).not.toHaveBeenCalled()
    expect(spies.closeFileTab).not.toHaveBeenCalled()
    expect(spies.closeCurrentWindow).not.toHaveBeenCalled()
  })
  it("allows ordinary Tab focus navigation on a blank", async () => {
    useWorkbenchStore.getState().setUiMode("unified")
    useWorktreeTabsStore.getState().createEmptyTab()
    await renderController()
    const event = createEvent.keyDown(document, {
      key: "Tab",
      cancelable: true,
    })
    fireEvent(document, event)
    expect(event.defaultPrevented).toBe(false)
  })
  it("handles native menu close on a blank without closing the window", async () => {
    useWorkbenchStore.getState().setUiMode("unified")
    useWorktreeTabsStore.getState().createEmptyTab()
    const menuClose = await renderController()
    menuClose({ window: "main", surfaceTabId: null })
    expect(useWorktreeTabsStore.getState().tabs).toHaveLength(0)
    expect(spies.closeCurrentWindow).not.toHaveBeenCalled()
  })
})
