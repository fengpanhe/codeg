"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, History, RefreshCw, Search } from "lucide-react"
import { useTranslations } from "next-intl"

import { useTabActions } from "@/contexts/tab-context"
import { listAllConversations } from "@/lib/api"
import { getAgentLabel } from "@/lib/custom-agents"
import { formatConversationTitle } from "@/lib/conversation-title"
import type { DbConversationSummary, FolderDetail } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useWorktreeTabsStore } from "@/stores/worktree-tabs-store"
import { scopeIdForFolder, type WorkspaceScopeId } from "@/types/workbench"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface HistoryScope {
  folderIds: number[]
  disabled: boolean
}

type HistoryRange = "current" | "project"

function projectFolderIds(scopeId: WorkspaceScopeId, folders: FolderDetail[]) {
  if (scopeId === "global") {
    return folders.filter((folder) => folder.kind === "chat").map((f) => f.id)
  }
  const current = folders.find((folder) => folder.id === scopeId)
  if (!current) return [scopeId]
  const rootId = current.parent_id ?? current.id
  return folders
    .filter((folder) => folder.id === rootId || folder.parent_id === rootId)
    .map((folder) => folder.id)
}

function resolveHistoryScope(
  scopeId: WorkspaceScopeId,
  folders: FolderDetail[],
  range: HistoryRange
): HistoryScope {
  if (scopeId === "global") {
    const folderIds = folders
      .filter((folder) => folder.kind === "chat")
      .map((folder) => folder.id)
    return { folderIds, disabled: folderIds.length === 0 }
  }
  if (range === "current") return { folderIds: [scopeId], disabled: false }
  const folderIds = projectFolderIds(scopeId, folders)
  return { folderIds, disabled: folderIds.length === 0 }
}

function compareUpdatedDesc(
  a: DbConversationSummary,
  b: DbConversationSummary
): number {
  return Date.parse(b.updated_at) - Date.parse(a.updated_at)
}

function displayTitle(conversation: DbConversationSummary, fallback: string) {
  return formatConversationTitle(conversation.title) || fallback
}

function displayDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function WorkbenchConversationHistory(props: {
  scopeId: WorkspaceScopeId
  groupId: string
}): React.ReactNode {
  const { scopeId } = props
  const t = useTranslations("Workbench.History")
  const allFolders = useAppWorkspaceStore((s) => s.allFolders)
  const { openTab } = useTabActions()
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState<HistoryRange>("current")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [results, setResults] = useState<DbConversationSummary[]>([])
  const [retryTick, setRetryTick] = useState(0)
  const requestIdRef = useRef(0)

  const effectiveRange = scopeId === "global" ? "current" : range
  const historyScope = useMemo(
    () => resolveHistoryScope(scopeId, allFolders, effectiveRange),
    [allFolders, effectiveRange, scopeId]
  )

  useEffect(() => {
    if (!open) return
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const search = query.trim()
    const timer = window.setTimeout(
      () => {
        if (requestIdRef.current !== requestId) return
        setLoading(true)
        setError(null)
        setOpenError(null)
        if (historyScope.disabled) {
          setResults([])
          setLoading(false)
          return
        }
        void listAllConversations({
          folder_ids: historyScope.folderIds,
          include_children: true,
          search: search || null,
          sort_by: "updated_at_desc",
        })
          .then((rows) => {
            if (requestIdRef.current !== requestId) return
            setResults([...rows].sort(compareUpdatedDesc))
          })
          .catch(() => {
            if (requestIdRef.current !== requestId) return
            setResults([])
            setError(t("loadError"))
          })
          .finally(() => {
            if (requestIdRef.current === requestId) setLoading(false)
          })
      },
      search ? 150 : 0
    )
    return () => window.clearTimeout(timer)
  }, [historyScope.disabled, historyScope.folderIds, open, query, retryTick, t])

  const retry = useCallback(() => {
    setRetryTick((tick) => tick + 1)
  }, [])

  const openConversation = useCallback(
    (conversation: DbConversationSummary) => {
      const targetScope = scopeIdForFolder(
        conversation.folder_id,
        conversation.kind === "chat"
      )
      const opened = useWorktreeTabsStore.getState().openWorktree(targetScope)
      if (!opened) {
        setOpenError(t("openRefused"))
        return
      }
      openTab(
        conversation.folder_id,
        conversation.id,
        conversation.agent_type,
        false,
        displayTitle(conversation, t("untitled"))
      )
      setOpen(false)
    },
    [openTab, t]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("trigger")}
          title={t("trigger")}
          className="shrink-0 border-r border-border/30 px-2 text-muted-foreground hover:bg-background/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <History aria-hidden className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 gap-3 rounded-lg p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">{t("title")}</div>
          {scopeId !== "global" && (
            <div className="flex rounded-md border border-border/60 p-0.5">
              {(["current", "project"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={effectiveRange === item}
                  onClick={() => setRange(item)}
                  className={cn(
                    "rounded px-2 py-1 text-xs text-muted-foreground",
                    effectiveRange === item &&
                      "bg-muted text-foreground shadow-sm"
                  )}
                >
                  {t(item)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <Search
            aria-hidden
            className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-8 pl-7 text-xs"
          />
        </div>
        {openError && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            <AlertCircle aria-hidden className="h-3.5 w-3.5" />
            <span>{openError}</span>
          </div>
        )}
        <div className="max-h-80 overflow-y-auto pr-1">
          {loading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {t("loading")}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-xs text-muted-foreground">
              <span>{error}</span>
              <Button type="button" variant="outline" size="xs" onClick={retry}>
                <RefreshCw aria-hidden className="h-3 w-3" />
                {t("retry")}
              </Button>
            </div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {t("empty")}
            </div>
          ) : (
            <div className="space-y-1">
              {results.map((conversation) => {
                const title = displayTitle(conversation, t("untitled"))
                return (
                  <button
                    key={`${conversation.folder_id}:${conversation.agent_type}:${conversation.id}`}
                    type="button"
                    onClick={() => openConversation(conversation)}
                    className="flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="w-full truncate text-sm text-foreground">
                      {title}
                    </span>
                    <span className="flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">
                        {getAgentLabel(conversation.agent_type)}
                      </span>
                      <span aria-hidden>·</span>
                      <span className="truncate">{conversation.status}</span>
                      <span aria-hidden>·</span>
                      <span className="shrink-0">
                        {displayDate(conversation.updated_at)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
