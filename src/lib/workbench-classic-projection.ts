import type { WorktreeWorkspaceState, WorkbenchPane } from "@/types/workbench"
import {
  paneSelectedTabId,
  paneTabRefs,
  workbenchPaneGroup,
} from "@/lib/workbench-pane-layout"

export type ClassicWorkbenchPane = WorkbenchPane

export const classicGroup = workbenchPaneGroup

export function classicTabRefs(
  workspace: WorktreeWorkspaceState,
  type: ClassicWorkbenchPane
) {
  return paneTabRefs(workspace, type, classicGroup(workspace, type))
}

export function classicSelectedTabId(
  workspace: WorktreeWorkspaceState,
  type: ClassicWorkbenchPane
): string | undefined {
  return paneSelectedTabId(workspace, type, classicGroup(workspace, type))
}
