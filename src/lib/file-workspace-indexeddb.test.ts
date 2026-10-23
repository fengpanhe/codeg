import { IDBFactory } from "fake-indexeddb"
import { useFileWorkspaceStore } from "@/stores/file-workspace-store"
import { buildFileTabId } from "@/lib/file-tab-id"
import type { FileWorkspaceTab } from "@/contexts/workspace-context"
import {
  createIndexedDbFileWorkspacePersistence,
  serializeDirtyFileTabs,
  serializeDiffFileTabs,
} from "./file-workspace-persistence"

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory())
  useFileWorkspaceStore.getState().reset()
})
afterEach(() => vi.unstubAllGlobals())

function buffers() {
  const file: FileWorkspaceTab = {
    id: buildFileTabId({ kind: "file", path: "/repo/a.ts" }),
    kind: "file",
    folderId: null,
    path: "/repo/a.ts",
    title: "a.ts",
    description: null,
    language: "typescript",
    content: "local edit",
    savedContent: "disk",
    etag: "old-etag",
    isDirty: true,
    loading: false,
  }
  const diff: FileWorkspaceTab = {
    id: buildFileTabId({
      kind: "diff-session",
      folderId: 1,
      groupLabel: "patch",
      path: "a.ts",
    }),
    kind: "rich-diff",
    folderId: 1,
    path: null,
    title: "patch",
    description: null,
    language: "typescript",
    content: "",
    originalContent: "before",
    modifiedContent: "after",
    readonly: true,
    loading: false,
  }
  const params = {
    backendId: "test-backend",
    windowId: "test-window",
    tabs: [file, diff],
    refsByScope: { "1": [file.id, diff.id] },
    groupByScope: { "1": { [file.id]: "left", [diff.id]: "right" } },
  }
  return { file, diff, params }
}

it("restores dirty buffers and readonly synthetic diffs from independent IndexedDB stores", async () => {
  const { file, diff, params } = buffers()
  const adapter = createIndexedDbFileWorkspacePersistence(
    params.backendId,
    params.windowId
  )
  await Promise.all([
    adapter.persistDirtyFiles(serializeDirtyFileTabs(params)),
    adapter.persistDiffs!(serializeDiffFileTabs(params)),
  ])
  useFileWorkspaceStore
    .getState()
    .upsertFileTab({ ...file, content: "", isDirty: false, loading: true })
  useFileWorkspaceStore.getState().upsertFileTab({
    ...diff,
    originalContent: undefined,
    modifiedContent: undefined,
    loading: true,
  })
  await useFileWorkspaceStore.getState().hydrateDirtyFiles(adapter)
  expect(useFileWorkspaceStore.getState().getFileTab(file.id)).toMatchObject({
    content: "local edit",
    savedContent: "disk",
    isDirty: true,
    loading: false,
  })
  expect(useFileWorkspaceStore.getState().getFileTab(diff.id)).toMatchObject({
    kind: "rich-diff",
    originalContent: "before",
    modifiedContent: "after",
    readonly: true,
    loading: false,
  })
  expect(
    useFileWorkspaceStore.getState().recoveredRefs.map((ref) => ref.groupId)
  ).toEqual(["left", "right"])
  await adapter.persistDirtyFiles([])
  expect(await adapter.loadDirtyFiles()).toEqual([])
  expect(await adapter.loadDiffs!()).toHaveLength(1)
})

it("keeps the newest edit when writes are queued before an IndexedDB open completes", async () => {
  const { params } = buffers()
  const adapter = createIndexedDbFileWorkspacePersistence(
    "queued-backend",
    "window"
  )
  const entries = serializeDirtyFileTabs({
    ...params,
    backendId: "queued-backend",
    windowId: "window",
  })
  await Promise.all([
    adapter.persistDirtyFiles(entries),
    adapter.persistDirtyFiles([{ ...entries[0], content: "newest edit" }]),
  ])
  expect((await adapter.loadDirtyFiles())[0].content).toBe("newest edit")
})

it("upgrades the client cache without clearing existing version-one dirty records", async () => {
  const { params } = buffers()
  const name = `codeg-file-workspace:${encodeURIComponent(params.backendId)}:${encodeURIComponent(params.windowId)}`
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () =>
      request.result.createObjectStore("dirty-files", { keyPath: "id" })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("dirty-files", "readwrite")
    tx.objectStore("dirty-files").put(serializeDirtyFileTabs(params)[0])
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  const adapter = createIndexedDbFileWorkspacePersistence(
    params.backendId,
    params.windowId
  )
  expect((await adapter.loadDirtyFiles())[0].content).toBe("local edit")
  await adapter.persistDiffs!(serializeDiffFileTabs(params))
  expect(await adapter.loadDiffs!()).toHaveLength(1)
})
