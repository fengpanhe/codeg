import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { useEffect } from "react"
import {
  useWorkbenchStore,
  __resetWorkbenchStoreForTests,
} from "@/stores/workbench-store"
import { useFileWorkspaceStore } from "@/stores/file-workspace-store"
import { leafIds } from "@/lib/tab-group-layout"
import type { TabItem } from "@/stores/tab-store"
import { StatusBarWorkbenchMode } from "@/components/layout/status-bar-workbench-mode"
import { WorkbenchSurface } from "./workbench-surface"

const fixtures = vi.hoisted(() => ({
  mobile: false,
  conversations: [] as unknown[],
  mounts: [] as string[],
  unmounts: [] as string[],
}))
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values?.title ? `${key} ${values.title}` : key,
}))
vi.mock("@/contexts/tab-context", () => ({
  useTabStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        rawTabs: fixtures.conversations,
        allTabs: fixtures.conversations,
      }),
    { getState: () => ({ switchTab: vi.fn() }) }
  ),
  useTabActions: () => ({
    closeTab: vi.fn(),
    pinTab: vi.fn(),
    openNewConversationTab: vi.fn(),
    openChatModeTab: vi.fn(),
  }),
}))
vi.mock("@/contexts/workspace-context", () => ({
  useWorkspaceView: () => ({
    mode: "fusion",
    activePane: "conversation",
    filesMaximized: false,
    conversationMaximized: false,
  }),
  useWorkspaceActions: () => ({
    closeFileTab: vi.fn(),
    setActivePane: vi.fn(),
  }),
}))
vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        allFolders: [
          { id: 1, name: "A", path: "/a" },
          { id: 2, name: "B", path: "/b" },
        ],
      }),
    { getState: () => ({ getFolder: vi.fn() }) }
  ),
}))
vi.mock("@/contexts/sidebar-context", () => ({
  useSidebarContext: () => ({ isOpen: true }),
}))
vi.mock("@/contexts/aux-panel-context", () => ({
  useAuxPanelContext: () => ({ isOpen: true }),
}))
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => fixtures.mobile }))
vi.mock("@/hooks/use-platform", () => ({
  usePlatform: () => ({ isMac: false, isWindows: false, isLinux: false }),
}))
vi.mock("@/hooks/use-appearance", () => ({
  useZoomLevel: () => ({ zoomLevel: 1 }),
}))
vi.mock("@/lib/platform", () => ({ isDesktop: () => false }))
vi.mock("@/components/conversations/conversation-detail-header", () => ({
  ConversationDetailHeader: () => null,
}))
vi.mock("@/components/files/file-workspace-header", () => ({
  FileWorkspaceHeader: () => null,
}))
vi.mock("@/components/files/file-workspace-panel", () => ({
  FileWorkspacePanel: ({
    tabId,
    scopeId,
    groupId,
    isVisible,
  }: {
    tabId: string
    scopeId: number
    groupId: string
    isVisible: boolean
  }) => (
    <div
      data-testid={`file-${tabId}`}
      data-scope={scopeId}
      data-group={groupId}
      data-visible={String(isVisible)}
    />
  ),
}))
vi.mock("@/components/layout/chrome-reserve", () => ({
  ChromeReserve: () => null,
}))

function conversation(id: string, folderId: number): TabItem {
  return {
    id,
    folderId,
    conversationId: folderId,
    agentType: "claude_code",
    kind: "conversation",
    title: id,
    isPinned: true,
  } as TabItem
}
function Probe({ id }: { id: string }) {
  useEffect(() => {
    fixtures.mounts.push(id)
    return () => {
      fixtures.unmounts.push(id)
    }
  }, [id])
  return <div data-testid={`conversation-${id}`}>{id}</div>
}
function renderWorkbench(conversations: TabItem[]) {
  fixtures.conversations = conversations
  return render(
    <>
      <WorkbenchSurface
        conversations={conversations}
        renderConversation={(tab) => <Probe id={tab.id} />}
      />
      <footer data-testid="status-bar">
        <StatusBarWorkbenchMode />
      </footer>
    </>
  )
}

beforeEach(() => {
  localStorage.clear()
  __resetWorkbenchStoreForTests()
  useWorkbenchStore.getState().hydrate()
  fixtures.mobile = false
  fixtures.mounts = []
  fixtures.unmounts = []
  useFileWorkspaceStore.setState({ fileTabs: [], previewFileTabIds: new Set() })
})

