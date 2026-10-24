import { useWorktreeTabsStore } from "@/stores/worktree-tabs-store"
import type { WorkspaceScopeId } from "@/types/workbench"

export function canActivateWorkbenchScopeWithOuterTab(
  scopeId: WorkspaceScopeId
): boolean {
  return useWorktreeTabsStore.getState().canOpenWorktree(scopeId)
}

export function activateWorkbenchScopeWithOuterTab(
  scopeId: WorkspaceScopeId
): boolean {
  return useWorktreeTabsStore.getState().openWorktree(scopeId)
}
