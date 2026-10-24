# Worktree Workbench Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement client-only two-level Worktree navigation, a project sidebar, left-side conversation history, and deliver macOS dev clients.

**Architecture:** WorktreeTabsStore owns outer tab entries; WorkbenchStore continues to own per-scope content. Empty outer entries hide and inert the retained canvas without destroying it. Navigation coordinator synchronizes deliberate existing scope activations; passive data loads never replace empty tabs.

**Tech Stack:** Next.js 16 static export, React 19, TypeScript, Zustand, next-intl, Vitest, Tauri 2, macOS GitHub Actions.

**Spec:** docs/worktree-workbench-tabs-design.md

## Global Constraints

- All business changes are client-only; do not modify Rust source, SQLite, or opened_tabs protocol.
- Existing Workbench state, dirty file buffers, shared Monaco models and live sessions must survive outer-tab replacement/closing and interface switching.
- Multiple temporary and empty tabs may coexist. Selecting an existing Worktree always activates its existing tab first.
- Unpin does not close or replace other temporary tabs. Pinned entries occupy the left segment.
- Empty outer scope is null, distinct from global chat scope; it hides retained content and blocks destructive content shortcuts.
- History trigger is on the LEFT of the conversation tab strip; sidebar in new mode displays only projects and Worktrees.
- Current new_ui linked worktree is already isolated. Never stage the user's worktree-workbench-handoff.md or any task scratch.
- Corepack pnpm uses Node /data00/home/fengpanhe/.nvm/versions/node/v24.18.0/bin, COREPACK_HOME=/tmp/codeg-corepack. Shell sandbox lacks bwrap; use authorized require_escalated calls.
- Native macOS builds run in CI. Concrete dev name/identifier are transient inputs, not edits to formal product config. No shared branch push, release/tag or merge.
- Implementers own only their listed files and must not dispatch subagents. Other workers/controller may operate read-only or on docs/build tooling; do not revert their work.

---

### Task 1: Outer Worktree tab state and navigation coordination

**Files:**
- Create: src/stores/worktree-tabs-store.ts
- Create: src/stores/worktree-tabs-store.test.ts
- Create: src/lib/worktree-tabs-persistence.ts and its test
- Create: src/lib/worktree-tab-label.ts and its test
- Create: src/lib/worktree-tabs-navigation.ts (if needed for explicit activation coordination)
- Modify: src/stores/workbench-store.ts, src/stores/tab-store.ts, src/types/workbench.ts only for deliberate navigation synchronization; preserve runtime conversation IDs and legacy projection.
- Test: existing workbench-store and tab-context regression files only if new navigation contract needs additional coverage.

**Interfaces:**
```ts
interface WorktreeWorkbenchTab {
  id: string
  scopeId: WorkspaceScopeId | null
  isPinned: boolean
}
interface WorktreeTabsState {
  tabs: WorktreeWorkbenchTab[]
  activeTabId: string | null
  hydrated: boolean
  hydrate(): void
  openWorktree(scopeId: WorkspaceScopeId): void
  createEmptyTab(): void
  activateTab(id: string): void
  closeTab(id: string): void
  setPinned(id: string, pinned: boolean): void
}
// Export Zustand useWorktreeTabsStore and test reset helper.
// Export pure formatWorktreeTabLabel(scopeId, folders, globalLabel, emptyLabel).
// A selector/hook can identify new-mode empty presentation using uiMode and
// the selected outer entry; it must not mutate the underlying activeScope.
```
Consumes existing scope activation and getWorkbenchPersistenceNamespace. Produces the above APIs for Tasks 2/3.