describe("WorkbenchSurface", () => {
  it("keeps live conversation views mounted across scopes, modes and split changes", () => {
    const store = useWorkbenchStore.getState()
    store.openTab(1, { id: "a", entityId: "a", type: "conversation" })
    store.openTab(2, { id: "b", entityId: "b", type: "conversation" })
    store.activateTab(1, "a")
    renderWorkbench([conversation("a", 1), conversation("b", 2)])
    expect(fixtures.mounts).toEqual(["a", "b"])
    act(() => useWorkbenchStore.getState().activateTab(2, "b"))
    expect(
      screen.getByTestId("conversation-a").closest("[data-workspace-pane]")
    ).toHaveAttribute("aria-hidden", "true")
    expect(
      screen.getByTestId("conversation-b").closest("[data-workspace-pane]")
    ).toHaveAttribute("aria-hidden", "false")
    act(() => useWorkbenchStore.getState().setUiMode("unified"))
    act(() => {
      const ws = useWorkbenchStore.getState().workspaces["2"]
      useWorkbenchStore.getState().split(2, ws.focusedGroupId, "right")
    })
    act(() => useWorkbenchStore.getState().setUiMode("classic"))
    expect(fixtures.mounts).toEqual(["a", "b"])
    expect(fixtures.unmounts).toEqual([])
    expect(
      leafIds(useWorkbenchStore.getState().workspaces["2"].groupLayout)
    ).toHaveLength(2)
  })

  it("renders different file entities independently in two groups", () => {
    const store = useWorkbenchStore.getState()
    store.openTab(1, { id: "f1", entityId: "f1", type: "file" })
    const first = useWorkbenchStore.getState().workspaces["1"].focusedGroupId
    const second = store.split(1, first, "right")
    store.openTab(
      1,
      { id: "f2", entityId: "f2", type: "diff" },
      { groupId: second }
    )
    store.setUiMode("unified")
    useFileWorkspaceStore.setState({
      fileTabs: ["f1", "f2"].map((id) => ({
        id,
        kind: "file",
        path: `/${id}`,
        folderId: null,
        title: id,
        description: null,
        language: "text",
        content: "",
        loading: false,
      })),
    })
    renderWorkbench([])
    expect(screen.getByTestId("file-f1")).toHaveAttribute(
      "data-visible",
      "true"
    )
    expect(screen.getByTestId("file-f2")).toHaveAttribute(
      "data-visible",
      "true"
    )
    expect(screen.getByTestId("file-f1")).toHaveAttribute("data-group", first)
    expect(screen.getByTestId("file-f2")).toHaveAttribute("data-group", second)
    const before = JSON.stringify(
      useWorkbenchStore.getState().workspaces["1"].groupLayout
    )
    fireEvent.click(screen.getByTitle("classic"))
    fireEvent.click(screen.getByTitle("unified"))
    expect(
      JSON.stringify(useWorkbenchStore.getState().workspaces["1"].groupLayout)
    ).toBe(before)
    expect(screen.getByTestId("file-f1")).toHaveAttribute(
      "data-visible",
      "true"
    )
  })

  it("collapses only the mobile presentation, preserving the split tree", () => {
    const store = useWorkbenchStore.getState()
    store.openTab(1, { id: "a", entityId: "a", type: "conversation" })
    const first = useWorkbenchStore.getState().workspaces["1"].focusedGroupId
    const second = store.split(1, first, "right")
    store.openTab(
      1,
      { id: "b", entityId: "b", type: "conversation" },
      { groupId: second }
    )
    store.setUiMode("unified")
    fixtures.mobile = true
    renderWorkbench([conversation("a", 1), conversation("b", 1)])
    expect(
      screen.getByTestId("conversation-a").closest("[data-workspace-pane]")
    ).toHaveAttribute("aria-hidden", "true")
    act(() => useWorkbenchStore.getState().focusGroup(1, first))
    expect(
      screen.getByTestId("conversation-a").closest("[data-workspace-pane]")
    ).toHaveAttribute("aria-hidden", "false")
    expect(fixtures.unmounts).toEqual([])
    expect(
      leafIds(useWorkbenchStore.getState().workspaces["1"].groupLayout)
    ).toEqual([first, second])
  })
  it("moves a mixed tab into an empty group and rejects cross-worktree drops", () => {
    const store = useWorkbenchStore.getState()
    store.openTab(1, { id: "a", entityId: "a", type: "conversation" })
    const first = useWorkbenchStore.getState().workspaces["1"].focusedGroupId
    const second = store.split(1, first, "right")
    store.setUiMode("unified")
    renderWorkbench([conversation("a", 1)])
    const target = document.querySelector(`[data-workbench-group="${second}"]`)!
    const foreign = {
      types: ["application/x-codeg-workbench-tab"],
      getData: () => JSON.stringify({ scopeId: 2, tabId: "a" }),
    }
    fireEvent.drop(target, { dataTransfer: foreign })
    expect(useWorkbenchStore.getState().workspaces["1"].groupOf.a).toBe(first)
    const local = {
      ...foreign,
      getData: () => JSON.stringify({ scopeId: 1, tabId: "a" }),
    }
    fireEvent.drop(target, { dataTransfer: local })
    expect(useWorkbenchStore.getState().workspaces["1"].groupOf.a).toBe(second)
    expect(
      useWorkbenchStore.getState().workspaces["1"].groupSelection[second]
    ).toBe("a")
    expect(fixtures.unmounts).toEqual([])
  })

  it("updates focused group when keyboard focus enters another visible conversation", () => {
    const store = useWorkbenchStore.getState()
    store.openTab(1, { id: "a", entityId: "a", type: "conversation" })
    const first = useWorkbenchStore.getState().workspaces["1"].focusedGroupId
    const second = store.split(1, first, "right")
    store.openTab(
      1,
      { id: "b", entityId: "b", type: "conversation" },
      { groupId: second }
    )
    store.setUiMode("unified")
    renderWorkbench([conversation("a", 1), conversation("b", 1)])
    fireEvent.focus(screen.getByTestId("conversation-a"))
    expect(useWorkbenchStore.getState().workspaces["1"].focusedGroupId).toBe(
      first
    )
    expect(
      useWorkbenchStore.getState().workspaces["1"].groupSelection[first]
    ).toBe("a")
    expect(fixtures.unmounts).toEqual([])
  })
})

