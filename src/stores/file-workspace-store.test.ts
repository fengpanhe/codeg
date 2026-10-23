import { beforeEach, describe, expect, it } from "vitest"
import {
  serializeDirtyFileTabs,
  type PersistedDirtyFileEntity,
} from "@/lib/file-workspace-persistence"
import { useFileWorkspaceStore } from "@/stores/file-workspace-store"
import {
  __resetWorkbenchStoreForTests,
  useWorkbenchStore,
} from "@/stores/workbench-store"
import type { FileWorkspaceTab } from "@/contexts/workspace-context"

function fileTab(path: string, content = "saved"): FileWorkspaceTab {
  return {
    id: `file:${encodeURIComponent(path)}`,
    kind: "file",
    folderId: null,
    title: path.split("/").pop() ?? path,
    description: path,
    path,
    language: "typescript",
    content,
    loading: false,
    savedContent: content,
    isDirty: false,
    etag: `etag:${content}`,
    mtimeMs: 1,
    readonly: false,
    lineEnding: "lf",
    saveState: "idle",
    saveError: null,
  }
}

describe("file workspace store", () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    __resetWorkbenchStoreForTests()
    useFileWorkspaceStore.getState().reset()
  })

  it("keeps one absolute-path entity while Workbench owns multiple scope refs", () => {
    const tab = fileTab("/repo/src/a.ts")
    useFileWorkspaceStore.getState().upsertFileTab(tab)
    useWorkbenchStore.getState().hydrate()
    useWorkbenchStore
      .getState()
      .openTab(1, { id: tab.id, type: "file", entityId: tab.id })
    useWorkbenchStore
      .getState()
      .openTab(2, { id: tab.id, type: "file", entityId: tab.id })
    useFileWorkspaceStore
      .getState()
      .setFileTabs((tabs) =>
        tabs.map((entry) =>
          entry.id === tab.id && entry.kind === "file"
            ? { ...entry, content: "draft", isDirty: true }
            : entry
        )
      )

    expect(useFileWorkspaceStore.getState().fileTabs).toHaveLength(1)
    expect(useFileWorkspaceStore.getState().getFileTab(tab.id)?.content).toBe(
      "draft"
    )
    expect(useWorkbenchStore.getState().workspaces["1"].tabRefs).toEqual([
      { id: tab.id, type: "file", entityId: tab.id },
    ])
    expect(useWorkbenchStore.getState().workspaces["2"].tabRefs).toEqual([
      { id: tab.id, type: "file", entityId: tab.id },
    ])
  })

  it("does not remove shared dirty entity when Workbench closes one scope ref", () => {
    const tab = {
      ...fileTab("/repo/src/a.ts"),
      content: "draft",
      isDirty: true,
    }
    useFileWorkspaceStore.getState().upsertFileTab(tab)
    useWorkbenchStore.getState().hydrate()
    useWorkbenchStore
      .getState()
      .openTab(1, { id: tab.id, type: "file", entityId: tab.id })
    useWorkbenchStore
      .getState()
      .openTab(2, { id: tab.id, type: "file", entityId: tab.id })

    useWorkbenchStore.getState().closeTab(1, tab.id)

    expect(useFileWorkspaceStore.getState().getFileTab(tab.id)).not.toBeNull()
    expect(useWorkbenchStore.getState().workspaces["1"].tabRefs).toEqual([])
    expect(useWorkbenchStore.getState().workspaces["2"].tabRefs).toHaveLength(1)
  })

  it("releaseFileTabEntity only removes entity-side data, never Workbench refs", () => {
    const a = fileTab("/repo/a.ts")
    const b = fileTab("/repo/b.ts")
    const fileStore = useFileWorkspaceStore.getState()
    fileStore.setFileTabs([a, b])
    fileStore.setPreviewFileTabIds(new Set([a.id, b.id]))
    useWorkbenchStore.getState().hydrate()
    useWorkbenchStore
      .getState()
      .openTab(1, { id: a.id, type: "file", entityId: a.id })
    useWorkbenchStore
      .getState()
      .openTab(1, { id: b.id, type: "file", entityId: b.id })

    fileStore.releaseFileTabEntity(a.id)

    const state = useFileWorkspaceStore.getState()
    expect(state.fileTabs.map((tab) => tab.id)).toEqual([b.id])
    expect([...state.previewFileTabIds]).toEqual([b.id])
    expect(useWorkbenchStore.getState().workspaces["1"].tabRefs).toEqual([
      { id: a.id, type: "file", entityId: a.id },
      { id: b.id, type: "file", entityId: b.id },
    ])
  })

  it("surfaces dirty recovery failures in recoveryStatus", async () => {
    await useFileWorkspaceStore.getState().hydrateDirtyFiles({
      loadDirtyFiles: async () => {
        throw new Error("indexeddb unavailable")
      },
      persistDirtyFiles: async () => {},
    })

    expect(useFileWorkspaceStore.getState().recoveryStatus).toEqual({
      state: "error",
      message: "indexeddb unavailable",
    })
  })
})

