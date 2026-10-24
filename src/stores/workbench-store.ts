import { create } from "zustand"
import { registerBackendScopedStoreReset } from "@/stores/backend-scoped-store-reset"
import {
  firstLeafId,
  leafIds,
  makeGroupId,
  neighborGroupId,
  removeGroup,
  resizeSplitAt,
  singleGroupLayout,
  splitGroup,
  toggleOrientation,
  type LayoutNode,
  type SplitDirection,
} from "@/lib/tab-group-layout"
import {
  defaultRightPanelState,
  readPersistedWorkbenchState,
  sanitizePersistedWorkbenchState,
  sanitizeWorkbenchLayout,
  writePersistedWorkbenchState,
  WORKBENCH_PERSISTENCE_VERSION,
  type PersistedWorkbenchState,
} from "@/lib/workbench-persistence"
import type {
  ConversationWorkbenchRef,
  LegacyWorkbenchGroupState,
  RightPanelState,
  WorkbenchOpenOptions,
  WorkbenchPane,
  WorkbenchPruneOptions,
  WorkbenchTabRef,
  WorkbenchUiMode,
  WorktreeWorkspaceState,
  WorkspaceScopeId,
} from "@/types/workbench"
import {
  workbenchPaneGroup,
  workbenchPaneLayout,
  paneRatiosForLayout,
  tabBelongsToPane,
} from "@/lib/workbench-pane-layout"
import { scopeIdForFolder, scopeKey } from "@/types/workbench"

export interface WorkbenchStoreState {
  workspaces: Record<string, WorktreeWorkspaceState>
  activeScopeId: WorkspaceScopeId
  uiMode: WorkbenchUiMode
  hydrated: boolean
  hydrate: () => void
  activateScope: (scopeId: WorkspaceScopeId) => void
  openTab: (
    scopeId: WorkspaceScopeId,
    ref: WorkbenchTabRef,
    options?: WorkbenchOpenOptions
  ) => void
  activateTab: (scopeId: WorkspaceScopeId, tabId: string) => void
  closeTab: (scopeId: WorkspaceScopeId, tabId: string) => void
  closeEntityTabs: (entityId: string) => void
  focusGroup: (scopeId: WorkspaceScopeId, groupId: string) => void
  split: (
    scopeId: WorkspaceScopeId,
    groupId: string,
    direction: SplitDirection,
    pane?: WorkbenchPane
  ) => string
  moveTab: (
    scopeId: WorkspaceScopeId,
    tabId: string,
    targetGroupId: string,
    index?: number
  ) => void
  reorderGroupTabs: (
    scopeId: WorkspaceScopeId,
    groupId: string,
    orderedIds: string[]
  ) => void
  resizeSplit: (
    scopeId: WorkspaceScopeId,
    splitId: string,
    handleIndex: number,
    boundaryFraction: number
  ) => void
  resizePaneSplit: (
    scopeId: WorkspaceScopeId,
    pane: WorkbenchPane,
    splitId: string,
    handleIndex: number,
    boundaryFraction: number
  ) => void
  dissolveGroup: (
    scopeId: WorkspaceScopeId,
    groupId: string,
    pane?: WorkbenchPane
  ) => void
  unsplitAll: (scopeId: WorkspaceScopeId, pane?: WorkbenchPane) => void
  toggleGroupTile: (scopeId: WorkspaceScopeId, groupId: string) => void
  toggleGroupOrientation: (scopeId: WorkspaceScopeId, groupId: string) => void
  patchRightPanel: (
    scopeId: WorkspaceScopeId,
    patch:
      | Partial<RightPanelState>
      | ((state: RightPanelState) => Partial<RightPanelState>)
  ) => void
  setClassicRatio: (scopeId: WorkspaceScopeId, ratio: number) => void
  setUiMode: (mode: WorkbenchUiMode) => void
  reconcileConversations: (
    tabs: ConversationWorkbenchRef[],
    activeTabId: string | null,
    known: boolean,
    legacy?: LegacyWorkbenchGroupState
  ) => void
  pruneScopes: (folderIds: number[], options?: WorkbenchPruneOptions) => void
}

const initialState = {
  workspaces: {} as Record<string, WorktreeWorkspaceState>,
  activeScopeId: "global" as WorkspaceScopeId,
  uiMode: "classic" as WorkbenchUiMode,
  hydrated: false,
}

let persistenceEnabled = true
let conversationPersistenceIds = new Map<string, string>()

function normalizeScopeId(scopeId: WorkspaceScopeId): WorkspaceScopeId {
  if (scopeId === "global") return "global"
  return Number.isInteger(scopeId) && scopeId > 0 ? scopeId : "global"
}