function seedFiles(ids: string[]) {
  useFileWorkspaceStore.setState({
    fileTabs: ids.map((id) => ({
      id,
      kind: "file",
      path: `/${id}`,
      folderId: null,
      title: id,
      description: null,
      language: "text",
      content: "",
      loading: false,
    })),
  })
}

it.each(["classic", "unified"] as const)(
  "keeps conversation and editor tabs separate and simultaneously visible in %s mode",
  (mode) => {
    const store = useWorkbenchStore.getState()
    store.openTab(1, { id: "c1", entityId: "c1", type: "conversation" })
    store.openTab(1, { id: "c2", entityId: "c2", type: "conversation" })
    store.openTab(1, { id: "f1", entityId: "f1", type: "file" })
    store.openTab(1, { id: "f2", entityId: "f2", type: "file" })
    store.setUiMode(mode)
    seedFiles(["f1", "f2"])
    renderWorkbench([conversation("c1", 1), conversation("c2", 1)])
    const strips = screen.getAllByRole("tablist")
    expect(strips).toHaveLength(2)
    expect(
      within(strips[0])
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
    ).toEqual(["c1", "c2"])
    expect(
      within(strips[1])
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
    ).toEqual(["f1", "f2"])
    fireEvent.click(within(strips[0]).getByRole("tab", { name: "c2" }))
    fireEvent.click(within(strips[1]).getByRole("tab", { name: "f1" }))
    expect(
      screen.getByTestId("conversation-c2").closest("[data-workspace-pane]")
    ).toHaveAttribute("aria-hidden", "false")
    expect(screen.getByTestId("file-f1")).toHaveAttribute(
      "data-visible",
      "true"
    )
    expect(within(strips[1]).queryByTitle("newConversation")).toBeNull()
    expect(
      screen.getByRole("group", { name: "interfaceMode" }).closest("footer")
    ).toBe(screen.getByTestId("status-bar"))
  }
)

it("switches both tab regions with the Worktree while keeping buffers mounted", () => {
  const store = useWorkbenchStore.getState()
  store.openTab(1, { id: "a", entityId: "a", type: "conversation" })
  store.openTab(1, { id: "fa", entityId: "fa", type: "file" })
  store.openTab(2, { id: "b", entityId: "b", type: "conversation" })
  store.openTab(2, { id: "fb", entityId: "fb", type: "file" })
  store.setUiMode("unified")
  seedFiles(["fa", "fb"])
  renderWorkbench([conversation("a", 1), conversation("b", 2)])
  expect(screen.getByTestId("file-fa")).toHaveAttribute("data-visible", "false")
  act(() => useWorkbenchStore.getState().activateScope(1))
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "a",
    "fa",
  ])
  expect(screen.getByTestId("file-fa")).toHaveAttribute("data-visible", "true")
  expect(screen.getByTestId("file-fb")).toHaveAttribute("data-visible", "false")
  expect(
    screen.getByTestId("conversation-a").closest("[data-workspace-pane]")
  ).toHaveAttribute("aria-hidden", "false")
  expect(fixtures.unmounts).toEqual([])
})

it("rejects a conversation dragged to the editor strip and sorts only editor tabs", () => {
  const store = useWorkbenchStore.getState()
  store.openTab(1, { id: "a", entityId: "a", type: "conversation" })
  store.openTab(1, { id: "f1", entityId: "f1", type: "file" })
  store.openTab(1, { id: "f2", entityId: "f2", type: "file" })
  store.setUiMode("unified")
  seedFiles(["f1", "f2"])
  renderWorkbench([conversation("a", 1)])
  const editor = screen.getAllByRole("tablist")[1]
  const dataTransfer = (tabId: string) => ({
    types: ["application/x-codeg-workbench-tab"],
    getData: () => JSON.stringify({ scopeId: 1, tabId }),
  })
  const before = useWorkbenchStore.getState().workspaces["1"].tabRefs
  fireEvent.drop(editor, { dataTransfer: dataTransfer("a") })
  expect(useWorkbenchStore.getState().workspaces["1"].tabRefs).toEqual(before)
  fireEvent.drop(
    within(editor).getByRole("tab", { name: "f1" }).parentElement!,
    { dataTransfer: dataTransfer("f2") }
  )
  expect(
    within(editor)
      .getAllByRole("tab")
      .map((tab) => tab.textContent)
  ).toEqual(["f2", "f1"])
  expect(
    screen.getByTestId("conversation-a").closest("[data-workspace-pane]")
  ).toHaveAttribute("aria-hidden", "false")
})
