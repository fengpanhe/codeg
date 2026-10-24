# Task 2 Report: Left-side conversation history dropdown

## Status

DONE

## Implemented surface

- Added `WorkbenchConversationHistory(props: { scopeId: WorkspaceScopeId; groupId: string }): React.ReactNode` in `src/components/workbench/workbench-conversation-history.tsx`.
- Mounted it in `src/components/workbench/workbench-tab-bar.tsx` as the first child inside conversation tab strips, before `tabs.map(...)`. File strips do not render the control.
- The trigger is icon-only and accessible as `History`; the popover provides search, current/project range controls, loading, empty, error, retry, and open-refusal feedback.

## Public APIs and integration contracts used

- `listAllConversations({ folder_ids, include_children: true, search, sort_by: "updated_at_desc" })` from `@/lib/api`.
- `scopeIdForFolder(folderId, isChat)` from `@/types/workbench` to route chat results to the global outer tab and folder/worktree results to concrete scope ids.
- `useWorktreeTabsStore.getState().openWorktree(scopeId)` from Task 1. This boolean result gates the inner open; when it returns `false`, no inner tab action is invoked and the popover shows `Workbench.History.openRefused`.
- `useTabActions().openTab(folderId, conversationId, agentType, false, title)` for the existing inner conversation open/activation path.
- `useAppWorkspaceStore((s) => s.allFolders)` for folder scope derivation.

## Scope behavior

- Current concrete scope queries only the current folder id.
- Project scope finds the repo root (`parent_id ?? id`) and queries the root plus all direct worktree children.
- Global scope is chat-only: it queries folders where `FolderDetail.kind === "chat"` and hides the project/current segmented control.
- All history API calls pass `include_children: true` so delegation/sub-session rows can be returned by the existing API.
- Late responses are ignored with a monotonically increasing request generation id when scope/range/search/retry changes.

## Locale keys added

Added under `Workbench.History` in all 10 locale files (`ar`, `de`, `en`, `es`, `fr`, `ja`, `ko`, `pt`, `zh-CN`, `zh-TW`):

- `trigger`
- `title`
- `current`
- `project`
- `searchPlaceholder`
- `loading`
- `empty`
- `loadError`
- `retry`
- `untitled`
- `openRefused`

## Tests and evidence

RED:

- `COREPACK_HOME=/tmp/codeg-corepack PATH=/data00/home/fengpanhe/.nvm/versions/node/v24.18.0/bin:$PATH corepack pnpm exec vitest run src/components/workbench/workbench-conversation-history.test.tsx`
- Expected failure before implementation: Vite could not resolve `./workbench-conversation-history` from the new test.

GREEN:

- `COREPACK_HOME=/tmp/codeg-corepack PATH=/data00/home/fengpanhe/.nvm/versions/node/v24.18.0/bin:$PATH corepack pnpm exec vitest run src/components/workbench/workbench-conversation-history.test.tsx`
- Result: 1 file, 7 tests passed.

Scoped regression bundle:

- `COREPACK_HOME=/tmp/codeg-corepack PATH=/data00/home/fengpanhe/.nvm/versions/node/v24.18.0/bin:$PATH corepack pnpm exec vitest run src/components/workbench/workbench-conversation-history.test.tsx src/components/workbench/workbench-surface-source.test.ts src/components/workbench/workbench-surface.test.tsx src/components/layout/workspace-chrome-controller.test.tsx`
- Result: 4 files, 42 tests passed.

Scoped lint:

- `COREPACK_HOME=/tmp/codeg-corepack PATH=/data00/home/fengpanhe/.nvm/versions/node/v24.18.0/bin:$PATH corepack pnpm exec eslint src/components/workbench/workbench-conversation-history.tsx src/components/workbench/workbench-conversation-history.test.tsx src/components/workbench/workbench-tab-bar.tsx src/components/workbench/workbench-surface-source.test.ts`
- Result: passed after formatting and moving effect state changes behind the scheduled request callback.

## Self-review

- No Rust/service/protocol files changed.
- The history selection path invokes exactly one outer navigation API (`openWorktree`) and only invokes the inner `openTab` if that call succeeds.
- `worktree-workbench-handoff.md` was left untracked and unstaged.
- Existing controller/doc edits in `docs/plans/2026-10-24-worktree-workbench-tabs.md` and `docs/worktree-workbench-tabs-design.md` were not modified or staged by this task.

## Concerns

- The component does not introduce a new pagination API, per brief. Large history lists rely on the existing `list_all_conversations` response size and client-side scrolling/sorting.
- `groupId` is preserved in the public component interface for placement parity, but the existing `useTabActions().openTab` public action does not accept a target group for existing conversations. Opening therefore follows the established store behavior for the target scope's focused group.
