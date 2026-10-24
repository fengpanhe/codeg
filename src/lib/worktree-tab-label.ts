import { formatFolderLabelWithAlias } from "@/lib/folder-display"
import type { FolderDetail } from "@/lib/types"
import type { WorkspaceScopeId } from "@/types/workbench"

type WorktreeLabelFolder = Pick<
  FolderDetail,
  "id" | "name" | "parent_id" | "alias"
>

export function formatWorktreeTabLabel(
  scopeId: WorkspaceScopeId | null,
  folders: readonly WorktreeLabelFolder[],
  globalLabel: string,
  emptyLabel: string
): string {
  if (scopeId == null) return emptyLabel
  if (scopeId === "global") return globalLabel

  const folder = folders.find((item) => item.id === scopeId)
  if (!folder) return String(scopeId)

  const root =
    folder.parent_id == null
      ? folder
      : (folders.find((item) => item.id === folder.parent_id) ?? folder)
  const project = formatFolderLabelWithAlias(root)
  const worktree =
    folder.parent_id == null || root.id === folder.id ? "root" : folder.name
  return project + "-" + worktree
}