function createWorkspace(scopeId: WorkspaceScopeId): WorktreeWorkspaceState {
  const normalized = normalizeScopeId(scopeId)
  const layout = singleGroupLayout()
  return {
    version: 1,
    scopeId: normalized,
    tabRefs: [],
    groupLayout: layout,
    groupOf: {},
    groupSelection: {},
    tileByGroup: {},
    focusedGroupId: firstLeafId(layout),
    lastConversationTabId: null,
    lastFileTabId: null,
    classicRatio: 0.56,
    rightPanelState: defaultRightPanelState(),
  }
}

function selectedTabId(workspace: WorktreeWorkspaceState): string | null {
  return workspace.groupSelection[workspace.focusedGroupId] ?? null
}

export function groupOfWorkbenchTab(
  workspace: Pick<WorktreeWorkspaceState, "groupOf" | "groupLayout">,
  tabId: string
): string {
  const assigned = workspace.groupOf[tabId]
  if (assigned && leafIds(workspace.groupLayout).includes(assigned)) {
    return assigned
  }
  return firstLeafId(workspace.groupLayout)
}

function resolveTargetGroup(
  workspace: WorktreeWorkspaceState,
  groupId: string | undefined,
  pane: WorkbenchPane
): string {
  const leaves = leafIds(workspace.groupLayout)
  if (groupId && leaves.includes(groupId)) return groupId
  return workbenchPaneGroup(workspace, pane)
}

function insertAt<T>(items: T[], item: T, index?: number): T[] {
  const at =
    index == null ? items.length : Math.max(0, Math.min(index, items.length))
  return [...items.slice(0, at), item, ...items.slice(at)]
}

function insertTabRefForGroup(
  workspace: WorktreeWorkspaceState,
  ref: WorkbenchTabRef,
  targetGroup: string,
  index?: number
): WorkbenchTabRef[] {
  const members: number[] = []
  workspace.tabRefs.forEach((tab, slot) => {
    if (groupOfWorkbenchTab(workspace, tab.id) === targetGroup)
      members.push(slot)
  })
  if (index == null) {
    const after = members[members.length - 1]
    return insertAt(
      workspace.tabRefs,
      ref,
      after == null ? workspace.tabRefs.length : after + 1
    )
  }
  const at = Math.max(0, Math.min(index, members.length))
  const insertIndex =
    at < members.length
      ? members[at]
      : members.length > 0
        ? members[members.length - 1] + 1
        : workspace.tabRefs.length
  return insertAt(workspace.tabRefs, ref, insertIndex)
}

function memberTabIds(
  workspace: WorktreeWorkspaceState,
  groupId: string
): string[] {
  return workspace.tabRefs
    .filter((tab) => groupOfWorkbenchTab(workspace, tab.id) === groupId)
    .map((tab) => tab.id)
}

function sameStringRecord(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  return ak.length === bk.length && ak.every((key) => a[key] === b[key])
}

function sameBoolRecord(
  a: Record<string, boolean>,
  b: Record<string, boolean>
): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  return ak.length === bk.length && ak.every((key) => a[key] === b[key])
}