- [ ] Write failing state tests before implementing: existing-tab selection wins over empty/temporary replacement; current pinned opens another temporary; unpin leaves existing temporaries; + creates a null-scope placeholder; replacement retains Workbench references/dirty entities; empty is not global; reload/backend namespace isolation and rejected-cache preservation.
```ts
store.openWorktree(1)
const a = currentId()
store.setPinned(a, true)
store.createEmptyTab()
const blank = currentId()
store.openWorktree(1)
expect(currentId()).toBe(a)
expect(state().tabs.find(t => t.id === blank)?.scopeId).toBeNull()
store.setPinned(a, false)
expect(state().tabs).toHaveLength(2)
```
- [ ] Run only the new state/persistence tests and capture expected RED failures.
- [ ] Implement pure bounded cache validation with namespace keys, backend reset and write protection. Implement outer mutations and stable IDs. Opening/activation sets the underlying numeric/global scope; selecting empty keeps prior scope retained but hidden. Deliberate scope activations from existing routes synchronize outer navigation; passive reconciliation cannot steal blank focus. Hydration must restore selected empty without auto-filling it.
- [ ] Run new state tests plus existing workbench-store and tab-context tests. Add meaningful regressions if coordinator behavior changes those paths.
- [ ] Commit owned files; write report with exact commands, RED/GREEN evidence and public APIs.

### Task 2: Left-side conversation history dropdown

**Files:**
- Create: src/components/workbench/workbench-conversation-history.tsx and test
- Modify: src/components/workbench/workbench-tab-bar.tsx and its related source test only for the history placement
- Modify: all 10 src/i18n/messages locale files for History.* text under Workbench (coordinate exact keys with next task)

**Interfaces:**
```ts
export function WorkbenchConversationHistory(props: {
  scopeId: WorkspaceScopeId
  groupId: string
}): React.ReactNode
// Place this as the first control of conversation strips, before tabs.
// Opening a result: useWorktreeTabsStore.getState().openWorktree(scopeIdForFolder(...));
// then the existing useTabActions().openTab for the result's folder/id/agent.
```
Consumes Task 1 outer navigation API and listAllConversations/listChildConversations. Produces the history control for existing/new-mode conversation bars.

- [ ] Write failing behavior tests for left placement, current Worktree folderIds, project root+child folderIds, global chat restriction, searching, empty/error/retry, stale completion after scope/range changes, and opening an already-open session through the existing action.
```ts
fireEvent.click(screen.getByRole("button", { name: "History" }))
await waitFor(() => expect(listAllConversations).toHaveBeenCalledWith(
  expect.objectContaining({ folder_ids: [worktreeId], include_children: true })
))
```
- [ ] Capture RED run on the new component test.
- [ ] Implement a compact accessible Popover/Dropdown with search and current/project range. Use existing server search without introducing pagination API; sort/display existing title, agent, status and updated_at. Guard late results by request generation and handle failure with retry. A result activates its outer Worktree first, then opens/activates its conversation. Add translated strings in every locale.
- [ ] Run the new history test and workbench-surface/workspace chrome regressions. Keep unrelated UI mocked only at boundaries.
- [ ] Commit owned files and report exact APIs/translation keys for Task 3.

### Task 3: Project sidebar, outer bar and full shell integration

**Files:**
- Create: src/components/workbench/worktree-workbench-tab-bar.tsx and test
- Create: src/components/workbench/workbench-project-sidebar.tsx and test
- Create: src/hooks/use-worktree-workbench-presentation.ts (if the hook belongs in lib instead, report exact path)
- Modify: src/components/layout/sidebar.tsx and tests for new vs classic presentation
- Modify: src/app/workspace/layout.tsx and related shell source/behavior tests
- Modify: src/components/workbench/workbench-surface.tsx and test
- Modify: src/components/layout/workspace-chrome-controller.tsx and test for empty outer entry shortcuts
- Modify: src/components/layout/status-bar-workbench-mode.tsx only if routing into new mode needs bootstrap
- Modify: src/components/conversations/conversation-detail-panel.tsx only if empty-entry auto-draft guarding needs it
- Modify: src/i18n/messages all 10 locales for outer/navigation/empty-project strings
- Modify: docs/worktree-workbench.md for actual final behavior

**Interfaces:**
Consumes Task 1 WorktreeTabsState and Task 2 history control. Produces a first-row outer Worktree bar across the full right workspace (main + aux), below which existing per-scope separate panes remain mounted. The presentation hook returns `isEmptyWorkbench` for a selected null entry or no active outer entry in new mode; classic mode never hides content merely because outer navigation is empty.

