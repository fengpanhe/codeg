"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { loadPersistedPanelState } from "@/lib/panel-state-storage"
import { workbenchStorageKey } from "@/lib/workbench-persistence"
import { detectPlatform } from "@/hooks/use-platform"
import { isAuxPanelTab, type AuxPanelTab } from "@/lib/aux-panel-tab-order"
import { isDesktop } from "@/lib/platform"
import { useWorkbenchStore } from "@/stores/workbench-store"
import type { RightPanelState, WorkspaceScopeId } from "@/types/workbench"

// Defined beside the list it is derived from, so the tab ids and the stored
// rail order can't drift apart.
export type { AuxPanelTab }

const STORAGE_KEY = "workspace:right-sidebar"

const DEFAULT_WIDTH = 320
const MIN_WIDTH = 200
const MAX_WIDTH = 900
const DEFAULT_IS_OPEN = false
const DEFAULT_ACTIVE_TAB: AuxPanelTab = "session_details"
const EMPTY_FILE_TREE_EXPANDED_PATHS: string[] = []

interface AuxPanelFileTreePatch {
  fileTreeExpandedPaths?: string[]
  fileTreeFocusedPath?: string | null
  fileTreeScrollTop?: number
}

function normalizeActiveTab(tab: unknown): AuxPanelTab {
  if (tab === "files") return "file_tree"
  if (tab === "details") return "session_details"
  if (tab === "git") return "changes"
  return isAuxPanelTab(tab) ? tab : DEFAULT_ACTIVE_TAB
}

function hasPersistedWorkbenchState(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(workbenchStorageKey()) !== null
  } catch {
    return true
  }
}

function shouldSeedLegacyPanelState(state: RightPanelState): boolean {
  const openLooksDefault =
    state.isOpen === DEFAULT_IS_OPEN || state.isOpen === true
  const tabLooksDefault =
    state.activeTab === DEFAULT_ACTIVE_TAB || state.activeTab === "files"
  return (
    openLooksDefault &&
    state.width === DEFAULT_WIDTH &&
    tabLooksDefault &&
    state.pendingRevealPath === null &&
    state.fileTreeExpandedPaths.length === 0 &&
    state.fileTreeFocusedPath === null &&
    state.fileTreeScrollTop === 0
  )
}

// The tabs sit on the vertical rail at the panel's right edge, below the fixed
// top-right window-chrome overlay (terminal/aux/settings), so they need no
// extra width to clear it. The minimum only has to keep that overlay — and, on
// Windows/Linux, the native caption strip beside it (~116 + 138) — from
// spilling past the panel's left edge over the middle column. Elsewhere the
// base 200 is plenty.
function resolveAuxMinWidth(): number {
  const platform = detectPlatform()
  if (isDesktop() && (platform === "windows" || platform === "linux")) {
    return 260
  }
  return MIN_WIDTH
}

interface AuxPanelContextValue {
  isOpen: boolean
  restored: boolean
  width: number
  minWidth: number
  maxWidth: number
  activeTab: AuxPanelTab
  activeScopeId: WorkspaceScopeId
  toggle: () => void
  /** Imperatively set the panel open/closed (used by the chat-mode auto-hide). */
  setOpen: (open: boolean) => void
  setWidth: (w: number) => void
  setActiveTab: (tab: AuxPanelTab) => void
  openTab: (tab: AuxPanelTab) => void
  pendingRevealPath: string | null
  revealInFileTree: (path: string) => void
  consumePendingRevealPath: (scopeId?: WorkspaceScopeId, path?: string) => void
  fileTreeExpandedPaths: string[]
  fileTreeFocusedPath: string | null
  fileTreeScrollTop: number
  patchFileTreeState: (
    scopeId: WorkspaceScopeId,
    patch: AuxPanelFileTreePatch
  ) => void
}

const AuxPanelContext = createContext<AuxPanelContextValue | null>(null)

export function useAuxPanelContext() {
  const ctx = useContext(AuxPanelContext)
  if (!ctx) {
    throw new Error("useAuxPanelContext must be used within AuxPanelProvider")
  }
  return ctx
}

function clampWidth(width: number, minWidth: number) {
  return Math.max(minWidth, Math.min(MAX_WIDTH, width))
}

interface AuxPanelProviderProps {
  children: ReactNode
}

