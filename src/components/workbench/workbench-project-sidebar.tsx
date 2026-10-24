"use client"

import { useState } from "react"
import { Folder, GitBranch } from "lucide-react"
import { useTranslations } from "next-intl"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useSidebarContext } from "@/contexts/sidebar-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useIsMobile } from "@/hooks/use-mobile"
import { usePlatform } from "@/hooks/use-platform"
import { useZoomLevel } from "@/hooks/use-appearance"
import { useWorktreeWorkbenchPresentation } from "@/hooks/use-worktree-workbench-presentation"
import { activateWorkbenchScopeWithOuterTab } from "@/lib/worktree-tabs-navigation"
import { formatWorktreeTabLabel } from "@/lib/worktree-tab-label"
import { leftChromeReserve } from "@/lib/window-chrome"
import { isDesktop } from "@/lib/platform"
import { NewFolderDropdown } from "@/components/layout/new-folder-dropdown"
import { cn } from "@/lib/utils"

export function WorkbenchProjectSidebar() {
  const t = useTranslations("Workbench.Outer")
  const folders = useAppWorkspaceStore((state) => state.folders)
  const allFolders = useAppWorkspaceStore((state) => state.allFolders)
  const { isOpen, toggle } = useSidebarContext()
  const { openConversations } = useWorkbenchRoute()
  const { activeOuterScopeId } = useWorktreeWorkbenchPresentation()
  const mobile = useIsMobile()
  const { isMac } = usePlatform()
  const { zoomLevel } = useZoomLevel()
  const [refused, setRefused] = useState(false)
  const openRoots = new Set(
    folders
      .filter((folder) => folder.kind !== "chat")
      .map((folder) => folder.parent_id ?? folder.id)
  )
  const families = allFolders.filter(
    (folder) =>
      folder.kind !== "chat" && openRoots.has(folder.parent_id ?? folder.id)
  )
  const ordered = [...openRoots].flatMap((id) =>
    families
      .filter((folder) => folder.id === id)
      .concat(families.filter((folder) => folder.parent_id === id))
  )
  if (!isOpen) return null
  return (
    <aside
      className="flex h-full min-h-0 flex-col overflow-hidden text-sidebar-foreground"
      aria-label={t("projects")}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 ws-chrome-border pr-2">
        {!mobile && (
          <div
            data-tauri-drag-region
            className="h-full shrink-0"
            style={{
              width: leftChromeReserve(isMac && isDesktop(), zoomLevel),
            }}
          />
        )}
        <span className="truncate px-2 text-xs font-medium">
          {t("projects")}
        </span>
        <div data-tauri-drag-region className="h-full flex-1" />
        <NewFolderDropdown />
      </div>
      {refused && (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {t("capacity")}
        </p>
      )}
      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {ordered.map((folder) => {
          const label = formatWorktreeTabLabel(
            folder.id,
            allFolders,
            t("global"),
            t("emptyTab")
          )
          const Icon = folder.parent_id == null ? Folder : GitBranch
          return (
            <button
              key={folder.id}
              type="button"
              aria-label={label}
              aria-current={
                activeOuterScopeId === folder.id ? "page" : undefined
              }
              title={folder.path}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-sidebar-accent",
                folder.parent_id != null && "pl-5",
                activeOuterScopeId === folder.id && "bg-sidebar-accent"
              )}
              onClick={() => {
                if (!activateWorkbenchScopeWithOuterTab(folder.id)) {
                  setRefused(true)
                  return
                }
                setRefused(false)
                openConversations()
                if (mobile) toggle()
              }}
            >
              <Icon aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          )
        })}
        {ordered.length === 0 && (
          <p className="p-3 text-xs text-muted-foreground">
            {t("emptyProjects")}
          </p>
        )}
      </nav>
    </aside>
  )
}
