"use client"

import { buildFileTabId, parseFileTabId } from "@/lib/file-tab-id"
import { isAbsoluteFilePath } from "@/lib/file-path-display"
import { normalizeAbsPath } from "@/lib/file-open-target"
import type { FileWorkspaceTab, LineEnding } from "@/contexts/workspace-context"

export const FILE_WORKSPACE_DIRTY_DB_VERSION = 1

const DB_NAME_PREFIX = "codeg-file-workspace"
const STORE_NAME = "dirty-files"
const DIFF_STORE_NAME = "diffs"
const DATABASE_SCHEMA_VERSION = 2

export type FileWorkspaceRecoveryStatus =
  | { state: "idle" }
  | { state: "hydrating" }
  | { state: "ready"; recoveredCount: number }
  | { state: "unavailable"; message: string }
  | { state: "error"; message: string }

export interface PersistedDirtyFileEntity {
  version: typeof FILE_WORKSPACE_DIRTY_DB_VERSION
  backendId: string
  windowId: string
  id: string
  path: string
  title: string
  description: string | null
  language: string
  content: string
  savedContent: string
  etag: string | null
  mtimeMs: number | null
  readonly: boolean
  lineEnding: LineEnding
  stale: boolean
  updatedAt: number
  refs: Array<{
    scopeId: string
    tabId: string
    groupId: string | null
  }>
}

export interface FileWorkspacePersistenceAdapter {
  loadDirtyFiles: () => Promise<PersistedDirtyFileEntity[]>
  persistDirtyFiles: (entries: PersistedDirtyFileEntity[]) => Promise<void>
  loadDiffs?: () => Promise<PersistedDiffFileEntity[]>
  persistDiffs?: (entries: PersistedDiffFileEntity[]) => Promise<void>
}

export interface PersistedDiffFileEntity {
  version: typeof FILE_WORKSPACE_DIRTY_DB_VERSION
  backendId: string
  windowId: string
  id: string
  kind: "diff" | "rich-diff"
  folderId: number | null
  path: string | null
  title: string
  description: string | null
  language: string
  content: string
  originalContent?: string
  modifiedContent?: string
  refs: PersistedDirtyFileEntity["refs"]
}

export class FileWorkspacePersistenceUnavailableError extends Error {
  constructor(message = "IndexedDB is unavailable") {
    super(message)
    this.name = "FileWorkspacePersistenceUnavailableError"
  }
}

export function isFileWorkspacePersistenceUnavailable(
  error: unknown
): error is FileWorkspacePersistenceUnavailableError {
  return error instanceof FileWorkspacePersistenceUnavailableError
}

function dbName(backendId: string, windowId: string): string {
  return `${DB_NAME_PREFIX}:${encodeURIComponent(backendId)}:${encodeURIComponent(windowId)}`
}

function openDirtyDb(
  backendId: string,
  windowId: string
): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new FileWorkspacePersistenceUnavailableError())
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      dbName(backendId, windowId),
      DATABASE_SCHEMA_VERSION
    )
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(DIFF_STORE_NAME))
        db.createObjectStore(DIFF_STORE_NAME, { keyPath: "id" })
    }
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open dirty file store"))
    request.onsuccess = () => resolve(request.result)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () =>
      reject(tx.error ?? new Error("Dirty file store transaction failed"))
    tx.onabort = () =>
      reject(tx.error ?? new Error("Dirty file store transaction aborted"))
  })
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function lineEndingOrDefault(value: unknown): LineEnding {
  return value === "lf" ||
    value === "crlf" ||
    value === "mixed" ||
    value === "none"
    ? value
    : "none"
}