function withInvariants(
  workspace: WorktreeWorkspaceState,
  options: { tabSetKnown?: boolean } = {}
): WorktreeWorkspaceState {
  const tabSetKnown = options.tabSetKnown ?? true
  const tabIds = new Set(workspace.tabRefs.map((tab) => tab.id))
  const groupLayout = workspace.groupLayout
  let groupOf = workspace.groupOf

  const layoutLeaves = new Set(leafIds(groupLayout))
  let nextGroupOf: Record<string, string> | null = null
  if (tabSetKnown) {
    for (const [tabId, groupId] of Object.entries(groupOf)) {
      if (!tabIds.has(tabId) || !layoutLeaves.has(groupId)) {
        nextGroupOf = nextGroupOf ?? { ...groupOf }
        delete nextGroupOf[tabId]
      }
    }
  } else {
    for (const [tabId, groupId] of Object.entries(groupOf)) {
      if (!layoutLeaves.has(groupId)) {
        nextGroupOf = nextGroupOf ?? { ...groupOf }
        delete nextGroupOf[tabId]
      }
    }
  }
  if (nextGroupOf) groupOf = nextGroupOf

  const first = firstLeafId(groupLayout)
  for (const tab of workspace.tabRefs) {
    if (!groupOf[tab.id] || !layoutLeaves.has(groupOf[tab.id])) {
      nextGroupOf = nextGroupOf ?? { ...groupOf }
      nextGroupOf[tab.id] = first
    }
  }
  if (nextGroupOf) groupOf = nextGroupOf

  const invariantWorkspace = { ...workspace, groupLayout, groupOf }
  const leaves = leafIds(groupLayout)
  const focusedGroupId = leaves.includes(workspace.focusedGroupId)
    ? workspace.focusedGroupId
    : firstLeafId(groupLayout)
  const selection: Record<string, string> = {}
  for (const groupId of leaves) {
    const members = memberTabIds(invariantWorkspace, groupId)
    if (members.length === 0) {
      const kept = workspace.groupSelection[groupId]
      if (!tabSetKnown && kept) selection[groupId] = kept
      continue
    }
    const current = workspace.groupSelection[groupId]
    selection[groupId] =
      current && members.includes(current) ? current : members[0]
  }

  const paneTabSelection: NonNullable<
    WorktreeWorkspaceState["paneTabSelection"]
  > = {}
  for (const groupId of leaves) {
    const remembered = workspace.paneTabSelection?.[groupId]
    if (!remembered) continue
    for (const pane of ["conversation", "files"] as const) {
      const id = remembered[pane]
      if (!id) continue
      const tab = workspace.tabRefs.find((ref) => ref.id === id)
      if (
        (tab && groupOf[tab.id] === groupId && tabBelongsToPane(tab, pane)) ||
        (!tabSetKnown && !tab)
      ) {
        paneTabSelection[groupId] = { ...paneTabSelection[groupId], [pane]: id }
      }
    }
  }
  const samePaneSelection = (
    a: typeof paneTabSelection,
    b: typeof paneTabSelection
  ) => {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every(
        (id) =>
          a[id].conversation === b[id]?.conversation &&
          a[id].files === b[id]?.files
      )
    )
  }

  const tileByGroup: Record<string, boolean> = {}
  const leafSet = new Set(leaves)
  for (const [groupId, tiled] of Object.entries(workspace.tileByGroup)) {
    if (leafSet.has(groupId)) tileByGroup[groupId] = tiled
  }

  const lastConversationTabId = workspace.tabRefs.some(
    (tab) =>
      tab.id === workspace.lastConversationTabId && tab.type === "conversation"
  )
    ? workspace.lastConversationTabId
    : null
  const lastFileTabId = workspace.tabRefs.some(
    (tab) => tab.id === workspace.lastFileTabId && tab.type !== "conversation"
  )
    ? workspace.lastFileTabId
    : null

  if (
    groupLayout === workspace.groupLayout &&
    groupOf === workspace.groupOf &&
    focusedGroupId === workspace.focusedGroupId &&
    sameStringRecord(selection, workspace.groupSelection) &&
    sameBoolRecord(tileByGroup, workspace.tileByGroup) &&
    samePaneSelection(paneTabSelection, workspace.paneTabSelection ?? {}) &&
    lastConversationTabId === workspace.lastConversationTabId &&
    lastFileTabId === workspace.lastFileTabId
  ) {
    return workspace
  }

  return {
    ...workspace,
    groupLayout,
    groupOf,
    groupSelection: selection,
    paneTabSelection,
    tileByGroup,
    focusedGroupId,
    lastConversationTabId,
    lastFileTabId,
  }
}

function activateWorkspaceTab(
  workspace: WorktreeWorkspaceState,
  tabId: string
): WorktreeWorkspaceState {
  const tab = workspace.tabRefs.find((item) => item.id === tabId)
  if (!tab) return workspace
  const groupId = groupOfWorkbenchTab(workspace, tabId)
  return withInvariants({
    ...workspace,
    focusedGroupId: groupId,
    groupSelection: { ...workspace.groupSelection, [groupId]: tabId },
    paneTabSelection: {
      ...workspace.paneTabSelection,
      [groupId]: {
        ...workspace.paneTabSelection?.[groupId],
        [tab.type === "conversation" ? "conversation" : "files"]: tabId,
      },
    },
    lastConversationTabId:
      tab.type === "conversation" ? tab.id : workspace.lastConversationTabId,
    lastFileTabId:
      tab.type !== "conversation" ? tab.id : workspace.lastFileTabId,
  })
}

function canonicalConversationId(runtimeId: string): string {
  return conversationPersistenceIds.get(runtimeId) ?? runtimeId
}

