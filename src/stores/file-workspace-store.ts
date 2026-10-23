"use client"

import { create } from "zustand"
import { registerBackendScopedStoreReset } from "@/stores/backend-scoped-store-reset"
import type { FileWorkspaceTab } from "@/contexts/workspace-context"
import {
  isFileWorkspacePersistenceUnavailable,
  rehydrateDirtyFileTabs,
  rehydrateDiffFileTabs,
} from "@/lib/file-workspace-persistence"
import type {
  FileWorkspacePersistenceAdapter,
  FileWorkspaceRecoveryStatus,
  PersistedDirtyFileEntity,
} from "@/lib/file-workspace-persistence"

export interface FileWorkspaceRecoveredRef {
  scopeId: string
  tabId: string
  groupId: string | null
}

type SetState<T> = T | ((prev: T) => T)

function resolveSet<T>(prev: T, next: SetState<T>): T {
  return typeof next === "function" ? (next as (prev: T) => T)(prev) : next
}

export interface FileWorkspaceStoreState {
  fileTabs: FileWorkspaceTab[]
  previewFileTabIds: Set<string>
  recoveryStatus: FileWorkspaceRecoveryStatus
  recoveredRefs: FileWorkspaceRecoveredRef[]

  setFileTabs: (next: SetState<FileWorkspaceTab[]>) => void
  upsertFileTab: (tab: FileWorkspaceTab, options?: { index?: number }) => void
  releaseFileTabEntity: (tabId: string) => void
  setPreviewFileTabIds: (next: SetState<Set<string>>) => void
  getFileTab: (tabId: string) => FileWorkspaceTab | null
  setRecoveryStatus: (status: FileWorkspaceRecoveryStatus) => void
  hydrateDirtyFiles: (adapter: FileWorkspacePersistenceAdapter) => Promise<void>
  getOperationEpoch: () => number
  beginLoad: (tabId: string) => number
  isCurrentLoad: (tabId: string, token: number) => boolean
  settleLoad: (tabId: string, token: number) => boolean
  coordinateSave: (
    tabId: string,
    force: boolean,
    run: (force: boolean) => Promise<boolean>
  ) => Promise<boolean>
  beginSave: (tabId: string) => number
  isCurrentSave: (tabId: string, token: number) => boolean
  settleSave: (tabId: string, token: number) => boolean
  reset: () => void
}

function refsFromEntries(
  entries: ReadonlyArray<Pick<PersistedDirtyFileEntity, "refs">>
): FileWorkspaceRecoveredRef[] {
  return entries.flatMap((entry) => entry.refs)
}

let recoveryEpoch = 0
let nextOperationToken = 0
let operationEpoch = 0
const loadTokens = new Map<string, number>()
const saveTokens = new Map<string, number>()
// Shared across every provider/placement of the physical file entity.
const pendingSaves = new Map<
  string,
  {
    content: string
    force: boolean
    queued: boolean
    queuedForce: boolean
    promise: Promise<boolean>
  }
>()
let pendingRecovery: {
  epoch: number
  changed: Set<string>
  closed: Set<string>
} | null = null

function trackRecoveryChanges(
  previous: FileWorkspaceTab[],
  next: FileWorkspaceTab[]
) {
  if (!pendingRecovery) return
  const nextById = new Map(next.map((tab) => [tab.id, tab]))
  for (const old of previous) {
    const current = nextById.get(old.id)
    if (!current) pendingRecovery.closed.add(old.id)
    else if (
      old.kind === "file" &&
      current.kind === "file" &&
      ((current.isDirty && (current.content !== old.content || !old.isDirty)) ||
        (old.isDirty && !current.isDirty))
    )
      pendingRecovery.changed.add(old.id)
  }
  for (const tab of next) {
    if (
      tab.kind === "file" &&
      tab.isDirty &&
      !previous.some((old) => old.id === tab.id)
    )
      pendingRecovery.changed.add(tab.id)
  }
}

