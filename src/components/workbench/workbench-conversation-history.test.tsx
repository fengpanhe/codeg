import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { DbConversationSummary, FolderDetail } from "@/lib/types"
import { WorkbenchConversationHistory } from "./workbench-conversation-history"

const fixtures = vi.hoisted(() => ({
  folders: [] as FolderDetail[],
  openWorktree: vi.fn(() => true),
  openTab: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  listAllConversations: vi.fn(async () => []),
}))

vi.mock("@/stores/app-workspace-store", () => ({
  useAppWorkspaceStore: (selector: (s: unknown) => unknown) =>
    selector({
      allFolders: fixtures.folders,
    }),
}))

vi.mock("@/stores/worktree-tabs-store", () => ({
  useWorktreeTabsStore: {
    getState: () => ({
      openWorktree: fixtures.openWorktree,
    }),
  },
}))

vi.mock("@/contexts/tab-context", () => ({
  useTabActions: () => ({
    openTab: fixtures.openTab,
  }),
}))

const { listAllConversations } = await import("@/lib/api")
const mockListAllConversations = vi.mocked(listAllConversations)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function folder(overrides: Partial<FolderDetail>): FolderDetail {
  return {
    id: 1,
    name: "repo",
    path: "/repo",
    git_branch: null,
    default_agent_type: null,
    last_opened_at: "2026-10-24T00:00:00.000Z",
    sort_order: 0,
    color: "gray",
    parent_id: null,
    kind: "regular",
    alias: null,
    group_id: null,
    ...overrides,
  }
}

function conversation(
  overrides: Partial<DbConversationSummary>
): DbConversationSummary {
  return {
    id: 10,
    folder_id: 1,
    title: "Fix parser",
    title_locked: false,
    agent_type: "codex",
    status: "completed",
    kind: "regular",
    model: null,
    git_branch: null,
    external_id: null,
    message_count: 3,
    child_count: 0,
    created_at: "2026-10-23T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    pinned_at: null,
    parent_id: null,
    ...overrides,
  }
}

function renderHistory(scopeId: number | "global" = 2) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WorkbenchConversationHistory scopeId={scopeId} groupId="group-a" />
    </NextIntlClientProvider>
  )
}

async function openHistory() {
  await userEvent.click(screen.getByRole("button", { name: "History" }))
}

beforeEach(() => {
  fixtures.folders = [
    folder({ id: 1, name: "repo", path: "/repo", parent_id: null }),
    folder({ id: 2, name: "feature", path: "/repo-wt", parent_id: 1 }),
    folder({ id: 3, name: "bugfix", path: "/repo-bug", parent_id: 1 }),
    folder({ id: 9, name: "Chat", path: "", kind: "chat" }),
  ]
  fixtures.openWorktree.mockReset()
  fixtures.openWorktree.mockReturnValue(true)
  fixtures.openTab.mockReset()
  mockListAllConversations.mockReset()
  mockListAllConversations.mockResolvedValue([])
})

describe("WorkbenchConversationHistory", () => {
  it("loads the current worktree including child conversations by default", async () => {
    renderHistory(2)
    await openHistory()

    await waitFor(() =>
      expect(mockListAllConversations).toHaveBeenCalledWith(
        expect.objectContaining({
          folder_ids: [2],
          include_children: true,
        })
      )
    )
  })

  it("can search the project root and worktree children together", async () => {
    const user = userEvent.setup()
    renderHistory(2)
    await openHistory()

    await user.click(screen.getByRole("button", { name: "Project" }))
    await user.type(screen.getByPlaceholderText("Search history"), "auth")

    await waitFor(() =>
      expect(mockListAllConversations).toHaveBeenLastCalledWith(
        expect.objectContaining({
          folder_ids: [1, 2, 3],
          include_children: true,
          search: "auth",
        })
      )
    )
  })

  it("restricts global history to chat folders", async () => {
    renderHistory("global")
    await openHistory()

    await waitFor(() =>
      expect(mockListAllConversations).toHaveBeenCalledWith(
        expect.objectContaining({
          folder_ids: [9],
          include_children: true,
        })
      )
    )
  })

  it("renders empty, error, and retry states", async () => {
    mockListAllConversations
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([])
    renderHistory(2)
    await openHistory()

    expect(await screen.findByText("Could not load history.")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))

    expect(await screen.findByText("No history found.")).toBeVisible()
    expect(mockListAllConversations).toHaveBeenCalledTimes(2)
  })

  it("ignores stale responses after the scope range changes", async () => {
    const current = deferred<DbConversationSummary[]>()
    const project = deferred<DbConversationSummary[]>()
    mockListAllConversations
      .mockReturnValueOnce(current.promise)
      .mockReturnValueOnce(project.promise)
    renderHistory(2)
    await openHistory()

    fireEvent.click(screen.getByRole("button", { name: "Project" }))
    project.resolve([conversation({ id: 20, title: "Fresh project result" })])
    current.resolve([conversation({ id: 21, title: "Stale current result" })])

    expect(await screen.findByText("Fresh project result")).toBeVisible()
    expect(screen.queryByText("Stale current result")).toBeNull()
  })

  it("activates the outer worktree before opening an existing conversation", async () => {
    mockListAllConversations.mockResolvedValue([
      conversation({
        id: 42,
        folder_id: 3,
        title: "Existing session",
        agent_type: "claude_code",
      }),
    ])
    renderHistory(2)
    await openHistory()

    fireEvent.click(
      await screen.findByRole("button", { name: /Existing session/ })
    )

    expect(fixtures.openWorktree).toHaveBeenCalledWith(3)
    expect(fixtures.openTab).toHaveBeenCalledWith(
      3,
      42,
      "claude_code",
      false,
      "Existing session"
    )
  })

  it("does not open an inner tab when outer worktree activation is refused", async () => {
    fixtures.openWorktree.mockReturnValue(false)
    mockListAllConversations.mockResolvedValue([
      conversation({ id: 42, folder_id: 3, title: "Blocked session" }),
    ])
    renderHistory(2)
    await openHistory()

    fireEvent.click(
      await screen.findByRole("button", { name: /Blocked session/ })
    )

    expect(fixtures.openWorktree).toHaveBeenCalledWith(3)
    expect(fixtures.openTab).not.toHaveBeenCalled()
    expect(
      await screen.findByText("Cannot open another worktree tab.")
    ).toBeVisible()
  })
})