function canonicalizeWorkspaceForPersistence(
  workspace: WorktreeWorkspaceState
): WorktreeWorkspaceState {
  const idMap = new Map<string, string>()
  const tabRefs: WorkbenchTabRef[] = []
  const seen = new Set<string>()

  for (const ref of workspace.tabRefs) {
    const persistedId =
      ref.type === "conversation" ? canonicalConversationId(ref.id) : ref.id
    idMap.set(ref.id, persistedId)
    if (seen.has(persistedId)) continue
    seen.add(persistedId)
    tabRefs.push(
      ref.type === "conversation"
        ? { ...ref, id: persistedId, entityId: persistedId }
        : ref
    )
  }

  const groupOf: Record<string, string> = {}
  for (const ref of workspace.tabRefs) {
    const persistedId = idMap.get(ref.id)
    if (!persistedId || groupOf[persistedId] != null) continue
    const groupId = workspace.groupOf[ref.id]
    if (groupId) groupOf[persistedId] = groupId
  }

  const groupSelection: Record<string, string> = {}
  for (const [groupId, tabId] of Object.entries(workspace.groupSelection)) {
    const persistedId = idMap.get(tabId)
    if (persistedId) groupSelection[groupId] = persistedId
  }

  const paneTabSelection: NonNullable<
    WorktreeWorkspaceState["paneTabSelection"]
  > = {}
  for (const [groupId, selections] of Object.entries(
    workspace.paneTabSelection ?? {}
  )) {
    for (const pane of ["conversation", "files"] as const) {
      const id = selections[pane]
      const persisted = id ? idMap.get(id) : undefined
      if (persisted)
        paneTabSelection[groupId] = {
          ...paneTabSelection[groupId],
          [pane]: persisted,
        }
    }
  }

  const lastConversationTabId = workspace.lastConversationTabId
    ? (idMap.get(workspace.lastConversationTabId) ??
      canonicalConversationId(workspace.lastConversationTabId))
    : null
  const lastFileTabId = workspace.lastFileTabId
    ? (idMap.get(workspace.lastFileTabId) ?? workspace.lastFileTabId)
    : null

  return {
    ...workspace,
    tabRefs,
    groupOf,
    groupSelection,
    paneTabSelection,
    lastConversationTabId,
    lastFileTabId,
  }
}

function serializeState(state: WorkbenchStoreState): PersistedWorkbenchState {
  const workspaces = Object.fromEntries(
    Object.entries(state.workspaces).map(([key, workspace]) => [
      key,
      canonicalizeWorkspaceForPersistence(workspace),
    ])
  )
  const raw: PersistedWorkbenchState = {
    version: WORKBENCH_PERSISTENCE_VERSION,
    activeScopeId: state.activeScopeId,
    uiMode: state.uiMode,
    workspaces,
  }
  return sanitizePersistedWorkbenchState(raw) ?? raw
}

function persist() {
  if (!persistenceEnabled) return
  const state = useWorkbenchStore.getState()
  if (!state.hydrated) return
  writePersistedWorkbenchState(serializeState(state))
}

function updateWorkspace(
  workspaces: Record<string, WorktreeWorkspaceState>,
  scopeId: WorkspaceScopeId,
  updater: (workspace: WorktreeWorkspaceState) => WorktreeWorkspaceState
): Record<string, WorktreeWorkspaceState> {
  const normalized = normalizeScopeId(scopeId)
  const key = scopeKey(normalized)
  const current = workspaces[key] ?? createWorkspace(normalized)
  return { ...workspaces, [key]: updater(current) }
}

function sanitizeLegacyLayout(value: unknown): LayoutNode | null {
  const layout = sanitizeWorkbenchLayout(value)
  return layout.type === "group" && layout.id === "g-main" && value !== layout
    ? null
    : layout
}

function partitionLegacy(
  scopeId: WorkspaceScopeId,
  refs: WorkbenchTabRef[],
  legacy?: LegacyWorkbenchGroupState
): Partial<WorktreeWorkspaceState> {
  const layout = sanitizeLegacyLayout(legacy?.groupLayout)
  if (!legacy || !layout) return {}
  const tabIds = new Set(refs.map((ref) => ref.id))
  const leaves = new Set(leafIds(layout))
  const groupOf: Record<string, string> = {}
  if (legacy.groupOf && typeof legacy.groupOf === "object") {
    for (const [tabId, groupId] of Object.entries(
      legacy.groupOf as Record<string, unknown>
    )) {
      if (
        tabIds.has(tabId) &&
        typeof groupId === "string" &&
        leaves.has(groupId)
      ) {
        groupOf[tabId] = groupId
      }
    }
  }
  const first = firstLeafId(layout)
  const groupLayout = layout
  const normalizedLeaves = new Set(leafIds(groupLayout))
  for (const ref of refs) {
    if (!groupOf[ref.id] || !normalizedLeaves.has(groupOf[ref.id])) {
      groupOf[ref.id] = first
    }
  }
  const groupSelection: Record<string, string> = {}
  if (legacy.groupSelection && typeof legacy.groupSelection === "object") {
    for (const [groupId, tabId] of Object.entries(
      legacy.groupSelection as Record<string, unknown>
    )) {
      if (
        normalizedLeaves.has(groupId) &&
        typeof tabId === "string" &&
        tabIds.has(tabId)
      ) {
        groupSelection[groupId] = tabId
      }
    }
  }
  const tileByGroup: Record<string, boolean> = {}
  if (legacy.tileByGroup && typeof legacy.tileByGroup === "object") {
    for (const [groupId, tiled] of Object.entries(
      legacy.tileByGroup as Record<string, unknown>
    )) {
      if (normalizedLeaves.has(groupId) && typeof tiled === "boolean") {
        tileByGroup[groupId] = tiled
      }
    }
  }
  return {
    scopeId,
    groupLayout,
    groupOf,
    groupSelection,
    tileByGroup,
    focusedGroupId: firstLeafId(groupLayout),
  }
}

