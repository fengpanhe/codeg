import type { LayoutNode } from "@/lib/tab-group-layout"

export type WorkspaceScopeId = number | "global"

export type WorkbenchTabType = "conversation" | "file" | "diff" | "browser"

export interface WorkbenchTabRef {
  id: string
  type: WorkbenchTabType
  entityId: string
}

export type WorkbenchPane = "conversation" | "files"

export type WorkbenchUiMode = "classic" | "unified"

export interface WorkbenchGitViewState {
  activeView?: "changes" | "log"
  selectedPath?: string | null
  selectedCommit?: string | null
  selectedBranch?: string | null
  selectedAuthor?: string | null
  expandedSections?: string[]
  scrollTop?: number
}

export interface RightPanelState {
  isOpen: boolean
  width: number
  activeTab: "files" | "git" | "tasks" | "details" | string
  pendingRevealPath: string | null
  fileTreeExpandedPaths: string[]
  fileTreeFocusedPath: string | null
  fileTreeScrollTop: number
  git: WorkbenchGitViewState
}

export interface WorktreeWorkspaceState {
  version: number
  scopeId: WorkspaceScopeId
  tabRefs: WorkbenchTabRef[]
  groupLayout: LayoutNode
  groupOf: Record<string, string>
  groupSelection: Record<string, string>
  tileByGroup: Record<string, boolean>
  focusedGroupId: string
  lastConversationTabId: string | null
  lastFileTabId: string | null
  classicRatio: number
  paneTabSelection?: Record<string, Partial<Record<WorkbenchPane, string>>>
  groupPane?: Record<string, WorkbenchPane>
  paneSplitRatios?: Partial<Record<WorkbenchPane, Record<string, number[]>>>
  rightPanelState: RightPanelState
}

export interface LegacyWorkbenchGroupState {
  groupLayout?: unknown
  groupOf?: unknown
  groupSelection?: unknown
  tileByGroup?: unknown
}

export interface ConversationWorkbenchRef {
  id: string
  folderId: number
  isChat?: boolean
  persistenceId?: string
}

export interface WorkbenchOpenOptions {
  groupId?: string
  index?: number
  activate?: boolean
  background?: boolean
}

export interface WorkbenchPruneOptions {
  authoritative?: boolean
}

export interface WorktreeWorkbenchTab {
  id: string
  scopeId: WorkspaceScopeId | null
  isPinned: boolean
}

export interface WorktreeTabsState {
  tabs: WorktreeWorkbenchTab[]
  activeTabId: string | null
  hydrated: boolean
  hydrate(): void
  openWorktree(scopeId: WorkspaceScopeId): void
  createEmptyTab(): void
  activateTab(id: string): void
  closeTab(id: string): void
  setPinned(id: string, pinned: boolean): void
}

export function scopeKey(scopeId: WorkspaceScopeId): string {
  return scopeId === "global" ? "global" : String(scopeId)
}

export function parseScopeKey(key: string): WorkspaceScopeId {
  if (key === "global") return "global"
  const parsed = Number(key)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : "global"
}

export function scopeIdForFolder(
  folderId: number | null | undefined,
  isChat?: boolean
): WorkspaceScopeId {
  if (
    isChat ||
    folderId == null ||
    !Number.isFinite(folderId) ||
    folderId <= 0
  ) {
    return "global"
  }
  return Math.floor(folderId)
}
