import { describe, expect, it } from "vitest"
import { formatWorktreeTabLabel } from "@/lib/worktree-tab-label"

const folders = [
  {
    id: 1,
    name: "codeg",
    path: "/work/codeg",
    parent_id: null,
    alias: "CodeG UI",
  },
  {
    id: 2,
    name: "feature-tabs",
    path: "/work/codeg-feature-tabs",
    parent_id: 1,
    alias: null,
  },
  {
    id: 3,
    name: "orphan-branch",
    path: "/work/orphan-branch",
    parent_id: 99,
    alias: "Detached",
  },
]

describe("formatWorktreeTabLabel", () => {
  it("distinguishes empty and global scopes", () => {
    expect(formatWorktreeTabLabel(null, folders, "Chat", "Empty")).toBe("Empty")
    expect(formatWorktreeTabLabel("global", folders, "Chat", "Empty")).toBe(
      "Chat"
    )
  })

  it("formats root folders as project-root and child worktrees as project-worktree", () => {
    expect(formatWorktreeTabLabel(1, folders, "Chat", "Empty")).toBe(
      "CodeG UI [ codeg ]-root"
    )
    expect(formatWorktreeTabLabel(2, folders, "Chat", "Empty")).toBe(
      "CodeG UI [ codeg ]-feature-tabs"
    )
  })

  it("falls back to the worktree folder when its root is unavailable", () => {
    expect(formatWorktreeTabLabel(3, folders, "Chat", "Empty")).toBe(
      "Detached [ orphan-branch ]-root"
    )
  })
})
