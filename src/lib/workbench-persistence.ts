"use client"

import { getCurrentWindowLabel } from "@/lib/browser/window-label"
import {
  firstLeafId,
  leafIds,
  singleGroupLayout,
  type LayoutNode,
} from "@/lib/tab-group-layout"
import {
  getActiveRemoteConnectionId,
  getServerBaseUrl,
  isDesktop,
} from "@/lib/transport"
import type {
  RightPanelState,
  WorkbenchTabRef,
  WorkbenchUiMode,
  WorktreeWorkspaceState,
  WorkspaceScopeId,
} from "@/types/workbench"
import { parseScopeKey, scopeKey } from "@/types/workbench"

export const WORKBENCH_PERSISTENCE_VERSION = 1
const WORKBENCH_STORAGE_PREFIX = "codeg.workbench:v1"
const WINDOW_ID_SESSION_KEY = "codeg.workbench.windowId"
const MAX_LAYOUT_DEPTH = 8
const MIN_RIGHT_PANEL_WIDTH = 200
const MAX_RIGHT_PANEL_WIDTH = 900

export interface PersistedWorkbenchState {
  version: number
  activeScopeId: WorkspaceScopeId
  uiMode: WorkbenchUiMode
  workspaces: Record<string, WorktreeWorkspaceState>
}

export type WorkbenchHydrationResult =
  | { ok: true; state: PersistedWorkbenchState | null }
  | { ok: false; state: null }

const DEFAULT_RIGHT_PANEL_STATE: RightPanelState = {
  isOpen: false,
  width: 320,
  activeTab: "session_details",
  pendingRevealPath: null,
  fileTreeExpandedPaths: [],
  fileTreeFocusedPath: null,
  fileTreeScrollTop: 0,
  git: {
    activeView: "changes",
    selectedPath: null,
    selectedCommit: null,
    expandedSections: [],
    scrollTop: 0,
  },
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== "string" || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function sanitizeRightPanelState(value: unknown): RightPanelState {
  if (!value || typeof value !== "object") return defaultRightPanelState()
  const raw = value as Record<string, unknown>
  const git =
    raw.git && typeof raw.git === "object"
      ? (raw.git as Record<string, unknown>)
      : {}
  const width = finiteNumber(raw.width, DEFAULT_RIGHT_PANEL_STATE.width)
  return {
    isOpen:
      typeof raw.isOpen === "boolean"
        ? raw.isOpen
        : DEFAULT_RIGHT_PANEL_STATE.isOpen,
    width: Math.min(
      Math.max(width, MIN_RIGHT_PANEL_WIDTH),
      MAX_RIGHT_PANEL_WIDTH
    ),
    activeTab: safeString(raw.activeTab) ?? DEFAULT_RIGHT_PANEL_STATE.activeTab,
    pendingRevealPath: safeString(raw.pendingRevealPath),
    fileTreeExpandedPaths: uniqueStrings(raw.fileTreeExpandedPaths),
    fileTreeFocusedPath: safeString(raw.fileTreeFocusedPath),
    fileTreeScrollTop: Math.max(0, finiteNumber(raw.fileTreeScrollTop, 0)),
    git: {
      activeView:
        git.activeView === "log" || git.activeView === "changes"
          ? git.activeView
          : "changes",
      selectedPath: safeString(git.selectedPath),
      selectedCommit: safeString(git.selectedCommit),
      selectedBranch: safeString(git.selectedBranch),
      selectedAuthor: safeString(git.selectedAuthor),
      expandedSections: uniqueStrings(git.expandedSections),
      scrollTop: Math.max(0, finiteNumber(git.scrollTop, 0)),
    },
  }
}

function sanitizeTabRefs(value: unknown): WorkbenchTabRef[] {
  if (!Array.isArray(value)) return []
  const out: WorkbenchTabRef[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue
    const tab = raw as Record<string, unknown>
    const id = safeString(tab.id)
    const entityId = safeString(tab.entityId)
    if (!id || !entityId || seen.has(id)) continue
    if (
      tab.type !== "conversation" &&
      tab.type !== "file" &&
      tab.type !== "diff" &&
      tab.type !== "browser"
    ) {
      continue
    }
    if (tab.type === "browser") continue
    seen.add(id)
    out.push({ id, type: tab.type, entityId })
  }
  return out
}

export function sanitizeWorkbenchLayout(value: unknown): LayoutNode {
  if (!value || typeof value !== "object") return singleGroupLayout()
  const seenLeaves = new Set<string>()
  const stack: Array<{ node: unknown; depth: number }> = [
    { node: value, depth: 1 },
  ]

  while (stack.length > 0) {
    const { node, depth } = stack.pop() as { node: unknown; depth: number }
    if (!node || typeof node !== "object") return singleGroupLayout()
    if (depth > MAX_LAYOUT_DEPTH) return singleGroupLayout()

    const raw = node as Record<string, unknown>
    if (raw.type === "group") {
      if (typeof raw.id !== "string" || raw.id.length === 0) {
        return singleGroupLayout()
      }
      if (seenLeaves.has(raw.id)) return singleGroupLayout()
      seenLeaves.add(raw.id)
      continue
    }

    if (raw.type !== "split") return singleGroupLayout()
    if (typeof raw.id !== "string" || raw.id.length === 0) {
      return singleGroupLayout()
    }
    if (raw.orientation !== "horizontal" && raw.orientation !== "vertical") {
      return singleGroupLayout()
    }
    if (!Array.isArray(raw.children) || !Array.isArray(raw.ratios)) {
      return singleGroupLayout()
    }
    if (raw.children.length < 2 || raw.children.length !== raw.ratios.length) {
      return singleGroupLayout()
    }
    if (
      !raw.ratios.every(
        (ratio) =>
          typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0
      )
    ) {
      return singleGroupLayout()
    }
    for (let index = raw.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: raw.children[index], depth: depth + 1 })
    }
  }

  return value as LayoutNode
}

function sanitizeStringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!value || typeof value !== "object") return out
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string" && key.length > 0 && val.length > 0) {
      out[key] = val
    }
  }
  return out
}

function sanitizeBoolRecord(value: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (!value || typeof value !== "object") return out
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "boolean" && key.length > 0) out[key] = val
  }
  return out
}

function workspaceFromRaw(
  key: string,
  raw: unknown
): WorktreeWorkspaceState | null {
  if (!raw || typeof raw !== "object") return null
  const rec = raw as Record<string, unknown>
  const scopeId = parseScopeKey(key)
  const tabRefs = sanitizeTabRefs(rec.tabRefs)
  const groupLayout = sanitizeWorkbenchLayout(rec.groupLayout)
  const leaves = new Set(leafIds(groupLayout))
  const tabIds = new Set(tabRefs.map((tab) => tab.id))

  const groupOf = sanitizeStringRecord(rec.groupOf)
  for (const [tabId, groupId] of Object.entries(groupOf)) {
    if (!tabIds.has(tabId) || !leaves.has(groupId)) delete groupOf[tabId]
  }

  const first = firstLeafId(groupLayout)
  for (const tab of tabRefs) {
    if (!groupOf[tab.id] || !leaves.has(groupOf[tab.id])) {
      groupOf[tab.id] = first
    }
  }

  const groupSelection: Record<string, string> = {}
  const rawSelection = sanitizeStringRecord(rec.groupSelection)
  for (const groupId of leaves) {
    const selected = rawSelection[groupId]
    if (
      selected &&
      tabRefs.some(
        (tab) =>
          tab.id === selected &&
          (groupOf[tab.id] ?? firstLeafId(groupLayout)) === groupId
      )
    ) {
      groupSelection[groupId] = selected
    }
  }

  const tileByGroup = sanitizeBoolRecord(rec.tileByGroup)
  for (const groupId of Object.keys(tileByGroup)) {
    if (!leaves.has(groupId)) delete tileByGroup[groupId]
  }

  const focusedGroupCandidate = safeString(rec.focusedGroupId)
  const focusedGroupId =
    focusedGroupCandidate && leaves.has(focusedGroupCandidate)
      ? focusedGroupCandidate
      : firstLeafId(groupLayout)

  const lastConversationTabId = tabRefs.some(
    (tab) => tab.id === rec.lastConversationTabId && tab.type === "conversation"
  )
    ? (rec.lastConversationTabId as string)
    : null
  const lastFileTabId = tabRefs.some(
    (tab) => tab.id === rec.lastFileTabId && tab.type !== "conversation"
  )
    ? (rec.lastFileTabId as string)
    : null

  return {
    version:
      typeof rec.version === "number" && Number.isFinite(rec.version)
        ? rec.version
        : 1,
    scopeId,
    tabRefs,
    groupLayout,
    groupOf,
    groupSelection,
    tileByGroup,
    focusedGroupId,
    lastConversationTabId,
    lastFileTabId,
    classicRatio: Math.min(
      Math.max(finiteNumber(rec.classicRatio, 0.56), 0.2),
      0.8
    ),
    rightPanelState: sanitizeRightPanelState(rec.rightPanelState),
  }
}

