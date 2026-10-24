"use client"

import { useState } from "react"
import {
  FileText,
  GitCompareArrows,
  Globe,
  MessageSquare,
  Maximize2,
  Minimize2,
  Plus,
  X,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useTabActions, useTabStore } from "@/contexts/tab-context"
import {
  useWorkspaceActions,
  useWorkspaceView,
} from "@/contexts/workspace-context"
import { useFileWorkspaceStore } from "@/stores/file-workspace-store"
import { useWorkbenchStore } from "@/stores/workbench-store"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import type { WorkbenchTabRef, WorkspaceScopeId } from "@/types/workbench"
import {
  tabBelongsToPane,
  workbenchPaneLayout,
} from "@/lib/workbench-pane-layout"
import { cn } from "@/lib/utils"
import { WorkbenchConversationHistory } from "@/components/workbench/workbench-conversation-history"
import { leafIds } from "@/lib/tab-group-layout"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

export function activateWorkbenchTab(
  scopeId: WorkspaceScopeId,
  tab: WorkbenchTabRef
) {
  const workbench = useWorkbenchStore.getState()
  workbench.activateTab(scopeId, tab.id)
  if (tab.type === "conversation")
    useTabStore.getState().switchTab(tab.entityId)
}

export function WorkbenchTabBar({
  scopeId,
  groupId,
  tabs,
  selectedTabId,
  pane,
}: {
  scopeId: WorkspaceScopeId
  groupId: string
  tabs: WorkbenchTabRef[]
  selectedTabId?: string
  pane?: "conversation" | "files"
}) {
  const t = useTranslations("Workbench")
  const tLegacy = useTranslations("Folder.conversationCard")
  const view = useWorkspaceView()
  const workspace = useWorkbenchStore((s) => s.workspaces[String(scopeId)])
  const conversations = useTabStore((s) => s.allTabs)
  const files = useFileWorkspaceStore((s) => s.fileTabs)
  const { closeTab, openNewConversationTab, openChatModeTab, pinTab } =
    useTabActions()
  const { closeFileTab, toggleFilesMaximized, toggleConversationMaximized } =
    useWorkspaceActions()
  const maximized =
    pane === "files" ? view.filesMaximized : view.conversationMaximized
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const selected = selectedTabId ?? workspace?.groupSelection[groupId]
  const close = (tab: WorkbenchTabRef) => {
    // Entity close actions own dirty confirmation and runtime cleanup.
    useWorkbenchStore.getState().activateScope(scopeId)
    if (tab.type === "conversation") closeTab(tab.entityId)
    else closeFileTab(tab.entityId)
  }
  const addConversation = () => {
    useWorkbenchStore.getState().focusGroup(scopeId, groupId)
    const folder =
      typeof scopeId === "number"
        ? useAppWorkspaceStore.getState().getFolder(scopeId)
        : null
    if (folder)
      openNewConversationTab(folder.id, folder.path, { targetGroup: groupId })
    else openChatModeTab({ targetGroup: groupId })
  }
  const drop = (event: React.DragEvent, index: number) => {
    event.preventDefault()
    setDropIndex(null)
    try {
      const payload: unknown = JSON.parse(
        event.dataTransfer.getData("application/x-codeg-workbench-tab")
      )
      if (!payload || typeof payload !== "object") return
      const value = payload as { scopeId?: unknown; tabId?: unknown }
      if (value.scopeId !== scopeId || typeof value.tabId !== "string") return
      const current = useWorkbenchStore.getState().workspaces[String(scopeId)]
      const moving = current?.tabRefs.find((tab) => tab.id === value.tabId)
      if (!current || !moving || (pane && !tabBelongsToPane(moving, pane)))
        return
      const beforeId = tabs[index]?.id
      if (beforeId === moving.id) return
      const members = current.tabRefs.filter(
        (tab) => current.groupOf[tab.id] === groupId && tab.id !== moving.id
      )
      const peers = members.filter(
        (tab) => !pane || tabBelongsToPane(tab, pane)
      )
      const lastPeer = peers[peers.length - 1]
      const targetIndex = beforeId
        ? members.findIndex((tab) => tab.id === beforeId)
        : lastPeer
          ? members.findIndex((tab) => tab.id === lastPeer.id) + 1
          : members.length
      useWorkbenchStore
        .getState()
        .moveTab(scopeId, value.tabId, groupId, targetIndex)
    } catch {
      /* Foreign drags cannot move workspace tabs. */
    }
  }
  const split = (tab: WorkbenchTabRef, direction: "right" | "down") => {
    const st = useWorkbenchStore.getState()
    if (tab.type === "conversation") {
      st.activateScope(scopeId)
      useTabStore.getState().splitTab(tab.entityId, direction, { move: false })
      return
    }
    // Splitting a sole tab leaves a useful empty group for opening a document.
    const target = st.split(scopeId, groupId, direction, "files")
    if (target) st.moveTab(scopeId, tab.id, target)
  }
  return (
    <div
      role="tablist"
      aria-label={t("tabs")}
      className="flex h-10 min-w-0 flex-1 items-stretch overflow-x-auto bg-muted ws-transparent-bg"
      data-workbench-group={groupId}
      onDragOver={(event) => {
        if (
          event.dataTransfer.types.includes("application/x-codeg-workbench-tab")
        )
          event.preventDefault()
      }}
      onDrop={(event) => drop(event, tabs.length)}
    >
      {pane === "conversation" && (
        <WorkbenchConversationHistory scopeId={scopeId} groupId={groupId} />
      )}
      {tabs.map((tab, index) => {
        const conversation = conversations.find(
          (item) => item.id === tab.entityId
        )
        const file = files.find((item) => item.id === tab.entityId)
        const title = conversation?.title ?? file?.title ?? t("loading")
        const Icon =
          tab.type === "conversation"
            ? MessageSquare
            : tab.type === "diff"
              ? GitCompareArrows
              : tab.type === "browser"
                ? Globe
                : FileText
        return (
          <ContextMenu key={tab.id}>
            <ContextMenuTrigger asChild>
              <div
                className={cn(
                  "relative flex shrink-0 items-center border-r border-border/30",
                  dropIndex === index && "border-l-2 border-l-primary"
                )}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move"
                  event.dataTransfer.setData(
                    "application/x-codeg-workbench-tab",
                    JSON.stringify({ scopeId, tabId: tab.id })
                  )
                }}
                onDragEnd={() => setDropIndex(null)}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setDropIndex(index)
                }}
                onDragLeave={() => setDropIndex(null)}
                onDrop={(event) => {
                  event.stopPropagation()
                  drop(event, index)
                }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected === tab.id}
                  tabIndex={selected === tab.id ? 0 : -1}
                  title={file?.path ?? title}
                  onClick={() => activateWorkbenchTab(scopeId, tab)}
                  onDoubleClick={() => {
                    if (conversation) pinTab(conversation.id)
                  }}
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      event.preventDefault()
                      close(tab)
                    }
                  }}
                  onKeyDown={(event) => {
                    const offset =
                      event.key === "ArrowRight"
                        ? 1
                        : event.key === "ArrowLeft"
                          ? -1
                          : 0
                    if (!offset || tabs.length < 2) return
                    event.preventDefault()
                    const next =
                      tabs[(index + offset + tabs.length) % tabs.length]
                    activateWorkbenchTab(scopeId, next)
                    const host = event.currentTarget.closest('[role="tablist"]')
                    const buttons =
                      host?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                    buttons?.[
                      (index + offset + tabs.length) % tabs.length
                    ]?.focus()
                  }}
                  className={cn(
                    "flex h-full max-w-56 items-center gap-2 px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    selected === tab.id
                      ? "bg-background text-foreground ws-transparent-bg"
                      : "text-muted-foreground hover:bg-background/50",
                    conversation && !conversation.isPinned && "italic"
                  )}
                >
                  <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{title}</span>
                  {file?.isDirty && (
                    <span
                      aria-label={t("unsaved")}
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                    />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={t("closeTab", { title })}
                  onClick={() => close(tab)}
                  className="mr-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X aria-hidden className="h-3 w-3" />
                </button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => split(tab, "right")}>
                {t("splitRight")}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => split(tab, "down")}>
                {t("splitDown")}
              </ContextMenuItem>
              {workspace &&
                leafIds(
                  pane
                    ? workbenchPaneLayout(workspace, pane)
                    : workspace.groupLayout
                )
                  .filter((id) => id !== groupId)
                  .map((id, i) => (
                    <ContextMenuItem
                      key={id}
                      onSelect={() =>
                        useWorkbenchStore
                          .getState()
                          .moveTab(scopeId, tab.id, id)
                      }
                    >
                      {t("moveToGroup", { index: i + 1 })}
                    </ContextMenuItem>
                  ))}
              {tab.type === "conversation" && (
                <ContextMenuItem
                  onSelect={() =>
                    useWorkbenchStore
                      .getState()
                      .toggleGroupTile(scopeId, groupId)
                  }
                >
                  {t("tileConversations")}
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => close(tab)}>
                {t("close")}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() =>
                  tabs.filter((item) => item.id !== tab.id).forEach(close)
                }
              >
                {t("closeOthers")}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => tabs.forEach(close)}>
                {t("closeGroupTabs")}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() =>
                  useWorkbenchStore
                    .getState()
                    .dissolveGroup(scopeId, groupId, pane)
                }
              >
                {t("mergeGroup")}
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() =>
                  useWorkbenchStore.getState().unsplitAll(scopeId, pane)
                }
              >
                {t("mergeAll")}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
      {pane !== "files" && (
        <button
          type="button"
          aria-label={t("newConversation")}
          title={t("newConversation")}
          className="shrink-0 px-2 text-muted-foreground hover:text-foreground"
          onClick={addConversation}
        >
          <Plus aria-hidden className="h-4 w-4" />
        </button>
      )}
      <div data-tauri-drag-region className="min-w-4 flex-1" />
      {pane && view.mode === "fusion" && (
        <button
          type="button"
          title={maximized ? tLegacy("restore") : tLegacy("maximize")}
          aria-label={maximized ? tLegacy("restore") : tLegacy("maximize")}
          className="shrink-0 px-2 text-muted-foreground hover:text-foreground"
          onClick={
            pane === "files"
              ? toggleFilesMaximized
              : toggleConversationMaximized
          }
        >
          {maximized ? (
            <Minimize2 aria-hidden className="h-4 w-4" />
          ) : (
            <Maximize2 aria-hidden className="h-4 w-4" />
          )}
        </button>
      )}
    </div>
  )
}