export const useWorkbenchStore = create<WorkbenchStoreState>((set, get) => ({
  ...initialState,

  hydrate: () => {
    if (get().hydrated) return
    const result = readPersistedWorkbenchState()
    persistenceEnabled = result.ok
    if (result.ok && result.state) {
      set({
        workspaces: result.state.workspaces,
        activeScopeId: result.state.activeScopeId,
        uiMode: result.state.uiMode,
        hydrated: true,
      })
      return
    }
    set({ hydrated: true })
  },

  activateScope: (scopeId) => {
    const normalized = normalizeScopeId(scopeId)
    set((state) => ({
      activeScopeId: normalized,
      workspaces: updateWorkspace(state.workspaces, normalized, (workspace) =>
        withInvariants(workspace)
      ),
    }))
    persist()
  },

  openTab: (scopeId, ref, options) => {
    const normalized = normalizeScopeId(scopeId)
    set((state) => {
      const workspaces = updateWorkspace(
        state.workspaces,
        normalized,
        (workspace) => {
          const existing = workspace.tabRefs.find((tab) => tab.id === ref.id)
          let next = workspace
          if (!existing) {
            const targetGroup = resolveTargetGroup(
              workspace,
              options?.groupId,
              ref.type === "conversation" ? "conversation" : "files"
            )
            next = {
              ...workspace,
              groupPane: {
                ...workspace.groupPane,
                [targetGroup]:
                  ref.type === "conversation" ? "conversation" : "files",
              },
              tabRefs: insertTabRefForGroup(
                workspace,
                ref,
                targetGroup,
                options?.index
              ),
              groupOf: { ...workspace.groupOf, [ref.id]: targetGroup },
            }
          }
          const shouldActivate =
            options?.activate === true ||
            (options?.activate !== false && options?.background !== true)
          return shouldActivate ? activateWorkspaceTab(next, ref.id) : next
        }
      )
      return {
        workspaces,
        activeScopeId:
          options?.background === true && options?.activate !== true
            ? state.activeScopeId
            : normalized,
      }
    })
    persist()
  },

  activateTab: (scopeId, tabId) => {
    const normalized = normalizeScopeId(scopeId)
    set((state) => ({
      activeScopeId: normalized,
      workspaces: updateWorkspace(state.workspaces, normalized, (workspace) =>
        activateWorkspaceTab(workspace, tabId)
      ),
    }))
    persist()
  },

  closeTab: (scopeId, tabId) => {
    const normalized = normalizeScopeId(scopeId)
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, normalized, (workspace) => {
        const closing = workspace.tabRefs.find((tab) => tab.id === tabId)
        if (!closing) return workspace
        const nextRefs = workspace.tabRefs.filter((tab) => tab.id !== tabId)
        const groupOf = { ...workspace.groupOf }
        delete groupOf[tabId]
        const groupSelection = { ...workspace.groupSelection }
        for (const [groupId, selected] of Object.entries(groupSelection)) {
          if (selected === tabId) delete groupSelection[groupId]
        }
        let next = withInvariants({
          ...workspace,
          tabRefs: nextRefs,
          groupOf,
          groupSelection,
        })
        if (selectedTabId(workspace) === tabId && next.tabRefs.length > 0) {
          const closedGroup = groupOfWorkbenchTab(workspace, tabId)
          const remainingInGroup = next.tabRefs.filter(
            (tab) => groupOfWorkbenchTab(next, tab.id) === closedGroup
          )
          const neighbor = neighborGroupId(workspace.groupLayout, closedGroup)
          const replacement =
            remainingInGroup[0]?.id ??
            (neighbor ? next.groupSelection[neighbor] : null) ??
            next.tabRefs[0].id
          next = activateWorkspaceTab(next, replacement)
        }
        return next
      }),
    }))
    persist()
  },

  closeEntityTabs: (entityId) => {
    set((state) => {
      let changed = false
      const workspaces: Record<string, WorktreeWorkspaceState> = {}
      for (const [key, workspace] of Object.entries(state.workspaces)) {
        const ids = new Set(
          workspace.tabRefs
            .filter((tab) => tab.entityId === entityId)
            .map((tab) => tab.id)
        )
        if (ids.size === 0) {
          workspaces[key] = workspace
          continue
        }
        changed = true
        const groupOf = { ...workspace.groupOf }
        const groupSelection = { ...workspace.groupSelection }
        for (const id of ids) {
          delete groupOf[id]
          for (const [groupId, selected] of Object.entries(groupSelection)) {
            if (selected === id) delete groupSelection[groupId]
          }
        }
        workspaces[key] = withInvariants({
          ...workspace,
          tabRefs: workspace.tabRefs.filter((tab) => !ids.has(tab.id)),
          groupOf,
          groupSelection,
        })
      }
      return changed ? { workspaces } : {}
    })
    persist()
  },

  focusGroup: (scopeId, groupId) => {
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, scopeId, (workspace) =>
        leafIds(workspace.groupLayout).includes(groupId)
          ? { ...workspace, focusedGroupId: groupId }
          : workspace
      ),
    }))
    persist()
  },

  split: (scopeId, groupId, direction, pane) => {
    const newGroupId = makeGroupId()
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, scopeId, (workspace) => {
        const nextLayout = splitGroup(
          workspace.groupLayout,
          groupId,
          direction,
          newGroupId
        )
        if (nextLayout === workspace.groupLayout) return workspace
        const splittingPane =
          pane ??
          (workspace.tabRefs.find(
            (tab) => tab.id === workspace.groupSelection[groupId]
          )?.type === "conversation"
            ? "conversation"
            : "files")
        const otherPane =
          splittingPane === "conversation" ? "files" : "conversation"
        const ownLayout = splitGroup(
          workbenchPaneLayout(workspace, splittingPane),
          groupId,
          direction,
          newGroupId
        )
        return withInvariants({
          ...workspace,
          groupLayout: nextLayout,
          groupPane: { ...workspace.groupPane, [newGroupId]: splittingPane },
          paneSplitRatios: {
            ...workspace.paneSplitRatios,
            [splittingPane]: paneRatiosForLayout(ownLayout),
            [otherPane]: paneRatiosForLayout(
              workbenchPaneLayout(workspace, otherPane)
            ),
          },
          focusedGroupId: newGroupId,
        })
      }),
    }))
    persist()
    return newGroupId
  },

  moveTab: (scopeId, tabId, targetGroupId, index) => {
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, scopeId, (workspace) => {
        if (!workspace.tabRefs.some((tab) => tab.id === tabId)) return workspace
        if (!leafIds(workspace.groupLayout).includes(targetGroupId)) {
          return workspace
        }
        const moving = workspace.tabRefs.find((tab) => tab.id === tabId)
        if (!moving) return workspace
        let tabRefs = workspace.tabRefs
        if (index != null) {
          const without = workspace.tabRefs.filter((tab) => tab.id !== tabId)
          const slots: number[] = []
          without.forEach((tab, slot) => {
            if (groupOfWorkbenchTab(workspace, tab.id) === targetGroupId) {
              slots.push(slot)
            }
          })
          const at = Math.max(0, Math.min(index, slots.length))
          const insert =
            at < slots.length
              ? slots[at]
              : slots.length > 0
                ? slots[slots.length - 1] + 1
                : without.length
          tabRefs = insertAt(without, moving, insert)
        }
        return activateWorkspaceTab(
          {
            ...workspace,
            tabRefs,
            groupOf: { ...workspace.groupOf, [tabId]: targetGroupId },
          },
          tabId
        )
      }),
    }))
    persist()
  },

  reorderGroupTabs: (scopeId, groupId, orderedIds) => {
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, scopeId, (workspace) => {
        const slots: number[] = []
        workspace.tabRefs.forEach((tab, index) => {
          if (groupOfWorkbenchTab(workspace, tab.id) === groupId)
            slots.push(index)
        })
        if (slots.length !== orderedIds.length) return workspace
        const ids = new Set(slots.map((slot) => workspace.tabRefs[slot].id))
        if (new Set(orderedIds).size !== orderedIds.length) return workspace
        if (!orderedIds.every((id) => ids.has(id))) return workspace
        const byId = new Map(workspace.tabRefs.map((tab) => [tab.id, tab]))
        const tabRefs = [...workspace.tabRefs]
        orderedIds.forEach((id, index) => {
          const tab = byId.get(id)
          if (tab) tabRefs[slots[index]] = tab
        })
        return { ...workspace, tabRefs }
      }),
    }))
    persist()
  },

  resizeSplit: (scopeId, splitId, handleIndex, boundaryFraction) => {
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, scopeId, (workspace) => ({
        ...workspace,
        groupLayout: resizeSplitAt(
          workspace.groupLayout,
          splitId,
          handleIndex,
          boundaryFraction
        ),
      })),
    }))
    persist()
  },

  resizePaneSplit: (scopeId, pane, splitId, handleIndex, fraction) => {
    if (!Number.isFinite(fraction)) return
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, scopeId, (workspace) => {
        const layout = workbenchPaneLayout(workspace, pane)
        const resized = resizeSplitAt(layout, splitId, handleIndex, fraction)
        if (resized === layout) return workspace
        const find = (node: LayoutNode): number[] | undefined => {
          if (node.type === "group") return undefined
          if (node.id === splitId) return node.ratios
          for (const child of node.children) {
            const ratios = find(child)
            if (ratios) return ratios
          }
        }
        const ratios = find(resized)
        if (!ratios) return workspace
        return {
          ...workspace,
          paneSplitRatios: {
            ...workspace.paneSplitRatios,
            [pane]: {
              ...workspace.paneSplitRatios?.[pane],
              [splitId]: ratios,
            },
          },
        }
      }),
    }))
    persist()
  },

  dissolveGroup: (scopeId, groupId, pane) => {
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, scopeId, (workspace) => {
        const paneLayout = pane
          ? workbenchPaneLayout(workspace, pane)
          : workspace.groupLayout
        const target = neighborGroupId(paneLayout, groupId)
        if (!target) return workspace
        const groupOf = { ...workspace.groupOf }
        for (const tab of workspace.tabRefs) {
          if (
            groupOfWorkbenchTab(workspace, tab.id) === groupId &&
            (!pane || tabBelongsToPane(tab, pane))
          )
            groupOf[tab.id] = target
        }
        const remains = workspace.tabRefs.some(
          (tab) => groupOf[tab.id] === groupId
        )
        const otherPane = pane === "conversation" ? "files" : "conversation"
        return withInvariants({
          ...workspace,
          groupOf,
          groupLayout: remains
            ? workspace.groupLayout
            : removeGroup(workspace.groupLayout, groupId),
          paneSplitRatios: pane
            ? {
                ...workspace.paneSplitRatios,
                [pane]: paneRatiosForLayout(removeGroup(paneLayout, groupId)),
                [otherPane]: paneRatiosForLayout(
                  workbenchPaneLayout(workspace, otherPane)
                ),
              }
            : workspace.paneSplitRatios,
          focusedGroupId:
            workspace.focusedGroupId === groupId
              ? target
              : workspace.focusedGroupId,
        })
      }),
    }))
    persist()
  },

  unsplitAll: (scopeId, pane) => {
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, scopeId, (workspace) => {
        if (!pane) {
          const first = firstLeafId(workspace.groupLayout)
          return withInvariants({
            ...workspace,
            groupLayout: singleGroupLayout(first),
            groupOf: {},
            focusedGroupId: first,
            groupPane: {},
            paneSplitRatios: {},
          })
        }
        const layout = workbenchPaneLayout(workspace, pane)
        const first = firstLeafId(layout)
        const groupOf = { ...workspace.groupOf }
        for (const tab of workspace.tabRefs) {
          if (tabBelongsToPane(tab, pane)) groupOf[tab.id] = first
        }
        let groupLayout = workspace.groupLayout
        for (const id of leafIds(layout)) {
          if (
            id !== first &&
            !workspace.tabRefs.some((tab) => groupOf[tab.id] === id)
          )
            groupLayout = removeGroup(groupLayout, id)
        }
        const otherPane = pane === "conversation" ? "files" : "conversation"
        return withInvariants({
          ...workspace,
          groupOf,
          groupLayout,
          focusedGroupId: first,
          paneSplitRatios: {
            ...workspace.paneSplitRatios,
            [pane]: {},
            [otherPane]: paneRatiosForLayout(
              workbenchPaneLayout(workspace, otherPane)
            ),
          },
        })
      }),
    }))
    persist()
  },

  toggleGroupTile: (scopeId, groupId) => {
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, scopeId, (workspace) =>
        leafIds(workspace.groupLayout).includes(groupId)
          ? {
              ...workspace,
              tileByGroup: {
                ...workspace.tileByGroup,
                [groupId]: !workspace.tileByGroup[groupId],
              },
            }
          : workspace
      ),
    }))
    persist()
  },

  toggleGroupOrientation: (scopeId, groupId) => {
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, scopeId, (workspace) => ({
        ...workspace,
        groupLayout: toggleOrientation(workspace.groupLayout, groupId),
      })),
    }))
    persist()
  },

  patchRightPanel: (scopeId, patch) => {
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, scopeId, (workspace) => {
        const update =
          typeof patch === "function" ? patch(workspace.rightPanelState) : patch
        return {
          ...workspace,
          rightPanelState: {
            ...workspace.rightPanelState,
            ...update,
            git: {
              ...workspace.rightPanelState.git,
              ...(update.git ?? {}),
            },
          },
        }
      }),
    }))
    persist()
  },

  setClassicRatio: (scopeId, ratio) => {
    if (!Number.isFinite(ratio)) return
    const classicRatio = Math.min(Math.max(ratio, 0.2), 0.8)
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, scopeId, (workspace) => ({
        ...workspace,
        classicRatio,
      })),
    }))
    persist()
  },

  setUiMode: (mode) => {
    set({ uiMode: mode })
    persist()
  },

  reconcileConversations: (tabs, activeConversationTabId, known, legacy) => {
    if (known) {
      conversationPersistenceIds = new Map(
        tabs.map((tab) => [tab.id, tab.persistenceId ?? tab.id])
      )
    } else {
      for (const tab of tabs) {
        conversationPersistenceIds.set(tab.id, tab.persistenceId ?? tab.id)
      }
    }

    set((state) => {
      const incomingByScope = new Map<string, WorkbenchTabRef[]>()
      for (const tab of tabs) {
        const scopeId = scopeIdForFolder(tab.folderId, tab.isChat)
        const key = scopeKey(scopeId)
        const ref: WorkbenchTabRef = {
          id: tab.id,
          type: "conversation",
          entityId: tab.id,
        }
        incomingByScope.set(key, [...(incomingByScope.get(key) ?? []), ref])
      }

      const workspaces = { ...state.workspaces }
      const touched = known
        ? new Set([
            ...Object.keys(workspaces),
            ...Array.from(incomingByScope.keys()),
          ])
        : new Set(incomingByScope.keys())

      for (const key of touched) {
        const scopeId = key === "global" ? "global" : Number(key)
        const workspace = workspaces[key] ?? createWorkspace(scopeId)
        const incoming = incomingByScope.get(key) ?? []
        const incomingIds = new Set(incoming.map((ref) => ref.id))
        // Server snapshots establish membership, not the user's mixed tab order.
        const retained = workspace.tabRefs.filter(
          (ref) =>
            ref.type !== "conversation" || !known || incomingIds.has(ref.id)
        )
        const retainedIds = new Set(retained.map((ref) => ref.id))
        const tabRefs = [
          ...retained,
          ...incoming.filter((ref) => !retainedIds.has(ref.id)),
        ]
        const conversationRefs = tabRefs.filter(
          (ref) => ref.type === "conversation"
        )
        const legacySeed =
          workspace.tabRefs.length === 0
            ? partitionLegacy(scopeId, conversationRefs, legacy)
            : {}
        let next = withInvariants(
          {
            ...workspace,
            ...legacySeed,
            tabRefs,
            lastConversationTabId:
              activeConversationTabId &&
              conversationRefs.some((ref) => ref.id === activeConversationTabId)
                ? activeConversationTabId
                : workspace.lastConversationTabId,
          },
          { tabSetKnown: known }
        )

        if (
          activeConversationTabId &&
          next.tabRefs.some((ref) => ref.id === activeConversationTabId)
        ) {
          const current = selectedTabId(next)
          const currentRef = next.tabRefs.find((ref) => ref.id === current)
          if (!currentRef || currentRef.type === "conversation") {
            next = activateWorkspaceTab(next, activeConversationTabId)
          }
        }
        workspaces[key] = next
      }

      return { workspaces }
    })
    persist()
  },

  pruneScopes: (folderIds, options = {}) => {
    if (options.authoritative !== true) return
    const live = new Set(
      folderIds.filter((id) => id > 0).map((id) => String(id))
    )
    set((state) => {
      const next: Record<string, WorktreeWorkspaceState> = {}
      let global = state.workspaces.global ?? createWorkspace("global")
      for (const [key, workspace] of Object.entries(state.workspaces)) {
        if (key === "global" || live.has(key)) {
          next[key] = workspace
          continue
        }
        const existing = new Set(global.tabRefs.map((tab) => tab.id))
        const detached = workspace.tabRefs.filter(
          (tab) => !existing.has(tab.id)
        )
        if (detached.length > 0) {
          const groupId = firstLeafId(global.groupLayout)
          const groupOf = { ...global.groupOf }
          for (const tab of detached) groupOf[tab.id] = groupId
          global = withInvariants({
            ...global,
            tabRefs: [...global.tabRefs, ...detached],
            groupOf,
          })
        }
      }
      next.global = global
      return {
        workspaces: next,
        activeScopeId:
          state.activeScopeId !== "global" &&
          !live.has(String(state.activeScopeId))
            ? "global"
            : state.activeScopeId,
      }
    })
    persist()
  },
}))

export function getActiveWorkspace(
  state: Pick<WorkbenchStoreState, "activeScopeId" | "workspaces">
): WorktreeWorkspaceState {
  const key = scopeKey(state.activeScopeId)
  return state.workspaces[key] ?? createWorkspace(state.activeScopeId)
}

export function getWorkspace(
  state: Pick<WorkbenchStoreState, "workspaces">,
  scopeId: WorkspaceScopeId
): WorktreeWorkspaceState {
  return (
    state.workspaces[scopeKey(normalizeScopeId(scopeId))] ??
    createWorkspace(scopeId)
  )
}

export function selectActiveWorkbenchTab(
  state: Pick<WorkbenchStoreState, "activeScopeId" | "workspaces">
): WorkbenchTabRef | null {
  const workspace = getActiveWorkspace(state)
  const selected = selectedTabId(workspace)
  return workspace.tabRefs.find((tab) => tab.id === selected) ?? null
}

export function __resetWorkbenchStoreForTests(): void {
  persistenceEnabled = true
  conversationPersistenceIds = new Map()
  useWorkbenchStore.setState({ ...initialState })
}

registerBackendScopedStoreReset(() => {
  __resetWorkbenchStoreForTests()
})
