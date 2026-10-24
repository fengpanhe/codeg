"use client"

import { getWorkbenchPersistenceNamespace } from "@/lib/workbench-persistence"
import {
  parseScopeKey,
  scopeKey,
  type WorktreeWorkbenchTab,
  type WorkspaceScopeId,
} from "@/types/workbench"

export const WORKTREE_TABS_PERSISTENCE_VERSION = 1
const WORKTREE_TABS_STORAGE_PREFIX = "codeg.worktree-tabs:v1"
export const MAX_WORKTREE_TABS_PAYLOAD_BYTES = 4 * 1024 * 1024
export const MAX_WORKTREE_TABS = 4096
export const MAX_WORKTREE_TAB_ID_LENGTH = 128

export interface PersistedWorktreeTabsState {
  version: number
  tabs: WorktreeWorkbenchTab[]
  activeTabId: string | null
}

export type WorktreeTabsHydrationResult =
  | { ok: true; state: PersistedWorktreeTabsState | null }
  | { ok: false; state: null }

function exceedsUtf8ByteLimit(value: string, maxBytes: number): boolean {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      if (index + 1 < value.length) index += 1
    } else bytes += 3
    if (bytes > maxBytes) return true
  }
  return false
}

function safeId(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_WORKTREE_TAB_ID_LENGTH
    ? value
    : null
}

function sanitizeScopeId(value: unknown): WorkspaceScopeId | null | undefined {
  if (value === null) return null
  if (value === "global") return "global"
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : undefined
  }
  if (typeof value === "string") {
    const parsed = parseScopeKey(value)
    return parsed === "global" && value !== "global" ? undefined : parsed
  }
  return undefined
}

export function sanitizePersistedWorktreeTabsState(
  value: unknown
): PersistedWorktreeTabsState | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  if (raw.version !== WORKTREE_TABS_PERSISTENCE_VERSION) return null
  if (!Array.isArray(raw.tabs) || raw.tabs.length > MAX_WORKTREE_TABS) {
    return null
  }

  const tabs: WorktreeWorkbenchTab[] = []
  const ids = new Set<string>()
  const concreteScopes = new Set<string>()

  for (const item of raw.tabs) {
    if (!item || typeof item !== "object") continue
    const tab = item as Record<string, unknown>
    const id = safeId(tab.id)
    const scopeId = sanitizeScopeId(tab.scopeId)
    if (!id || ids.has(id) || scopeId === undefined) continue
    if (scopeId != null) {
      const key = scopeKey(scopeId)
      if (concreteScopes.has(key)) continue
      concreteScopes.add(key)
    }
    ids.add(id)
    tabs.push({
      id,
      scopeId,
      isPinned: tab.isPinned === true,
    })
  }

  const activeTabId = safeId(raw.activeTabId)
  return {
    version: WORKTREE_TABS_PERSISTENCE_VERSION,
    tabs,
    activeTabId:
      activeTabId && tabs.some((tab) => tab.id === activeTabId)
        ? activeTabId
        : (tabs[0]?.id ?? null),
  }
}

function isValidPersistedWorktreeTabsState(
  state: PersistedWorktreeTabsState
): boolean {
  if (state.version !== WORKTREE_TABS_PERSISTENCE_VERSION) return false
  if (!Array.isArray(state.tabs) || state.tabs.length > MAX_WORKTREE_TABS) {
    return false
  }

  const ids = new Set<string>()
  const concreteScopes = new Set<string>()

  for (const tab of state.tabs) {
    if (!safeId(tab.id) || ids.has(tab.id)) return false
    const scopeId = sanitizeScopeId(tab.scopeId)
    if (scopeId === undefined) return false
    if (scopeId != null) {
      const key = scopeKey(scopeId)
      if (concreteScopes.has(key)) return false
      concreteScopes.add(key)
    }
    ids.add(tab.id)
  }

  if (state.activeTabId == null) return true
  return (
    safeId(state.activeTabId) != null &&
    state.tabs.some((tab) => tab.id === state.activeTabId)
  )
}

export function worktreeTabsStorageKey(options?: {
  windowId?: string
}): string {
  const namespace = getWorkbenchPersistenceNamespace(options)
  return WORKTREE_TABS_STORAGE_PREFIX + ":" + namespace.storageKeyPrefix
}

export function readPersistedWorktreeTabsState(): WorktreeTabsHydrationResult {
  if (typeof window === "undefined") return { ok: true, state: null }
  let raw: string | null
  try {
    raw = window.localStorage.getItem(worktreeTabsStorageKey())
  } catch {
    return { ok: false, state: null }
  }
  if (raw === null) return { ok: true, state: null }
  if (exceedsUtf8ByteLimit(raw, MAX_WORKTREE_TABS_PAYLOAD_BYTES)) {
    return { ok: false, state: null }
  }
  try {
    const state = sanitizePersistedWorktreeTabsState(JSON.parse(raw) as unknown)
    return state ? { ok: true, state } : { ok: false, state: null }
  } catch {
    return { ok: false, state: null }
  }
}

export function writePersistedWorktreeTabsState(
  state: PersistedWorktreeTabsState
): boolean {
  if (typeof window === "undefined") return true
  if (!isValidPersistedWorktreeTabsState(state)) return false
  try {
    const raw = JSON.stringify(state)
    if (exceedsUtf8ByteLimit(raw, MAX_WORKTREE_TABS_PAYLOAD_BYTES)) {
      return false
    }
    window.localStorage.setItem(worktreeTabsStorageKey(), raw)
    return true
  } catch {
    return false
  }
}
