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

export interface PersistedWorktreeTabsState {
  version: number
  tabs: WorktreeWorkbenchTab[]
  activeTabId: string | null
}

export type WorktreeTabsHydrationResult =
  | { ok: true; state: PersistedWorktreeTabsState | null }
  | { ok: false; state: null }

function safeId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
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
  if (!Array.isArray(raw.tabs)) return null

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
  try {
    window.localStorage.setItem(worktreeTabsStorageKey(), JSON.stringify(state))
    return true
  } catch {
    return false
  }
}