describe("dirty recovery while the workbench is restoring", () => {
  beforeEach(() => useFileWorkspaceStore.getState().reset())

  function recovery() {
    const snapshot = fileTab("/repo/recover.ts", "saved")
    const entries = serializeDirtyFileTabs({
      backendId: "local",
      windowId: "window",
      tabs: [{ ...snapshot, content: "unsaved snapshot", isDirty: true }],
      refsByScope: { "1": [snapshot.id] },
    })
    let resolve!: (entries: PersistedDirtyFileEntity[]) => void
    const load = new Promise<PersistedDirtyFileEntity[]>((done) => {
      resolve = done
    })
    const adapter = {
      loadDirtyFiles: () => load,
      persistDirtyFiles: async () => {},
    }
    return { snapshot, entries, adapter, resolve }
  }

  it("merges recovered text over a placeholder seeded after hydration started", async () => {
    const { snapshot, entries, adapter, resolve } = recovery()
    const store = useFileWorkspaceStore.getState()
    const pending = store.hydrateDirtyFiles(adapter)
    store.upsertFileTab({ ...snapshot, content: "", loading: true })
    resolve(entries)
    await pending
    expect(store.getFileTab(snapshot.id)).toMatchObject({
      content: "unsaved snapshot",
      savedContent: "saved",
      isDirty: true,
      loading: false,
    })
  })

  it("preserves a newer edit while the saved snapshot is loading", async () => {
    const { snapshot, entries, adapter, resolve } = recovery()
    const store = useFileWorkspaceStore.getState()
    store.upsertFileTab({ ...snapshot, content: "", loading: true })
    const pending = store.hydrateDirtyFiles(adapter)
    store.setFileTabs((tabs) =>
      tabs.map((tab) => ({
        ...tab,
        content: "new edit",
        isDirty: true,
        loading: false,
      }))
    )
    resolve(entries)
    await pending
    expect(store.getFileTab(snapshot.id)?.content).toBe("new edit")
  })

  it("preserves a newer successful save even when the entity is clean again", async () => {
    const { snapshot, entries, adapter, resolve } = recovery()
    const store = useFileWorkspaceStore.getState()
    store.upsertFileTab({ ...snapshot, content: "", loading: true })
    const pending = store.hydrateDirtyFiles(adapter)
    store.setFileTabs((tabs) =>
      tabs.map((tab) => ({ ...tab, content: "new edit", isDirty: true }))
    )
    store.setFileTabs((tabs) =>
      tabs.map((tab) => ({
        ...tab,
        savedContent: "new edit",
        isDirty: false,
        loading: false,
      }))
    )
    resolve(entries)
    await pending
    expect(store.getFileTab(snapshot.id)).toMatchObject({
      content: "new edit",
      savedContent: "new edit",
      isDirty: false,
    })
  })

  it("does not resurrect a file closed while recovery was in flight", async () => {
    const { snapshot, entries, adapter, resolve } = recovery()
    const store = useFileWorkspaceStore.getState()
    store.upsertFileTab({ ...snapshot, loading: true })
    const pending = store.hydrateDirtyFiles(adapter)
    store.releaseFileTabEntity(snapshot.id)
    resolve(entries)
    await pending
    expect(store.getFileTab(snapshot.id)).toBeNull()
    expect(useFileWorkspaceStore.getState().recoveredRefs).toEqual([])
  })

  it("ignores recovery from a realm reset after the request started", async () => {
    const { entries, adapter, resolve } = recovery()
    const store = useFileWorkspaceStore.getState()
    const pending = store.hydrateDirtyFiles(adapter)
    store.reset()
    resolve(entries)
    await pending
    expect(useFileWorkspaceStore.getState().fileTabs).toEqual([])
    expect(useFileWorkspaceStore.getState().recoveryStatus.state).toBe("idle")
  })
})

it("invalidates an older provider's load when another provider starts a newer request", () => {
  const store = useFileWorkspaceStore.getState()
  const older = store.beginLoad("file:/shared")
  const newer = store.beginLoad("file:/shared")
  expect(store.isCurrentLoad("file:/shared", older)).toBe(false)
  expect(store.settleLoad("file:/shared", older)).toBe(false)
  expect(store.isCurrentLoad("file:/shared", newer)).toBe(true)
  expect(store.settleLoad("file:/shared", newer)).toBe(true)
})

it("invalidates pending reads and saves on backend reset without reusing tokens", () => {
  const store = useFileWorkspaceStore.getState()
  const read = store.beginLoad("file:/shared")
  const save = store.beginSave("file:/shared")
  store.reset()
  const next = store.beginLoad("file:/shared")
  expect(next).not.toBe(read)
  expect(store.isCurrentLoad("file:/shared", read)).toBe(false)
  expect(store.isCurrentSave("file:/shared", save)).toBe(false)
})

it.each(["reset", "release", "remove"])(
  "cancels a queued save on %s even when the same file is reopened",
  async (action) => {
    const store = useFileWorkspaceStore.getState()
    store.reset()
    const tab = fileTab("/repo/shared.ts", "draft")
    store.upsertFileTab(tab)
    let resolveSave!: (saved: boolean) => void
    let originalWrites = 0
    const run = () => {
      originalWrites += 1
      return new Promise<boolean>((resolve) => {
        resolveSave = resolve
      })
    }
    const first = store.coordinateSave(tab.id, false, run)
    await Promise.resolve()
    store.upsertFileTab({ ...tab, content: "newer", isDirty: true })
    const queued = store.coordinateSave(tab.id, false, run)
    expect(queued).toBe(first)
    if (action === "reset") store.reset()
    else if (action === "release") store.releaseFileTabEntity(tab.id)
    else store.setFileTabs([])
    store.upsertFileTab(tab)
    let reopenedWrites = 0
    const reopened = store.coordinateSave(tab.id, false, async () => {
      reopenedWrites += 1
      return true
    })
    resolveSave(true)
    expect(await first).toBe(false)
    expect(await reopened).toBe(true)
    expect(originalWrites).toBe(1)
    expect(reopenedWrites).toBe(1)
  }
)