const initialState = {
  fileTabs: [] as FileWorkspaceTab[],
  previewFileTabIds: new Set<string>(),
  recoveryStatus: { state: "idle" } as FileWorkspaceRecoveryStatus,
  recoveredRefs: [] as FileWorkspaceRecoveredRef[],
}

export const useFileWorkspaceStore = create<FileWorkspaceStoreState>(
  (set, get) => ({
    ...initialState,

    setFileTabs(next) {
      set((state) => {
        const fileTabs = resolveSet(state.fileTabs, next)
        trackRecoveryChanges(state.fileTabs, fileTabs)
        const known = new Set(fileTabs.map((tab) => tab.id))
        for (const previous of state.fileTabs) {
          if (!known.has(previous.id)) {
            loadTokens.delete(previous.id)
            saveTokens.delete(previous.id)
            pendingSaves.delete(previous.id)
          }
        }
        return {
          fileTabs,
          previewFileTabIds: new Set(
            [...state.previewFileTabIds].filter((id) => known.has(id))
          ),
        }
      })
    },

    upsertFileTab(tab, options) {
      set((state) => {
        const existing = state.fileTabs.findIndex(
          (entry) => entry.id === tab.id
        )
        if (existing >= 0) {
          const fileTabs = [...state.fileTabs]
          const current = fileTabs[existing]
          if (
            current.kind === "file" &&
            current.isDirty &&
            tab.loading &&
            !tab.isDirty
          )
            return state
          fileTabs[existing] = tab
          trackRecoveryChanges(state.fileTabs, fileTabs)
          return { fileTabs }
        }
        const at =
          options?.index == null
            ? state.fileTabs.length
            : Math.max(0, Math.min(options.index, state.fileTabs.length))
        return {
          fileTabs: [
            ...state.fileTabs.slice(0, at),
            tab,
            ...state.fileTabs.slice(at),
          ],
        }
      })
    },

    releaseFileTabEntity(tabId) {
      loadTokens.delete(tabId)
      saveTokens.delete(tabId)
      pendingSaves.delete(tabId)
      pendingRecovery?.closed.add(tabId)
      set((state) => ({
        fileTabs: state.fileTabs.filter((tab) => tab.id !== tabId),
        previewFileTabIds: new Set(
          [...state.previewFileTabIds].filter((id) => id !== tabId)
        ),
      }))
    },

    setPreviewFileTabIds(next) {
      set((state) => ({
        previewFileTabIds: resolveSet(state.previewFileTabIds, next),
      }))
    },

    getFileTab(tabId) {
      return get().fileTabs.find((tab) => tab.id === tabId) ?? null
    },

    setRecoveryStatus(status) {
      set({ recoveryStatus: status })
    },

    async hydrateDirtyFiles(adapter) {
      const epoch = ++recoveryEpoch
      pendingRecovery = { epoch, changed: new Set(), closed: new Set() }
      set({ recoveryStatus: { state: "hydrating" } })
      try {
        const [entries, diffs] = await Promise.all([
          adapter.loadDirtyFiles(),
          adapter.loadDiffs?.() ?? Promise.resolve([]),
        ])
        if (epoch !== recoveryEpoch) return
        const recovered = [
          ...rehydrateDirtyFileTabs(entries),
          ...rehydrateDiffFileTabs(diffs),
        ]
        const changes = pendingRecovery
        set((state) => {
          const fileTabs = [...state.fileTabs]
          let recoveredCount = 0
          const retainedIds = new Set<string>()
          for (const tab of recovered) {
            if (changes?.closed.has(tab.id)) continue
            const index = fileTabs.findIndex((current) => current.id === tab.id)
            const current = fileTabs[index]
            // A restored placeholder or a disk read cannot replace a saved
            // dirty snapshot. A user's newer edit/save always wins over it.
            const replaceableDiff =
              !current ||
              (current.loading &&
                !current.content &&
                !current.originalContent &&
                !current.modifiedContent)
            if (
              !changes?.changed.has(tab.id) &&
              !current?.isDirty &&
              (tab.kind === "file" || replaceableDiff)
            ) {
              if (index < 0) fileTabs.push(tab)
              else fileTabs[index] = tab
              if (tab.kind === "file") recoveredCount += 1
            }
            retainedIds.add(tab.id)
          }
          return {
            fileTabs,
            recoveredRefs: refsFromEntries([...entries, ...diffs]).filter(
              (ref) => retainedIds.has(ref.tabId)
            ),
            recoveryStatus: { state: "ready", recoveredCount },
          }
        })
      } catch (error) {
        if (epoch !== recoveryEpoch) return
        set({
          recoveryStatus: {
            state: isFileWorkspacePersistenceUnavailable(error)
              ? "unavailable"
              : "error",
            message:
              error instanceof Error
                ? error.message
                : "Failed to recover files",
          },
        })
      } finally {
        if (pendingRecovery?.epoch === epoch) pendingRecovery = null
      }
    },

    getOperationEpoch() {
      return operationEpoch
    },
    beginLoad(tabId) {
      const token = ++nextOperationToken
      loadTokens.set(tabId, token)
      return token
    },
    isCurrentLoad(tabId, token) {
      return loadTokens.get(tabId) === token
    },
    settleLoad(tabId, token) {
      if (loadTokens.get(tabId) !== token) return false
      loadTokens.delete(tabId)
      return true
    },
    coordinateSave(tabId, force, run) {
      const tab = get().getFileTab(tabId)
      if (!tab || tab.kind !== "file") return Promise.resolve(false)
      const pending = pendingSaves.get(tabId)
      if (pending) {
        if (tab.content !== pending.content || (force && !pending.force)) {
          pending.queued = true
          pending.queuedForce ||= force
        }
        return pending.promise
      }
      const epoch = operationEpoch
      const entry = {
        content: tab.content,
        force,
        queued: false,
        queuedForce: false,
        promise: Promise.resolve(false),
      }
      const isCurrent = () =>
        epoch === operationEpoch && pendingSaves.get(tabId) === entry
      // Register before invoking provider code, including synchronous callbacks.
      pendingSaves.set(tabId, entry)
      entry.promise = Promise.resolve().then(async () => {
        try {
          while (isCurrent()) {
            const latest = get().getFileTab(tabId)
            if (!latest || latest.kind !== "file") return false
            entry.content = latest.content
            const saved = await run(entry.force)
            if (!isCurrent() || !saved) return false
            if (!entry.queued) return true
            entry.force = entry.queuedForce
            entry.queued = false
            entry.queuedForce = false
            // run reads the shared entity again, including the etag/baseline
            // committed by the previous save, before issuing another write.
          }
          return false
        } finally {
          if (isCurrent()) pendingSaves.delete(tabId)
        }
      })
      return entry.promise
    },
    beginSave(tabId) {
      const token = ++nextOperationToken
      saveTokens.set(tabId, token)
      return token
    },
    isCurrentSave(tabId, token) {
      return saveTokens.get(tabId) === token
    },
    settleSave(tabId, token) {
      if (saveTokens.get(tabId) !== token) return false
      saveTokens.delete(tabId)
      return true
    },

    reset() {
      operationEpoch += 1
      loadTokens.clear()
      saveTokens.clear()
      pendingSaves.clear()
      recoveryEpoch += 1
      pendingRecovery = null
      set({
        ...initialState,
        previewFileTabIds: new Set(),
        recoveredRefs: [],
        recoveryStatus: { state: "idle" },
      })
    },
  })
)

export function getFileWorkspaceState(): FileWorkspaceStoreState {
  return useFileWorkspaceStore.getState()
}

registerBackendScopedStoreReset(() => useFileWorkspaceStore.getState().reset())