export function AuxPanelProvider({ children }: AuxPanelProviderProps) {
  const storageKey = STORAGE_KEY
  const [restored, setRestored] = useState(false)
  const importedLegacyStateRef = useRef(false)
  const hadPersistedWorkbenchStateRef = useRef(hasPersistedWorkbenchState())
  const activeScopeId = useWorkbenchStore((s) => s.activeScopeId)
  const hydrated = useWorkbenchStore((s) => s.hydrated)
  const rightPanelState = useWorkbenchStore(
    (s) => s.workspaces[String(s.activeScopeId)]?.rightPanelState
  )
  const patchRightPanel = useWorkbenchStore((s) => s.patchRightPanel)
  // Platform-derived minimum (see resolveAuxMinWidth); stable for the session.
  const minWidth = useMemo(() => resolveAuxMinWidth(), [])

  const isOpen = restored
    ? (rightPanelState?.isOpen ?? DEFAULT_IS_OPEN)
    : DEFAULT_IS_OPEN
  const width = clampWidth(rightPanelState?.width ?? DEFAULT_WIDTH, minWidth)
  const activeTab: AuxPanelTab = normalizeActiveTab(rightPanelState?.activeTab)
  const pendingRevealPath = rightPanelState?.pendingRevealPath ?? null
  const fileTreeExpandedPaths =
    rightPanelState?.fileTreeExpandedPaths ?? EMPTY_FILE_TREE_EXPANDED_PATHS
  const fileTreeFocusedPath = rightPanelState?.fileTreeFocusedPath ?? null
  const fileTreeScrollTop = rightPanelState?.fileTreeScrollTop ?? 0

  const toggle = useCallback(() => {
    patchRightPanel(activeScopeId, { isOpen: !isOpen })
  }, [activeScopeId, isOpen, patchRightPanel])

  const setOpen = useCallback(
    (open: boolean) => {
      patchRightPanel(activeScopeId, { isOpen: open })
    },
    [activeScopeId, patchRightPanel]
  )

  const setWidth = useCallback(
    (w: number) => {
      patchRightPanel(activeScopeId, { width: clampWidth(w, minWidth) })
    },
    [activeScopeId, minWidth, patchRightPanel]
  )

  const setActiveTab = useCallback(
    (tab: AuxPanelTab) => {
      patchRightPanel(activeScopeId, { activeTab: tab })
    },
    [activeScopeId, patchRightPanel]
  )

  const openTab = useCallback(
    (tab: AuxPanelTab) => {
      patchRightPanel(activeScopeId, { activeTab: tab, isOpen: true })
    },
    [activeScopeId, patchRightPanel]
  )

  const revealInFileTree = useCallback(
    (path: string) => {
      patchRightPanel(activeScopeId, {
        pendingRevealPath: path,
        activeTab: "file_tree",
        isOpen: true,
      })
    },
    [activeScopeId, patchRightPanel]
  )

  const consumePendingRevealPath = useCallback(
    (scopeId: WorkspaceScopeId = activeScopeId, path?: string) => {
      const state = useWorkbenchStore.getState()
      const current =
        state.workspaces[String(scopeId)]?.rightPanelState?.pendingRevealPath ??
        null
      if (path !== undefined && current !== path) return
      patchRightPanel(scopeId, { pendingRevealPath: null })
    },
    [activeScopeId, patchRightPanel]
  )

  useEffect(() => {
    if (!hydrated || importedLegacyStateRef.current) return
    const workspace =
      useWorkbenchStore.getState().workspaces[String(activeScopeId)]
    if (!workspace || workspace.tabRefs.length === 0) return

    importedLegacyStateRef.current = true
    const hadWorkbenchState = hadPersistedWorkbenchStateRef.current
    const stored = hadWorkbenchState
      ? null
      : loadPersistedPanelState(storageKey)
    const current = workspace.rightPanelState
    if (!hadWorkbenchState && stored && shouldSeedLegacyPanelState(current)) {
      const isMobileViewport = window.innerWidth < 768
      const defaultOpen = isMobileViewport ? false : DEFAULT_IS_OPEN
      patchRightPanel(activeScopeId, {
        isOpen: isMobileViewport ? false : (stored.isOpen ?? defaultOpen),
        width: clampWidth(stored.width ?? DEFAULT_WIDTH, minWidth),
        activeTab: normalizeActiveTab(current.activeTab),
      })
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestored(true)
  }, [activeScopeId, hydrated, minWidth, patchRightPanel, storageKey])

  const patchFileTreeState = useCallback(
    (scopeId: WorkspaceScopeId, patch: AuxPanelFileTreePatch) => {
      patchRightPanel(scopeId, patch)
    },
    [patchRightPanel]
  )

  const value = useMemo<AuxPanelContextValue>(
    () => ({
      isOpen,
      restored,
      width,
      minWidth,
      maxWidth: MAX_WIDTH,
      activeTab,
      activeScopeId,
      toggle,
      setOpen,
      setWidth,
      setActiveTab,
      openTab,
      pendingRevealPath,
      revealInFileTree,
      consumePendingRevealPath,
      fileTreeExpandedPaths,
      fileTreeFocusedPath,
      fileTreeScrollTop,
      patchFileTreeState,
    }),
    [
      isOpen,
      restored,
      width,
      minWidth,
      activeTab,
      activeScopeId,
      toggle,
      setOpen,
      setWidth,
      setActiveTab,
      openTab,
      pendingRevealPath,
      revealInFileTree,
      consumePendingRevealPath,
      fileTreeExpandedPaths,
      fileTreeFocusedPath,
      fileTreeScrollTop,
      patchFileTreeState,
    ]
  )

  return (
    <AuxPanelContext.Provider value={value}>
      {children}
    </AuxPanelContext.Provider>
  )
}
