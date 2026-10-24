import { useWorktreeTabsStore } from "@/stores/worktree-tabs-store"
import type { WorkspaceScopeId } from "@/types/workbench"

export function activateWorkbenchScopeWithOuterTab(
  scopeId: WorkspaceScopeId
): void {
  useWorktreeTabsStore.getState().openWorktree(scopeId)
}