function sanitizeEntityBase(
  raw: unknown,
  backendId: string,
  windowId: string
): PersistedDirtyFileEntity | null {
  if (raw === null || typeof raw !== "object") return null
  const entry = raw as Record<string, unknown>
  if (entry.version !== FILE_WORKSPACE_DIRTY_DB_VERSION) return null
  if (entry.backendId !== backendId || entry.windowId !== windowId) return null

  const id = stringOrNull(entry.id)
  const path = stringOrNull(entry.path)
  const title = stringOrNull(entry.title)
  const language = stringOrNull(entry.language)
  const content = stringOrNull(entry.content)
  const savedContent = stringOrNull(entry.savedContent)
  if (!id || !path || title === null || language === null || content === null) {
    return null
  }

  const refs = Array.isArray(entry.refs)
    ? entry.refs.flatMap((rawRef) => {
        if (rawRef === null || typeof rawRef !== "object") return []
        const ref = rawRef as Record<string, unknown>
        const scopeId = stringOrNull(ref.scopeId)
        const tabId = stringOrNull(ref.tabId)
        if (
          !scopeId ||
          tabId !== id ||
          (scopeId !== "global" &&
            (!/^[1-9]\d*$/.test(scopeId) ||
              !Number.isSafeInteger(Number(scopeId))))
        )
          return []
        return [
          {
            scopeId,
            tabId,
            groupId: stringOrNull(ref.groupId),
          },
        ]
      })
    : []

  return {
    version: FILE_WORKSPACE_DIRTY_DB_VERSION,
    backendId,
    windowId,
    id,
    path,
    title,
    description: stringOrNull(entry.description),
    language,
    content,
    savedContent: savedContent ?? "",
    etag: stringOrNull(entry.etag),
    mtimeMs:
      typeof entry.mtimeMs === "number" && Number.isFinite(entry.mtimeMs)
        ? entry.mtimeMs
        : null,
    readonly: entry.readonly === true,
    lineEnding: lineEndingOrDefault(entry.lineEnding),
    stale: entry.stale === true,
    updatedAt:
      typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
        ? entry.updatedAt
        : 0,
    refs: refs.length
      ? refs
      : [{ scopeId: "global", tabId: id, groupId: null }],
  }
}

export function sanitizeDirtyFileEntry(
  raw: unknown,
  backendId: string,
  windowId: string
): PersistedDirtyFileEntity | null {
  const entry = sanitizeEntityBase(raw, backendId, windowId)
  if (!entry || !isAbsoluteFilePath(entry.path)) return null
  if (
    entry.path !== normalizeAbsPath(entry.path) ||
    entry.id !== buildFileTabId({ kind: "file", path: entry.path })
  )
    return null
  return entry
}

const adapterCache = new Map<string, FileWorkspacePersistenceAdapter>()

/** Serialize writes across re-renders; readers observe all preceding writes. */
export function queueFileWorkspacePersistence(
  adapter: FileWorkspacePersistenceAdapter
): FileWorkspacePersistenceAdapter {
  let pending: Promise<void> = Promise.resolve()
  let latest: PersistedDirtyFileEntity[] | null = null
  return {
    async loadDirtyFiles() {
      await pending.catch(() => {})
      return adapter.loadDirtyFiles()
    },
    persistDirtyFiles(entries) {
      latest = entries.map((entry) => ({
        ...entry,
        refs: entry.refs.map((ref) => ({ ...ref })),
      }))
      // Keep one pending snapshot when typing outruns disk writes. Later
      // callers await the same chain without retaining every prior buffer.
      const write = pending
        .catch(() => {})
        .then(async () => {
          const snapshot = latest
          latest = null
          if (snapshot) await adapter.persistDirtyFiles(snapshot)
        })
      pending = write
      return write
    },
  }
}

