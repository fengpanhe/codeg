"use client"

import { useMemo, useRef, type CSSProperties, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { useWorkbenchStore } from "@/stores/workbench-store"
import { useFileWorkspaceStore } from "@/stores/file-workspace-store"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import type { TabItem } from "@/stores/tab-store"
import type { WorkbenchPane, WorktreeWorkspaceState } from "@/types/workbench"
import {
  computeRects,
  leafIds,
  type GroupRect,
  type HandleRect,
} from "@/lib/tab-group-layout"
import {
  useWorkspaceActions,
  useWorkspaceView,
} from "@/contexts/workspace-context"
import { OverlayHostHiddenProvider } from "@/components/ui/overlay-host-hidden"
import { useSidebarContext } from "@/contexts/sidebar-context"
import { useAuxPanelContext } from "@/contexts/aux-panel-context"
import { usePlatform } from "@/hooks/use-platform"
import { useIsMobile } from "@/hooks/use-mobile"
import { useZoomLevel } from "@/hooks/use-appearance"
import { isDesktop } from "@/lib/platform"
import { leftChromeReserve, rightChromeReserve } from "@/lib/window-chrome"
import { ChromeReserve } from "@/components/layout/chrome-reserve"
import { GroupSplitHandle } from "@/components/conversations/group-split-handle"
import { ConversationDetailHeader } from "@/components/conversations/conversation-detail-header"
import { FileWorkspacePanel } from "@/components/files/file-workspace-panel"
import { FileWorkspaceHeader } from "@/components/files/file-workspace-header"
import { WorkbenchTabBar } from "./workbench-tab-bar"
import { cn } from "@/lib/utils"
import {
  paneSelectedTabId,
  paneTabRefs,
  workbenchPaneGroup,
  workbenchPaneLayout,
} from "@/lib/workbench-pane-layout"
import {
  classicGroup,
  classicSelectedTabId,
  classicTabRefs,
} from "@/lib/workbench-classic-projection"

export interface ConversationSurfaceState {
  groupId: string
  isVisible: boolean
  isActive: boolean
}

interface WorkbenchSurfaceProps {
  conversations: TabItem[]
  renderConversation: (
    tab: TabItem,
    state: ConversationSurfaceState
  ) => ReactNode
}

const FULL_RECT = { x: 0, y: 0, w: 100, h: 100 }

function bodyStyle(rect: GroupRect): CSSProperties {
  return {
    left: `${rect.x}%`,
    top: `calc(${rect.y}% + 2.5rem)`,
    width: `${rect.w}%`,
    height: `calc(${rect.h}% - 2.5rem)`,
  }
}

/**
 * Every conversation view is a direct, stably keyed sibling in this canvas.
 * Workspace switches, split changes, and UI-mode switches only change its box
 * and visibility. They never unmount or reparent a live conversation.
 */
export function WorkbenchSurface({
  conversations,
  renderConversation,
}: WorkbenchSurfaceProps) {
  const t = useTranslations("Workbench")
  const workspaces = useWorkbenchStore((s) => s.workspaces)
  const scopeId = useWorkbenchStore((s) => s.activeScopeId)
  const uiMode = useWorkbenchStore((s) => s.uiMode)
  const workspace = workspaces[String(scopeId)]
  const fileEntityIds = useFileWorkspaceStore((s) =>
    s.fileTabs.map((tab) => tab.id).join("\n")
  )
  const liveFileIds = useMemo(
    () => new Set(fileEntityIds.split("\n")),
    [fileEntityIds]
  )
  const recoveryStatus = useFileWorkspaceStore((s) => s.recoveryStatus)
  const allFolders = useAppWorkspaceStore((s) => s.allFolders)
  const { mode, activePane, filesMaximized, conversationMaximized } =
    useWorkspaceView()
  const { setActivePane } = useWorkspaceActions()
  const mobile = useIsMobile()
  const { isOpen: sidebarOpen } = useSidebarContext()
  const { isOpen: auxOpen } = useAuxPanelContext()
  const { isMac, isWindows, isLinux } = usePlatform()
  const { zoomLevel } = useZoomLevel()
  const containerRef = useRef<HTMLDivElement>(null)
  const paneLayouts = useMemo(
    () =>
      workspace
        ? {
            conversation: computeRects(
              workbenchPaneLayout(workspace, "conversation")
            ),
            files: computeRects(workbenchPaneLayout(workspace, "files")),
          }
        : null,
    [workspace]
  )
  const classic = uiMode === "classic"
  const classicRatio = workspace?.classicRatio ?? 0.56
  const classicConversationRect = { x: 0, y: 0, w: classicRatio * 100, h: 100 }
  const classicFilesRect = {
    x: classicRatio * 100,
    y: 0,
    w: (1 - classicRatio) * 100,
    h: 100,
  }
  const convGroup = workspace
    ? classicGroup(workspace, "conversation")
    : "g-main"
  const fileGroup = workspace ? classicGroup(workspace, "files") : "g-main"
  const convTabs = workspace ? classicTabRefs(workspace, "conversation") : []
  const fileTabs = workspace ? classicTabRefs(workspace, "files") : []
  const convSelected = workspace
    ? classicSelectedTabId(workspace, "conversation")
    : undefined
  const fileSelected = workspace
    ? classicSelectedTabId(workspace, "files")
    : undefined
  const classicConvVisible =
    !filesMaximized &&
    (!mobile || mode === "conversation" || activePane === "conversation")
  const classicFileVisible =
    !conversationMaximized &&
    mode === "fusion" &&
    (!mobile || activePane === "files")
  const classicConvRect =
    mode === "conversation" || conversationMaximized || mobile
      ? FULL_RECT
      : classicConversationRect
  const classicFileRect =
    filesMaximized || mobile ? FULL_RECT : classicFilesRect
  const paneRect = (pane: WorkbenchPane) =>
    pane === "conversation" ? classicConvRect : classicFileRect
  const paneVisible = (pane: WorkbenchPane) =>
    pane === "conversation" ? classicConvVisible : classicFileVisible
  const withinPane = (rect: GroupRect, pane: WorkbenchPane): GroupRect => {
    const outer = paneRect(pane)
    return {
      x: outer.x + (rect.x * outer.w) / 100,
      y: outer.y + (rect.y * outer.h) / 100,
      w: (rect.w * outer.w) / 100,
      h: (rect.h * outer.h) / 100,
    }
  }
  const paneHandle = (handle: HandleRect, pane: WorkbenchPane): HandleRect => {
    const outer = paneRect(pane)
    const horizontal = handle.orientation === "horizontal"
    const start = horizontal ? outer.x : outer.y
    const extent = horizontal ? outer.w : outer.h
    return {
      ...handle,
      x: outer.x + (handle.x * outer.w) / 100,
      y: outer.y + (handle.y * outer.h) / 100,
      length: (handle.length * (horizontal ? outer.h : outer.w)) / 100,
      nodeStart: start + (handle.nodeStart * extent) / 100,
      nodeExtent: (handle.nodeExtent * extent) / 100,
    }
  }
  const positions = (
    ws: WorktreeWorkspaceState,
    tabId: string,
    type: WorkbenchPane
  ) => {
    const groupId = ws.groupOf[tabId] ?? leafIds(ws.groupLayout)[0]
    const current = ws.scopeId === scopeId
    const rect = paneLayouts?.[type].groups.get(groupId) ?? FULL_RECT
    const selected = classic
      ? type === "conversation"
        ? convSelected
        : fileSelected
      : paneSelectedTabId(ws, type, groupId)
    let visible = current && paneVisible(type) && selected === tabId
    let box = classic || mobile ? paneRect(type) : withinPane(rect, type)
    if (!classic && mobile) {
      visible = visible && groupId === workbenchPaneGroup(ws, type)
    }
    if (
      type === "conversation" &&
      !mobile &&
      ws.tileByGroup[groupId] &&
      paneVisible(type)
    ) {
      const members = paneTabRefs(ws, type, groupId)
      if (members.length > 1) {
        visible = current && (!classic || groupId === convGroup)
        const index = members.findIndex((ref) => ref.id === tabId)
        box = {
          ...box,
          x: box.x + (box.w * index) / members.length,
          w: box.w / members.length,
        }
      }
    }
    return {
      groupId,
      visible,
      rect: box,
      active:
        visible &&
        groupId === ws.focusedGroupId &&
        ws.groupSelection[groupId] === tabId,
    }
  }
  const strips = (["conversation", "files"] as const).flatMap((pane) => {
    if (!workspace || !paneVisible(pane)) return []
    if (classic) {
      return [
        {
          key: `classic-${pane}`,
          pane,
          groupId: pane === "conversation" ? convGroup : fileGroup,
          tabs: pane === "conversation" ? convTabs : fileTabs,
          selectedTabId: pane === "conversation" ? convSelected : fileSelected,
          rect: paneRect(pane),
        },
      ]
    }
    const groups = paneLayouts?.[pane].groups ?? new Map<string, GroupRect>()
    return [...groups]
      .filter(([id]) => !mobile || id === workbenchPaneGroup(workspace, pane))
      .map(([groupId, rect]) => ({
        key: `${pane}:${groupId}`,
        pane,
        groupId,
        tabs: paneTabRefs(workspace, pane, groupId),
        selectedTabId: paneSelectedTabId(workspace, pane, groupId),
        rect: mobile ? paneRect(pane) : withinPane(rect, pane),
      }))
  })
  const focusTab = (
    ws: WorktreeWorkspaceState,
    tabId: string,
    pane: WorkbenchPane
  ) => {
    setActivePane(pane)
    useWorkbenchStore.getState().activateTab(ws.scopeId, tabId)
  }
  const focusStrip = (groupId: string, pane: WorkbenchPane) => {
    setActivePane(pane)
    useWorkbenchStore.getState().focusGroup(scopeId, groupId)
  }
  const stableConversations = useMemo(
    () => [...conversations].sort((a, b) => a.id.localeCompare(b.id)),
    [conversations]
  )
  const fileSurfaces = Object.values(workspaces)
    .flatMap((ws) =>
      ws.tabRefs
        .filter((tab) => tab.type !== "conversation")
        .map((tab) => ({ ws, tab }))
    )
    .sort((a, b) =>
      `${a.ws.scopeId}:${a.tab.id}`.localeCompare(`${b.ws.scopeId}:${b.tab.id}`)
    )

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-workbench-mode={uiMode}
    >
      {(recoveryStatus.state === "error" ||
        recoveryStatus.state === "unavailable") && (
        <div
          role="alert"
          title={recoveryStatus.message}
          className="shrink-0 border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {t("recoveryUnavailable")}
        </div>
      )}
      {mobile &&
        !classic &&
        workspace &&
        (["conversation", "files"] as const).filter(paneVisible).map((pane) => {
          const groups = [...(paneLayouts?.[pane].groups.keys() ?? [])]
          if (groups.length < 2) return null
          return (
            <div
              key={pane}
              className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1"
              aria-label={t("groups")}
              data-workspace-pane={pane}
            >
              {groups.map((id, index) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={id === workbenchPaneGroup(workspace, pane)}
                  className="shrink-0 rounded px-2 py-1 text-xs hover:bg-accent aria-pressed:bg-accent"
                  onClick={() => focusStrip(id, pane)}
                >
                  {t("group", { index: index + 1 })}
                </button>
              ))}
            </div>
          )
        })}
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden"
      >
        {strips.map((strip) => (
          <div
            key={strip.key}
            data-workspace-pane={strip.pane}
            data-workbench-scope-id={scopeId}
            onPointerDownCapture={() => focusStrip(strip.groupId, strip.pane)}
            onFocusCapture={() => focusStrip(strip.groupId, strip.pane)}
            className="absolute z-10 flex h-10 overflow-hidden"
            style={{
              left: `${strip.rect.x}%`,
              top: `${strip.rect.y}%`,
              width: `${strip.rect.w}%`,
            }}
          >
            {!mobile && strip.rect.y === 0 && strip.rect.x === 0 && (
              <ChromeReserve
                width={
                  sidebarOpen
                    ? 0
                    : leftChromeReserve(isMac && isDesktop(), zoomLevel)
                }
                line={false}
              />
            )}
            <WorkbenchTabBar
              scopeId={scopeId}
              groupId={strip.groupId}
              tabs={strip.tabs}
              pane={strip.pane}
              selectedTabId={strip.selectedTabId}
            />
            {!mobile &&
              strip.rect.y === 0 &&
              strip.rect.x + strip.rect.w === 100 && (
                <ChromeReserve
                  width={
                    auxOpen
                      ? 0
                      : rightChromeReserve(
                          isDesktop() && (isWindows || isLinux),
                          zoomLevel
                        )
                  }
                  line={false}
                />
              )}
          </div>
        ))}
        {stableConversations.map((tab) => {
          const ws = Object.values(workspaces).find((item) =>
            item.tabRefs.some(
              (ref) => ref.type === "conversation" && ref.entityId === tab.id
            )
          )
          const position = ws
            ? positions(ws, tab.id, "conversation")
            : {
                groupId: "g-main",
                visible: false,
                active: false,
                rect: FULL_RECT,
              }
          const folder = allFolders.find((item) => item.id === tab.folderId)
          return (
            <div
              key={`conversation:${tab.id}`}
              className={cn(
                "absolute flex min-h-0 flex-col overflow-hidden",
                !position.visible &&
                  "conversation-tab-hidden invisible pointer-events-none"
              )}
              style={bodyStyle(position.rect)}
              aria-hidden={!position.visible}
              inert={!position.visible || undefined}
              data-workspace-pane="conversation"
              data-workbench-tab-id={tab.id}
              data-workbench-scope-id={ws?.scopeId}
              onPointerDownCapture={() => {
                if (position.visible && ws) focusTab(ws, tab.id, "conversation")
              }}
              onFocusCapture={() => {
                if (position.visible && ws) focusTab(ws, tab.id, "conversation")
              }}
            >
              <OverlayHostHiddenProvider hidden={!position.visible}>
                <ConversationDetailHeader
                  tabId={tab.id}
                  conversationId={tab.conversationId}
                  runtimeConversationId={tab.runtimeConversationId ?? null}
                  folderId={tab.folderId}
                  folderPath={folder?.path}
                  title={tab.title}
                  status={tab.status}
                />
                <div className="min-h-0 flex-1 overflow-hidden">
                  {position.active &&
                    workspace &&
                    (leafIds(workspace.groupLayout).length > 1 ||
                      workspace.tileByGroup[position.groupId]) && (
                      <span className="sr-only">{t("activeConversation")}</span>
                    )}
                  {renderConversation(tab, {
                    groupId: position.groupId,
                    isVisible: position.visible,
                    isActive: position.active,
                  })}
                </div>
              </OverlayHostHiddenProvider>
            </div>
          )
        })}
        {fileSurfaces.map(({ ws, tab }) => {
          const position = positions(ws, tab.id, "files")
          if (!liveFileIds.has(tab.entityId)) return null
          return (
            <div
              key={`file:${ws.scopeId}:${tab.id}`}
              className={cn(
                "absolute flex min-h-0 flex-col overflow-hidden",
                !position.visible &&
                  "conversation-tab-hidden invisible pointer-events-none"
              )}
              style={bodyStyle(position.rect)}
              aria-hidden={!position.visible}
              inert={!position.visible || undefined}
              data-workspace-pane="files"
              data-workbench-tab-id={tab.id}
              data-workbench-scope-id={ws.scopeId}
              onPointerDownCapture={() => {
                if (position.visible) focusTab(ws, tab.id, "files")
              }}
              onFocusCapture={() => {
                if (position.visible) focusTab(ws, tab.id, "files")
              }}
            >
              <OverlayHostHiddenProvider hidden={!position.visible}>
                <FileWorkspaceHeader tabId={tab.entityId} />
                <div className="min-h-0 flex-1 overflow-hidden">
                  <FileWorkspacePanel
                    tabId={tab.entityId}
                    scopeId={ws.scopeId}
                    groupId={position.groupId}
                    isVisible={position.visible}
                  />
                </div>
              </OverlayHostHiddenProvider>
            </div>
          )
        })}
        {strips
          .filter((strip) => strip.tabs.length === 0)
          .map((strip) => (
            <div
              key={`empty:${strip.key}`}
              role="region"
              tabIndex={0}
              aria-label={t("emptyGroup")}
              className="absolute flex items-center justify-center p-4 text-center text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              style={bodyStyle(strip.rect)}
              onPointerDown={() => focusStrip(strip.groupId, strip.pane)}
              onFocus={() => focusStrip(strip.groupId, strip.pane)}
            >
              {t("emptyGroup")}
            </div>
          ))}
        {!mobile &&
          mode === "fusion" &&
          !filesMaximized &&
          !conversationMaximized && (
            <GroupSplitHandle
              handle={{
                splitId: "classic",
                index: 0,
                orientation: "horizontal",
                x: classicRatio * 100,
                y: 0,
                length: 100,
                nodeStart: 0,
                nodeExtent: 100,
              }}
              containerRef={containerRef}
              onResize={(_id, _index, fraction) =>
                useWorkbenchStore.getState().setClassicRatio(scopeId, fraction)
              }
            />
          )}
        {!classic &&
          !mobile &&
          paneLayouts &&
          (["conversation", "files"] as const)
            .filter(paneVisible)
            .flatMap((pane) =>
              paneLayouts[pane].handles.map((handle) => (
                <GroupSplitHandle
                  key={`${pane}:${handle.splitId}:${handle.index}`}
                  handle={paneHandle(handle, pane)}
                  containerRef={containerRef}
                  onResize={(id, index, fraction) =>
                    useWorkbenchStore
                      .getState()
                      .resizePaneSplit(scopeId, pane, id, index, fraction)
                  }
                />
              ))
            )}
      </div>
    </div>
  )
}
