import { beforeEach, describe, expect, it } from "vitest"
import {
  readPersistedWorktreeTabsState,
  sanitizePersistedWorktreeTabsState,
  MAX_WORKTREE_TABS,
  MAX_WORKTREE_TABS_PAYLOAD_BYTES,
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
    localStorage.setItem(
      key,
      "{" + " ".repeat(MAX_WORKTREE_TABS_PAYLOAD_BYTES) + "}"
    )

    expect(readPersistedWorktreeTabsState()).toEqual({
      ok: false,
      state: null,
    })
  })

  it("rejects multibyte oversized payloads by byte length before parsing", () => {
    const key = worktreeTabsStorageKey()
    localStorage.setItem(
      key,
      "{" + "文".repeat(Math.ceil(MAX_WORKTREE_TABS_PAYLOAD_BYTES / 3)) + "}"
    )

    expect(readPersistedWorktreeTabsState()).toEqual({
      ok: false,
      state: null,
    })
  })

  it.each(["😀", "\ud800文", "\ud800a", "\ud800\ud800", "\udc00", "\ud800"])(
    "counts raw surrogate sequence %j at the exact UTF-8 read boundary",
    (sequence) => {
      const shell = '{"version":1,"tabs":[],"activeTabId":null,"unused":""}'
      const overhead = new TextEncoder().encode(shell).length
      const unitBytes = new TextEncoder().encode(sequence).length
      const count = Math.floor(
        (MAX_WORKTREE_TABS_PAYLOAD_BYTES - overhead) / unitBytes
      )
      const prefix = shell.slice(0, -2) + sequence.repeat(count)
      const padding =
        MAX_WORKTREE_TABS_PAYLOAD_BYTES - overhead - count * unitBytes
      const raw = prefix + "a".repeat(padding) + '"}'
      expect(new TextEncoder().encode(raw).length).toBe(
        MAX_WORKTREE_TABS_PAYLOAD_BYTES
      )
      localStorage.setItem(worktreeTabsStorageKey(), raw)
      expect(readPersistedWorktreeTabsState()).toEqual({
        ok: true,
        state: { version: 1, tabs: [], activeTabId: null },
      })
      const over = raw.slice(0, -2) + 'a"}'
      expect(new TextEncoder().encode(over).length).toBe(
        MAX_WORKTREE_TABS_PAYLOAD_BYTES + 1
      )
      localStorage.setItem(worktreeTabsStorageKey(), over)
      expect(readPersistedWorktreeTabsState()).toEqual({
        ok: false,
        state: null,
      })
    }
  )

  it("rejects unbounded tab counts and oversized ids", () => {
    expect(
      sanitizePersistedWorktreeTabsState({
        version: WORKTREE_TABS_PERSISTENCE_VERSION,
        activeTabId: "worktree-tab-1",
        tabs: Array.from({ length: MAX_WORKTREE_TABS + 1 }, (_, index) => ({
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

  it("writes and reads the last allowed tab count", () => {
    const key = worktreeTabsStorageKey()
    const tabs = Array.from({ length: MAX_WORKTREE_TABS }, (_, index) => ({
      id: "tab-" + index,
      scopeId: null,
      isPinned: false,
    }))

    expect(
      writePersistedWorktreeTabsState({
        version: WORKTREE_TABS_PERSISTENCE_VERSION,
        activeTabId: "tab-" + (MAX_WORKTREE_TABS - 1),
        tabs,
      })
    ).toBe(true)

    expect(localStorage.getItem(key)).toContain(
      "tab-" + (MAX_WORKTREE_TABS - 1)
    )
    expect(readPersistedWorktreeTabsState()).toEqual({
      ok: true,
      state: {
        version: WORKTREE_TABS_PERSISTENCE_VERSION,
        activeTabId: "tab-" + (MAX_WORKTREE_TABS - 1),
        tabs,
      },
    })
  })

  it("refuses invalid writer output without overwriting storage", () => {
    const key = worktreeTabsStorageKey()
    localStorage.setItem(key, "sentinel")

    expect(
      writePersistedWorktreeTabsState({
        version: WORKTREE_TABS_PERSISTENCE_VERSION,
        activeTabId: "tab-0",
        tabs: Array.from({ length: MAX_WORKTREE_TABS + 1 }, (_, index) => ({
          id: "tab-" + index,
          scopeId: null,
          isPinned: false,
        })),
      })
    ).toBe(false)
    expect(localStorage.getItem(key)).toBe("sentinel")
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