export function createIndexedDbFileWorkspacePersistence(
  backendId: string,
  windowId: string
): FileWorkspacePersistenceAdapter {
  const key = dbName(backendId, windowId)
  const cached = adapterCache.get(key)
  if (cached) return cached
  const adapter = queueFileWorkspacePersistence({
    async loadDirtyFiles() {
      const db = await openDirtyDb(backendId, windowId)
      try {
        const tx = db.transaction(STORE_NAME, "readonly")
        const store = tx.objectStore(STORE_NAME)
        const result = await new Promise<PersistedDirtyFileEntity[]>(
          (resolve, reject) => {
            const request = store.getAll()
            request.onerror = () =>
              reject(request.error ?? new Error("Failed to load dirty files"))
            request.onsuccess = () =>
              resolve(
                (request.result as unknown[]).flatMap((entry) => {
                  const clean = sanitizeDirtyFileEntry(
                    entry,
                    backendId,
                    windowId
                  )
                  return clean ? [clean] : []
                })
              )
          }
        )
        await txDone(tx)
        return result
      } finally {
        db.close()
      }
    },
    async persistDirtyFiles(entries) {
      const db = await openDirtyDb(backendId, windowId)
      try {
        const tx = db.transaction(STORE_NAME, "readwrite")
        const completed = txDone(tx)
        const store = tx.objectStore(STORE_NAME)
        store.clear()
        for (const entry of entries) store.put(entry)
        await completed
      } finally {
        db.close()
      }
    },
  })
  let pendingDiff: Promise<void> = Promise.resolve()
  let latestDiff: PersistedDiffFileEntity[] | null = null
  adapter.loadDiffs = async () => {
    await pendingDiff.catch(() => {})
    const db = await openDirtyDb(backendId, windowId)
    try {
      const tx = db.transaction(DIFF_STORE_NAME, "readonly")
      const completed = txDone(tx)
      const rows = new Promise<unknown[]>((resolve, reject) => {
        const request = tx.objectStore(DIFF_STORE_NAME).getAll()
        request.onsuccess = () => resolve(request.result as unknown[])
        request.onerror = () =>
          reject(request.error ?? new Error("Failed to load diff snapshots"))
      })
      const [result] = await Promise.all([rows, completed])
      return result.flatMap((raw) => {
        const entry = sanitizeDiffFileEntry(raw, backendId, windowId)
        return entry ? [entry] : []
      })
    } finally {
      db.close()
    }
  }
  adapter.persistDiffs = (entries) => {
    latestDiff = entries.map((entry) => ({
      ...entry,
      refs: entry.refs.map((ref) => ({ ...ref })),
    }))
    const write = pendingDiff
      .catch(() => {})
      .then(async () => {
        const snapshot = latestDiff
        latestDiff = null
        if (!snapshot) return
        const db = await openDirtyDb(backendId, windowId)
        try {
          const tx = db.transaction(DIFF_STORE_NAME, "readwrite")
          const completed = txDone(tx)
          const store = tx.objectStore(DIFF_STORE_NAME)
          store.clear()
          for (const entry of snapshot) store.put(entry)
          await completed
        } finally {
          db.close()
        }
      })
    pendingDiff = write
    return write
  }
  adapterCache.set(key, adapter)
  return adapter
}

export function serializeDirtyFileTabs(params: {
  backendId: string
  windowId: string
  tabs: ReadonlyArray<FileWorkspaceTab>
  refsByScope: Record<string, string[]>
  groupByTabId?: Record<string, string | null>
  groupByScope?: Record<string, Record<string, string>>
  now?: number
}): PersistedDirtyFileEntity[] {
  const now = params.now ?? Date.now()
  return params.tabs.flatMap((tab) => {
    if (tab.kind !== "file" || !tab.path || !tab.isDirty) return []
    return [
      {
        version: FILE_WORKSPACE_DIRTY_DB_VERSION,
        backendId: params.backendId,
        windowId: params.windowId,
        id: tab.id,
        path: tab.path,
        title: tab.title,
        description: tab.description,
        language: tab.language,
        content: tab.content,
        savedContent: tab.savedContent ?? "",
        etag: tab.etag ?? null,
        mtimeMs: tab.mtimeMs ?? null,
        readonly: Boolean(tab.readonly),
        lineEnding: tab.lineEnding ?? "none",
        stale: Boolean(tab.stale),
        updatedAt: now,
        refs: Object.entries(params.refsByScope).flatMap(([scopeId, tabIds]) =>
          tabIds.includes(tab.id)
            ? [
                {
                  scopeId,
                  tabId: tab.id,
                  groupId:
                    params.groupByScope?.[scopeId]?.[tab.id] ??
                    params.groupByTabId?.[tab.id] ??
                    null,
                },
              ]
            : []
        ),
      },
    ]
  })
}

