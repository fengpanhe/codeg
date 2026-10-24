import {
  firstLeafId,
  leafIds,
  normalizeTree,
  type LayoutNode,
} from "@/lib/tab-group-layout"
import type {
  WorkbenchPane,
  WorkbenchTabRef,
  WorktreeWorkspaceState,
} from "@/types/workbench"

export function tabBelongsToPane(tab: WorkbenchTabRef, pane: WorkbenchPane) {
  return pane === "conversation"
    ? tab.type === "conversation"
    : tab.type !== "conversation"
}

export function paneTabRefs(
  workspace: WorktreeWorkspaceState,
  pane: WorkbenchPane,
  groupId: string
) {
  return workspace.tabRefs.filter(
    (tab) =>
      workspace.groupOf[tab.id] === groupId && tabBelongsToPane(tab, pane)
  )
}

export function paneSelectedTabId(
  workspace: WorktreeWorkspaceState,
  pane: WorkbenchPane,
  groupId: string
) {
  const tabs = paneTabRefs(workspace, pane, groupId)
  const selected = workspace.groupSelection[groupId]
  const last =
    pane === "conversation"
      ? workspace.lastConversationTabId
      : workspace.lastFileTabId
  const remembered = workspace.paneTabSelection?.[groupId]?.[pane]
  return (
    tabs.find((tab) => tab.id === selected)?.id ??
    tabs.find((tab) => tab.id === remembered)?.id ??
    tabs.find((tab) => tab.id === last)?.id ??
    tabs[0]?.id
  )
}

/** Project the shared reference tree into two separate tab regions. Empty
 * splits remember their pane, including when restored from local storage. */
export function workbenchPaneLayout(
  workspace: WorktreeWorkspaceState,
  pane: WorkbenchPane
): LayoutNode {
  const groups = new Set<string>()
  for (const tab of workspace.tabRefs) {
    if (tabBelongsToPane(tab, pane)) groups.add(workspace.groupOf[tab.id])
  }
  const leaves = leafIds(workspace.groupLayout)
  for (const id of leaves) {
    if (workspace.tabRefs.some((tab) => workspace.groupOf[tab.id] === id))
      continue
    const hint = workspace.groupPane?.[id]
    if (hint === pane) groups.add(id)
    // Old snapshots have no hint. Keep their empty groups in the pane of the
    // closest preceding occupied group, so existing splits remain accessible.
    if (!hint) {
      const preceding = leaves.slice(0, leaves.indexOf(id)).reverse()
      const neighbor = preceding
        .map((group) =>
          workspace.tabRefs.find((tab) => workspace.groupOf[tab.id] === group)
        )
        .find(Boolean)
      if (neighbor && tabBelongsToPane(neighbor, pane)) groups.add(id)
    }
  }
  if (groups.size === 0) groups.add(firstLeafId(workspace.groupLayout))
  const projected = normalizeTree(workspace.groupLayout, groups)
  const ratios = workspace.paneSplitRatios?.[pane]
  const applyRatios = (node: LayoutNode): LayoutNode => {
    if (node.type === "group") return node
    const saved = ratios?.[node.id]
    return {
      ...node,
      children: node.children.map(applyRatios),
      ratios: saved?.length === node.children.length ? saved : node.ratios,
    }
  }
  return applyRatios(projected)
}

export function workbenchPaneGroup(
  workspace: WorktreeWorkspaceState,
  pane: WorkbenchPane
): string {
  const groups = leafIds(workbenchPaneLayout(workspace, pane))
  const focused = workspace.focusedGroupId
  const selected = workspace.tabRefs.find(
    (tab) => tab.id === workspace.groupSelection[focused]
  )
  if (
    groups.includes(focused) &&
    (selected
      ? tabBelongsToPane(selected, pane)
      : workspace.groupPane?.[focused] === pane)
  )
    return focused
  const last =
    pane === "conversation"
      ? workspace.lastConversationTabId
      : workspace.lastFileTabId
  const lastGroup = last ? workspace.groupOf[last] : undefined
  return lastGroup && groups.includes(lastGroup) ? lastGroup : groups[0]
}

export function paneRatiosForLayout(
  layout: LayoutNode
): Record<string, number[]> {
  const ratios: Record<string, number[]> = {}
  const collect = (node: LayoutNode) => {
    if (node.type === "group") return
    ratios[node.id] = node.ratios
    node.children.forEach(collect)
  }
  collect(layout)
  return ratios
}