- [ ] Write failing integration behavior tests: several pinned+temporary entries, unpin preserves others, + blank/fill, existing lookup first, project/worktree label resolution, sidebars by mode, full-width right-side header, scope-switch memory for both child panes and aux state, keep-alive mount counters, null-entry content invisible/inert, and Ctrl+W/Tab/S cannot affect retained hidden scope.
```ts
const previousScope = useWorkbenchStore.getState().activeScopeId
act(() => useWorktreeTabsStore.getState().createEmptyTab())
expect(useWorkbenchStore.getState().activeScopeId).toBe(previousScope)
expect(screen.queryByRole("tab", { name: "old session" })).toBeNull()
expect(fileEntity.isDirty).toBe(true)
```
- [ ] Capture RED runs for the new outer bar and integration tests.
- [ ] Implement the tab bar with separate Pin prefix, temporary styling, explicit pin/unpin/close menus, and a right-side +. Derive names from folder identity and parent_id. Implement a project-only sidebar using open folder families and existing add/open folder actions; preserve classic sidebar and global routes.
- [ ] Integrate the outer row across main and aux without remounting live conversations. Prefer stable existing shell nodes and an overlay/header reserve if restructuring would reparent content. Keep zoom-aware desktop corner reserves, mobile drawers, chrome and terminal layout working. Empty presentation hides/inerts all retained content and blocks content shortcuts. Suppress auto-draft creation for an empty outer entry.
- [ ] Run new components and all affected existing surface, tab-context, sidebar, chrome, group shell and persistence regressions; fix incompatible source assertions without removing behavior coverage.
- [ ] Commit owned files and report visual structure, all test evidence and any limits.

### Task 4: Runtime dev build overrides and macOS delivery

**Files:**
- Modify: .github/workflows/macos-workbench-build.yml for GENERIC optional runtime product_name/bundle_identifier inputs and robust application discovery.
- Modify/Create: build configuration helper and focused validation under scripts/ only if inline workflow logic is too large; no product-specific dev names or identifiers in tracked config.
- Modify: docs/worktree-workbench.md for build inputs and CI receipt source/commit meaning.
- Do not edit src-tauri/tauri*.json or Rust source; do not edit release.yml.

**Interfaces:**
```text
workflow_dispatch inputs.product_name and inputs.bundle_identifier: optional, empty by default.
Push builds can read Build-Product-Name and Build-Bundle-Identifier Git trailers
from the HEAD commit. Workbench-Source-Commit identifies the verified source.
Runtime JSON is written to RUNNER_TEMP and passed to pnpm tauri build --config.
Receipt keeps build commit and optional source_commit; package includes both.
```
Controller chooses concrete dev values through inputs/temporary build metadata AFTER code validation; they are not committed in source/config. This generic input support is CI capability, not an app rename commit.

- [ ] Validate runtime override generation for absent values, valid names/identifiers, and invalid path/newline values; output JSON has ad-hoc signing and createUpdaterArtifacts:false. Base product config stays byte-for-byte unchanged.
```py
assert make_override(product_name="Example Dev", identifier="app.example.dev")["productName"] == "Example Dev"
assert "productName" not in make_override(product_name="", identifier="")
```
- [ ] Implement optional generic inputs/trailer fallback and generated RUNNER_TEMP JSON. Discover the built .app path from the effective product name or exactly one bundle, verify signing, zip using keepParent, package DMGs and SHA-256 manifests. Record source_commit alongside build commit without mutating source.
- [ ] Validate YAML and focused override code; commit workflow/tooling/docs; report all tested cases. Controller runs final frontend lint/full test/build and requests broad review.
- [ ] Controller creates a dedicated build-only empty commit with the same tree as verified HEAD and supplied runtime metadata, pushes only a new build/workbench-* ref, obtains ARM/Intel receipt branches over Git SSH, checks status/name/identifier/architecture/checksums, and delivers artifact links plus local packages when download succeeds. Native macOS execution is not claimed on Linux.