export function rehydrateDirtyFileTabs(
  entries: ReadonlyArray<PersistedDirtyFileEntity>
): FileWorkspaceTab[] {
  return entries.map((entry) => ({
    id: entry.id,
    kind: "file",
    folderId: null,
    title: entry.title,
    description: entry.description,
    path: entry.path,
    language: entry.language,
    content: entry.content,
    loading: false,
    savedContent: entry.savedContent,
    isDirty: true,
    etag: entry.etag,
    mtimeMs: entry.mtimeMs,
    readonly: entry.readonly,
    lineEnding: entry.lineEnding,
    saveState: "idle",
    saveError: null,
    stale: entry.stale,
  }))
}

/** Session patches and conflict views cannot be reconstructed from a path. */
export function serializeDiffFileTabs(
  params: Parameters<typeof serializeDirtyFileTabs>[0]
): PersistedDiffFileEntity[] {
  return params.tabs.flatMap((tab) => {
    if (tab.kind !== "diff" && tab.kind !== "rich-diff") return []
    const identity = parseFileTabId(tab.id)
    if (
      identity?.kind !== "diff-session" &&
      identity?.kind !== "diff-external-conflict"
    )
      return []
    if (tab.loading) return []
    return [
      {
        version: FILE_WORKSPACE_DIRTY_DB_VERSION,
        backendId: params.backendId,
        windowId: params.windowId,
        id: tab.id,
        kind: tab.kind,
        folderId: tab.folderId,
        path: tab.path,
        title: tab.title,
        description: tab.description,
        language: tab.language,
        content: tab.content,
        originalContent: tab.originalContent,
        modifiedContent: tab.modifiedContent,
        refs: Object.entries(params.refsByScope).flatMap(([scopeId, ids]) =>
          ids.includes(tab.id)
            ? [
                {
                  scopeId,
                  tabId: tab.id,
                  groupId:
                    params.groupByScope?.[scopeId]?.[tab.id] ??
                    params.groupByTabId?.[tab.id] ??
                    null,
                },
              ]
            : []
        ),
      },
    ]
  })
}

export function sanitizeDiffFileEntry(
  raw: unknown,
  backendId: string,
  windowId: string
): PersistedDiffFileEntity | null {
  if (!raw || typeof raw !== "object") return null
  const entry = raw as Record<string, unknown>
  if (entry.kind !== "diff" && entry.kind !== "rich-diff") return null
  const identity =
    typeof entry.id === "string" ? parseFileTabId(entry.id) : null
  if (
    identity?.kind !== "diff-session" &&
    identity?.kind !== "diff-external-conflict"
  )
    return null
  const base = sanitizeEntityBase(
    { ...entry, path: entry.path ?? "/", savedContent: "" },
    backendId,
    windowId
  )
  if (!base) return null
  if (
    identity.kind === "diff-session" &&
    (entry.folderId !== identity.folderId ||
      (entry.path !== null && entry.path !== identity.path))
  )
    return null
  if (
    identity.kind === "diff-external-conflict" &&
    (entry.folderId != null || entry.path !== identity.path)
  )
    return null
  const refs =
    identity.kind === "diff-session"
      ? base.refs.filter(
          (ref) =>
            ref.scopeId === "global" ||
            ref.scopeId === String(identity.folderId)
        )
      : base.refs
  return {
    version: base.version,
    backendId,
    windowId,
    id: base.id,
    kind: entry.kind,
    folderId:
      typeof entry.folderId === "number" && Number.isInteger(entry.folderId)
        ? entry.folderId
        : null,
    path: stringOrNull(entry.path),
    title: base.title,
    description: base.description,
    language: base.language,
    content: base.content,
    originalContent:
      typeof entry.originalContent === "string"
        ? entry.originalContent
        : undefined,
    modifiedContent:
      typeof entry.modifiedContent === "string"
        ? entry.modifiedContent
        : undefined,
    refs: refs.length
      ? refs
      : [{ scopeId: "global", tabId: base.id, groupId: null }],
  }
}

export function rehydrateDiffFileTabs(
  entries: ReadonlyArray<PersistedDiffFileEntity>
): FileWorkspaceTab[] {
  return entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    folderId: entry.folderId,
    path: entry.path,
    title: entry.title,
    description: entry.description,
    language: entry.language,
    content: entry.content,
    originalContent: entry.originalContent,
    modifiedContent: entry.modifiedContent,
    loading: false,
    readonly: true,
    isDirty: false,
    saveState: "idle",
    saveError: null,
  }))
}
