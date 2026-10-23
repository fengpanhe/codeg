import { buildFileTabId } from "@/lib/file-tab-id"
import { describe, expect, it } from "vitest"
import type { FileWorkspaceTab } from "@/contexts/workspace-context"
import {
  rehydrateDirtyFileTabs,
  queueFileWorkspacePersistence,
  sanitizeDirtyFileEntry,
  serializeDiffFileTabs,
  rehydrateDiffFileTabs,
  serializeDirtyFileTabs,
} from "@/lib/file-workspace-persistence"

function tab(patch: Partial<FileWorkspaceTab>): FileWorkspaceTab {
  return {
    id: "file:%2Frepo%2Fa.ts",
    kind: "file",
    folderId: null,
    title: "a.ts",
    description: "/repo/a.ts",
    path: "/repo/a.ts",
    language: "typescript",
    content: "draft",
    loading: false,
    savedContent: "saved",
    isDirty: true,
    etag: "etag-1",
    mtimeMs: 10,
    readonly: false,
    lineEnding: "lf",
    saveState: "idle",
    saveError: null,
    ...patch,
  } as FileWorkspaceTab
}

describe("file workspace dirty persistence", () => {
  it("persists dirty content with etag, savedContent, and workspace refs", () => {
    const entries = serializeDirtyFileTabs({
      backendId: "local",
      windowId: "win-1",
      tabs: [tab({})],
      refsByScope: {
        "1": ["file:%2Frepo%2Fa.ts"],
        "2": ["file:%2Frepo%2Fa.ts"],
      },
      groupByTabId: { "file:%2Frepo%2Fa.ts": "group-a" },
      now: 123,
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      backendId: "local",
      windowId: "win-1",
      path: "/repo/a.ts",
      content: "draft",
      savedContent: "saved",
      etag: "etag-1",
      updatedAt: 123,
    })
    expect(entries[0].refs).toEqual([
      { scopeId: "1", tabId: "file:%2Frepo%2Fa.ts", groupId: "group-a" },
      { scopeId: "2", tabId: "file:%2Frepo%2Fa.ts", groupId: "group-a" },
    ])
  })

  it("does not serialize clean files or non-file resources", () => {
    expect(
      serializeDirtyFileTabs({
        backendId: "local",
        windowId: "win-1",
        tabs: [tab({ isDirty: false })],
        refsByScope: { "1": ["file:%2Frepo%2Fa.ts"] },
      })
    ).toEqual([])
  })

  it("rehydrates dirty entries as dirty file tabs without marking them loading", () => {
    const [entry] = serializeDirtyFileTabs({
      backendId: "local",
      windowId: "win-1",
      tabs: [tab({ stale: true })],
      refsByScope: { "1": ["file:%2Frepo%2Fa.ts"] },
    })

    const [rehydrated] = rehydrateDirtyFileTabs([entry])

    expect(rehydrated).toMatchObject({
      id: "file:%2Frepo%2Fa.ts",
      kind: "file",
      content: "draft",
      savedContent: "saved",
      isDirty: true,
      loading: false,
      stale: true,
      saveState: "idle",
    })
  })
})

it("queues rapid snapshots so a slower earlier write cannot overwrite the last edit", async () => {
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const writes: string[] = []
  let disk = ""
  const adapter = queueFileWorkspacePersistence({
    loadDirtyFiles: async () => [],
    persistDirtyFiles: async (entries) => {
      const value = entries[0].content
      writes.push(value)
      if (value === "old") await blocked
      disk = value
    },
  })
  const entries = serializeDirtyFileTabs({
    backendId: "local",
    windowId: "window",
    tabs: [tab({ content: "old" })],
    refsByScope: { "1": ["file:%2Frepo%2Fa.ts"] },
  })
  const first = adapter.persistDirtyFiles(entries)
  await Promise.resolve()
  await Promise.resolve()
  expect(writes).toEqual(["old"])
  const second = adapter.persistDirtyFiles([{ ...entries[0], content: "new" }])
  const third = adapter.persistDirtyFiles([
    { ...entries[0], content: "newest" },
  ])
  release()
  await Promise.all([first, second, third])
  expect(writes).toEqual(["old", "newest"])
  expect(disk).toBe("newest")
})

it("drops damaged rows without discarding a healthy dirty buffer", () => {
  const [entry] = serializeDirtyFileTabs({
    backendId: "local",
    windowId: "window",
    tabs: [tab({})],
    refsByScope: { "1": ["file:%2Frepo%2Fa.ts"] },
  })
  expect(
    sanitizeDirtyFileEntry({ ...entry, content: {} }, "local", "window")
  ).toBeNull()
  expect(sanitizeDirtyFileEntry(entry, "another-backend", "window")).toBeNull()
  expect(sanitizeDirtyFileEntry(entry, "local", "window")?.content).toBe(
    "draft"
  )
})

it("captures different group locations for one shared file in two worktrees", () => {
  const [entry] = serializeDirtyFileTabs({
    backendId: "local",
    windowId: "window",
    tabs: [tab({})],
    refsByScope: { "1": ["file:%2Frepo%2Fa.ts"], "2": ["file:%2Frepo%2Fa.ts"] },
    groupByScope: {
      "1": { "file:%2Frepo%2Fa.ts": "left" },
      "2": { "file:%2Frepo%2Fa.ts": "right" },
    },
  })
  expect(entry.refs.map((ref) => ref.groupId)).toEqual(["left", "right"])
})

it("restores a synthetic rich diff with both sides and its saved placement", () => {
  const id = buildFileTabId({
    kind: "diff-session",
    folderId: 1,
    groupLabel: "patch",
    path: "a.ts",
  })
  const entries = serializeDiffFileTabs({
    backendId: "local",
    windowId: "window",
    tabs: [
      {
        ...tab({}),
        id,
        kind: "rich-diff",
        folderId: 1,
        path: "a.ts",
        content: "",
        originalContent: "before",
        modifiedContent: "after",
        readonly: true,
        isDirty: false,
      },
    ],
    refsByScope: { "1": [id] },
    groupByScope: { "1": { [id]: "right" } },
  })
  expect(entries[0].refs).toEqual([
    { scopeId: "1", tabId: id, groupId: "right" },
  ])
  expect(rehydrateDiffFileTabs(entries)[0]).toMatchObject({
    kind: "rich-diff",
    originalContent: "before",
    modifiedContent: "after",
    loading: false,
    readonly: true,
    isDirty: false,
  })
})

it("rejects mismatched physical identities and repairs damaged placement links", () => {
  const [entry] = serializeDirtyFileTabs({
    backendId: "local",
    windowId: "window",
    tabs: [tab({})],
    refsByScope: { "1": ["file:%2Frepo%2Fa.ts"] },
  })
  expect(
    sanitizeDirtyFileEntry(
      { ...entry, path: "/another/file.ts" },
      "local",
      "window"
    )
  ).toBeNull()
  const recovered = sanitizeDirtyFileEntry(
    {
      ...entry,
      refs: [{ scopeId: "1", tabId: "wrong-file", groupId: "right" }],
    },
    "local",
    "window"
  )
  expect(recovered?.refs).toEqual([
    { scopeId: "global", tabId: entry.id, groupId: null },
  ])
})