export function sanitizePersistedWorkbenchState(
  value: unknown
): PersistedWorkbenchState | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  if (raw.version !== WORKBENCH_PERSISTENCE_VERSION) return null
  const rawWorkspaces =
    raw.workspaces && typeof raw.workspaces === "object"
      ? (raw.workspaces as Record<string, unknown>)
      : null
  if (!rawWorkspaces) return null

  const workspaces: Record<string, WorktreeWorkspaceState> = {}
  for (const [key, workspace] of Object.entries(rawWorkspaces)) {
    const parsed = workspaceFromRaw(key, workspace)
    if (parsed) workspaces[scopeKey(parsed.scopeId)] = parsed
  }

  const activeScopeId = parseScopeKey(
    typeof raw.activeScopeId === "string" ||
      typeof raw.activeScopeId === "number"
      ? String(raw.activeScopeId)
      : "global"
  )
  const activeKey = scopeKey(activeScopeId)
  return {
    version: WORKBENCH_PERSISTENCE_VERSION,
    activeScopeId: workspaces[activeKey] ? activeScopeId : "global",
    uiMode: raw.uiMode === "unified" ? "unified" : "classic",
    workspaces,
  }
}

function getBrowserWindowId(explicitWindowId?: string): string {
  if (explicitWindowId) return explicitWindowId
  if (typeof window === "undefined") return "main"
  try {
    const remoteWindowId = new URLSearchParams(window.location.search).get(
      "remoteWindowId"
    )
    if (remoteWindowId) return remoteWindowId
  } catch {
    /* ignore */
  }
  try {
    const existing = window.sessionStorage.getItem(WINDOW_ID_SESSION_KEY)
    if (existing) return existing
    const id = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    window.sessionStorage.setItem(WINDOW_ID_SESSION_KEY, id)
    return id
  } catch {
    return "main"
  }
}

export interface WorkbenchPersistenceNamespace {
  backendId: string
  windowId: string
  storageKeyPrefix: string
}

export function getWorkbenchPersistenceNamespace(options?: {
  windowId?: string
}): WorkbenchPersistenceNamespace {
  const remoteId = getActiveRemoteConnectionId()
  const backendId = remoteId
    ? `remote-${remoteId}`
    : `local-${isDesktop() ? "desktop" : "web"}-${getServerBaseUrl()}`
  const windowId = isDesktop()
    ? (options?.windowId ?? getCurrentWindowLabel())
    : getBrowserWindowId(options?.windowId)
  return {
    backendId,
    windowId,
    storageKeyPrefix: `${encodeURIComponent(backendId)}:${encodeURIComponent(
      windowId
    )}`,
  }
}

export function workbenchStorageKey(options?: { windowId?: string }): string {
  const namespace = getWorkbenchPersistenceNamespace(options)
  return `${WORKBENCH_STORAGE_PREFIX}:${namespace.storageKeyPrefix}`
}

export function readPersistedWorkbenchState(): WorkbenchHydrationResult {
  if (typeof window === "undefined") return { ok: true, state: null }
  let raw: string | null
  try {
    raw = window.localStorage.getItem(workbenchStorageKey())
  } catch {
    return { ok: false, state: null }
  }
  if (raw === null) return { ok: true, state: null }
  try {
    const parsed = JSON.parse(raw) as unknown
    const state = sanitizePersistedWorkbenchState(parsed)
    return state ? { ok: true, state } : { ok: false, state: null }
  } catch {
    return { ok: false, state: null }
  }
}

export function writePersistedWorkbenchState(
  state: PersistedWorkbenchState
): boolean {
  if (typeof window === "undefined") return true
  try {
    window.localStorage.setItem(workbenchStorageKey(), JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function defaultRightPanelState(): RightPanelState {
  return {
    ...DEFAULT_RIGHT_PANEL_STATE,
    fileTreeExpandedPaths: [],
    git: { ...DEFAULT_RIGHT_PANEL_STATE.git, expandedSections: [] },
  }
}
