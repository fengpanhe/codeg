import type { WorktreeWorkspaceState } from "@/types/workbench"

export type ClassicWorkbenchPane = "conversation" | "files"

export function classicGroup(
  workspace: WorktreeWorkspaceState,
  type: ClassicWorkbenchPane
): string {
  const matches = (id: string) => {
    const tab = workspace.tabRefs.find((item) => item.id === id)
    return (
      tab &&
      (type === "conversation"
        ? tab.type === "conversation"
        : tab.type !== "conversation")
    )
  }
  const focused = workspace.focusedGroupId
  if (
    workspace.tabRefs.some(
      (tab) => workspace.groupOf[tab.id] === focused && matches(tab.id)
    )
  )
    return focused
  const last =
    type === "conversation"
      ? workspace.lastConversationTabId
      : workspace.lastFileTabId
  if (last && matches(last)) return workspace.groupOf[last] ?? focused
  const first = workspace.tabRefs.find((tab) => matches(tab.id))
  return first ? (workspace.groupOf[first.id] ?? focused) : focused
}

export function classicTabRefs(
  workspace: WorktreeWorkspaceState,
  type: ClassicWorkbenchPane
) {
  const group = classicGroup(workspace, type)
  return workspace.tabRefs.filter(
    (tab) =>
      workspace.groupOf[tab.id] === group &&
      (type === "conversation"
        ? tab.type === "conversation"
        : tab.type !== "conversation")
  )
}

export function classicSelectedTabId(
  workspace: WorktreeWorkspaceState,
  type: ClassicWorkbenchPane
): string | undefined {
  const group = classicGroup(workspace, type)
  const tabs = classicTabRefs(workspace, type)
  const selected = workspace.groupSelection[group]
  const last =
    type === "conversation"
      ? workspace.lastConversationTabId
      : workspace.lastFileTabId
  return (
    tabs.find((tab) => tab.id === selected)?.id ??
    tabs.find((tab) => tab.id === last)?.id ??
    tabs[0]?.id
  )
}
