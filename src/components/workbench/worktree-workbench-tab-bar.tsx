"use client"

import { useRef, type KeyboardEvent } from "react"
import { Pin, PinOff, Plus, X, Ellipsis } from "lucide-react"
import { useTranslations } from "next-intl"
import { useWorktreeTabsStore } from "@/stores/worktree-tabs-store"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { formatWorktreeTabLabel } from "@/lib/worktree-tab-label"
import { MAX_WORKTREE_TABS } from "@/lib/worktree-tabs-persistence"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"

export function WorktreeWorkbenchTabBar() {
  const t = useTranslations("Workbench.Outer")
  const tabs = useWorktreeTabsStore((state) => state.tabs)
  const activeId = useWorktreeTabsStore((state) => state.activeTabId)
  const folders = useAppWorkspaceStore((state) => state.allFolders)
  const atCapacity = tabs.length >= MAX_WORKTREE_TABS
  const tabButtons = useRef(new Map<string, HTMLButtonElement>())
  const focusableId = tabs.some((tab) => tab.id === activeId)
    ? activeId
    : tabs[0]?.id

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    let target: number
    switch (event.key) {
      case "ArrowRight":
        target = (index + 1) % tabs.length
        break
      case "ArrowLeft":
        target = (index - 1 + tabs.length) % tabs.length
        break
      case "Home":
        target = 0
        break
      case "End":
        target = tabs.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const tab = tabs[target]
    useWorktreeTabsStore.getState().activateTab(tab.id)
    tabButtons.current.get(tab.id)?.focus()
  }
  return (
    <div
      className="flex h-10 min-w-0 flex-1 items-stretch bg-muted ws-surface-muted"
      data-worktree-workbench-tab-bar
    >
      <div
        role="tablist"
        aria-label={t("tabs")}
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
      >
        {tabs.some((tab) => tab.isPinned) && (
          <span className="flex shrink-0 items-center gap-1 px-2 text-[0.625rem] font-medium text-muted-foreground">
            <Pin aria-hidden className="size-3" />
            {t("pinned")}
          </span>
        )}
        {tabs.map((tab, index) => {
          const label = formatWorktreeTabLabel(
            tab.scopeId,
            folders,
            t("global"),
            t("emptyTab")
          )
          const path =
            typeof tab.scopeId === "number"
              ? folders.find((folder) => folder.id === tab.scopeId)?.path
              : null
          const pinLabel = `${t(tab.isPinned ? "unpin" : "pin")} ${label}`
          const closeLabel = `${t("close")} ${label}`
          return (
            <div
              key={tab.id}
              className={cn(
                "mt-1 flex shrink-0 items-center rounded-t-md border border-b-0 border-border/40",
                tab.id === activeId
                  ? "bg-background text-foreground dark:bg-card ws-surface-card"
                  : "bg-muted text-muted-foreground ws-surface-muted"
              )}
              data-pinned={tab.isPinned}
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === activeId}
                tabIndex={tab.id === focusableId ? 0 : -1}
                ref={(button) => {
                  if (button) tabButtons.current.set(tab.id, button)
                  else tabButtons.current.delete(tab.id)
                }}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                title={path || label}
                className={cn(
                  "h-full max-w-60 truncate bg-transparent px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  !tab.isPinned && "italic"
                )}
                onClick={() =>
                  useWorktreeTabsStore.getState().activateTab(tab.id)
                }
              >
                {label}
              </button>
              <button
                type="button"
                aria-label={pinLabel}
                title={pinLabel}
                className="h-full bg-transparent px-1.5 text-inherit hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() =>
                  useWorktreeTabsStore
                    .getState()
                    .setPinned(tab.id, !tab.isPinned)
                }
              >
                {tab.isPinned ? (
                  <PinOff aria-hidden className="size-3" />
                ) : (
                  <Pin aria-hidden className="size-3" />
                )}
              </button>
              <button
                type="button"
                aria-label={closeLabel}
                title={closeLabel}
                className="h-full bg-transparent px-1.5 text-inherit hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => useWorktreeTabsStore.getState().closeTab(tab.id)}
              >
                <X aria-hidden className="size-3" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${t("menu")} ${label}`}
                    className="mr-1 h-full bg-transparent px-1.5 text-inherit hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <Ellipsis aria-hidden className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onSelect={() =>
                      useWorktreeTabsStore
                        .getState()
                        .setPinned(tab.id, !tab.isPinned)
                    }
                  >
                    {t(tab.isPinned ? "unpin" : "pin")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      useWorktreeTabsStore.getState().closeTab(tab.id)
                    }
                  >
                    {t("close")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        })}
        <div data-tauri-drag-region className="min-w-4 flex-1" />
      </div>
      <button
        type="button"
        aria-label={t("newTab")}
        title={t(atCapacity ? "capacity" : "newTab")}
        disabled={atCapacity}
        className="flex w-9 shrink-0 items-center justify-center hover:bg-accent disabled:opacity-40"
        onClick={() => useWorktreeTabsStore.getState().createEmptyTab()}
      >
        <Plus aria-hidden className="size-4" />
      </button>
    </div>
  )
}
