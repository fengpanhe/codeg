import { beforeEach, describe, expect, it } from "vitest"
import {
  readPersistedWorktreeTabsState,
  sanitizePersistedWorktreeTabsState,
  worktreeTabsStorageKey,
  writePersistedWorktreeTabsState,
  WORKTREE_TABS_PERSISTENCE_VERSION,
} from "@/lib/worktree-tabs-persistence"

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe("worktree tabs persistence", () => {
  it("keeps empty null-scope tabs and selected empty distinct from global", () => {
    const parsed = sanitizePersistedWorktreeTabsState({
      version: WORKTREE_TABS_PERSISTENCE_VERSION,
      activeTabId: "blank",
      tabs: [
        { id: "global", scopeId: "global", isPinned: false },
        { id: "blank", scopeId: null, isPinned: false },
        { id: "scope-1", scopeId: 1, isPinned: true },
      ],
    })

    expect(parsed).toEqual({
      version: WORKTREE_TABS_PERSISTENCE_VERSION,
      activeTabId: "blank",
      tabs: [
        { id: "global", scopeId: "global", isPinned: false },
        { id: "blank", scopeId: null, isPinned: false },
        { id: "scope-1", scopeId: 1, isPinned: true },
      ],
    })
  })

  it("sanitizes invalid entries and keeps one tab per concrete scope", () => {
    const parsed = sanitizePersistedWorktreeTabsState({
      version: WORKTREE_TABS_PERSISTENCE_VERSION,
      activeTabId: "duplicate-scope",
      tabs: [
        { id: "", scopeId: 1, isPinned: false },
        { id: "bad-scope", scopeId: -1, isPinned: false },
        { id: "scope-1", scopeId: 1, isPinned: true },
        { id: "duplicate-scope", scopeId: 1, isPinned: false },
        { id: "blank-a", scopeId: null, isPinned: false },
        { id: "blank-b", scopeId: null, isPinned: true },
      ],
    })

    expect(parsed).toEqual({
      version: WORKTREE_TABS_PERSISTENCE_VERSION,
      activeTabId: "scope-1",
      tabs: [
        { id: "scope-1", scopeId: 1, isPinned: true },
        { id: "blank-a", scopeId: null, isPinned: false },
        { id: "blank-b", scopeId: null, isPinned: true },
      ],
    })
  })

  it("uses the workbench backend/window namespace", () => {
    expect(worktreeTabsStorageKey({ windowId: "a" })).not.toBe(
      worktreeTabsStorageKey({ windowId: "b" })
    )
  })

  it("rejects oversized payloads before parsing", () => {
    const key = worktreeTabsStorageKey()
    localStorage.setItem(key, "{" + " ".repeat(128 * 1024) + "}")

    expect(readPersistedWorktreeTabsState()).toEqual({
      ok: false,
      state: null,
    })
  })

  it("rejects multibyte oversized payloads by byte length before parsing", () => {
    const key = worktreeTabsStorageKey()
    localStorage.setItem(key, "{" + "文".repeat(44 * 1024) + "}")

    expect(readPersistedWorktreeTabsState()).toEqual({
      ok: false,
      state: null,
    })
  })

  it("rejects unbounded tab counts and oversized ids", () => {
    expect(
      sanitizePersistedWorktreeTabsState({
        version: WORKTREE_TABS_PERSISTENCE_VERSION,
        activeTabId: "worktree-tab-1",
        tabs: Array.from({ length: 129 }, (_, index) => ({
          id: "tab-" + index,
          scopeId: null,
          isPinned: false,
        })),
      })
    ).toBeNull()

    expect(
      sanitizePersistedWorktreeTabsState({
        version: WORKTREE_TABS_PERSISTENCE_VERSION,
        activeTabId: "scope-1",
        tabs: [
          { id: "x".repeat(129), scopeId: null, isPinned: false },
          { id: "scope-1", scopeId: 1, isPinned: false },
        ],
      })
    ).toEqual({
      version: WORKTREE_TABS_PERSISTENCE_VERSION,
      activeTabId: "scope-1",
      tabs: [{ id: "scope-1", scopeId: 1, isPinned: false }],
    })
  })

  it("reports rejected caches without overwriting them", () => {
    const key = worktreeTabsStorageKey()
    localStorage.setItem(key, "{not-json")

    expect(readPersistedWorktreeTabsState()).toEqual({
      ok: false,
      state: null,
    })
    expect(localStorage.getItem(key)).toBe("{not-json")
  })

  it("writes valid snapshots when storage is available", () => {
    const key = worktreeTabsStorageKey()
    expect(
      writePersistedWorktreeTabsState({
        version: WORKTREE_TABS_PERSISTENCE_VERSION,
        activeTabId: "scope-1",
        tabs: [{ id: "scope-1", scopeId: 1, isPinned: false }],
      })
    ).toBe(true)
    expect(localStorage.getItem(key)).toContain("scope-1")
  })
})
