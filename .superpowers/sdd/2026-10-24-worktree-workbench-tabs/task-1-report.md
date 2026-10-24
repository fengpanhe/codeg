# Task 1 Report: Outer Worktree Tab State

## Summary

Implemented client-only outer Worktree tab state and persistence for the new Workbench tab row. The new store owns only outer entries; existing Workbench state remains the owner of inner per-scope sessions, files, panes, dirty buffers, Monaco/file entities, and active folder projection.

## Files Changed

- `src/types/workbench.ts`: exported `WorktreeWorkbenchTab` and `WorktreeTabsState` interfaces.
- `src/stores/worktree-tabs-store.ts`: new Zustand store with hydration, open/replace/activate/close/pin behavior, persisted write guard, backend reset registration, and test reset helper.
- `src/stores/worktree-tabs-store.test.ts`: state and navigation-contract coverage.
- `src/lib/worktree-tabs-persistence.ts`: namespaced persistence, bounded sanitizer, and localStorage read/write helpers.
- `src/lib/worktree-tabs-persistence.test.ts`: sanitizer, namespace, and rejected-cache tests.
- `src/lib/worktree-tab-label.ts`: pure tab label formatter.
- `src/lib/worktree-tab-label.test.ts`: label tests for empty/global/root/worktree/fallback cases.
- `src/lib/worktree-tabs-navigation.ts`: explicit outer-navigation bridge.

No Rust, config, product-name, opened_tabs protocol, or global file/session teardown code was changed.

## Public APIs

- `useWorktreeTabsStore` from `src/stores/worktree-tabs-store.ts` implements `tabs`, `activeTabId`, `hydrated`, `hydrate()`, `openWorktree(scopeId)`, `createEmptyTab()`, `activateTab(id)`, `closeTab(id)`, and `setPinned(id, pinned)`.
- `__resetWorktreeTabsStoreForTests()` from `src/stores/worktree-tabs-store.ts`.
- `formatWorktreeTabLabel(scopeId, folders, globalLabel, emptyLabel)` from `src/lib/worktree-tab-label.ts`.
- `worktreeTabsStorageKey`, `sanitizePersistedWorktreeTabsState`, `readPersistedWorktreeTabsState`, `writePersistedWorktreeTabsState`, and `WORKTREE_TABS_PERSISTENCE_VERSION` from `src/lib/worktree-tabs-persistence.ts`.
- Explicit navigation bridge for later UI/history/deeplink wiring: `activateWorkbenchScopeWithOuterTab(scopeId)` from `src/lib/worktree-tabs-navigation.ts`.

## Behavior Notes

- Opening a Worktree first activates an existing concrete-scope outer tab if present.
- Opening a new concrete scope fills the currently active temporary/empty tab when it is unpinned; if the active tab is pinned or absent, a new temporary tab is appended.
- Multiple empty temporary tabs may coexist because `scopeId: null` entries are not deduplicated.
- `scopeId: null` is preserved as empty presentation and is distinct from `scopeId: "global"`.
- Selecting, hydrating, or creating an empty tab does not call Workbench `activateScope`; the previous inner `activeScopeId` is retained for hidden content.
- `openWorktree` and `activateWorkbenchScopeWithOuterTab` deliberately synchronize the inner Workbench numeric/global scope.
- Passive Workbench changes, including direct `useWorkbenchStore.getState().activateScope(...)` and reconciliation, do not mutate the outer store and therefore cannot fill or steal focus from a selected blank tab.
- Persistence uses the existing `getWorkbenchPersistenceNamespace` backend/window namespace and disables writes after rejected hydration until the store reset helper/backend reset runs.
- Hydration seeds future generated ids from persisted `worktree-tab-N` ids to avoid collisions.

## RED Evidence

Command:

`COREPACK_HOME=/tmp/codeg-corepack PATH=/data00/home/fengpanhe/.nvm/versions/node/v24.18.0/bin:$PATH corepack pnpm vitest run src/lib/worktree-tab-label.test.ts src/lib/worktree-tabs-persistence.test.ts src/stores/worktree-tabs-store.test.ts`

Result before implementation: failed as expected, 3 failed files / 14 failed tests. Failures were missing public APIs: `formatWorktreeTabLabel is not a function`, `sanitizePersistedWorktreeTabsState is not a function`, `worktreeTabsStorageKey is not a function`, and `__resetWorktreeTabsStoreForTests is not a function`.

## GREEN Evidence

Command:

`COREPACK_HOME=/tmp/codeg-corepack PATH=/data00/home/fengpanhe/.nvm/versions/node/v24.18.0/bin:$PATH corepack pnpm vitest run src/lib/worktree-tab-label.test.ts src/lib/worktree-tabs-persistence.test.ts src/stores/worktree-tabs-store.test.ts`

Result after implementation and formatting: passed, 3 files / 15 tests.

Existing scoped regressions command:

`COREPACK_HOME=/tmp/codeg-corepack PATH=/data00/home/fengpanhe/.nvm/versions/node/v24.18.0/bin:$PATH corepack pnpm vitest run src/stores/workbench-store.test.ts src/contexts/tab-context.test.tsx`

Result: passed, 2 files / 125 tests. `tab-context.test.tsx` emitted existing expected stderr for act warnings and intentionally simulated backend failures.

Targeted lint command:

`COREPACK_HOME=/tmp/codeg-corepack PATH=/data00/home/fengpanhe/.nvm/versions/node/v24.18.0/bin:$PATH corepack pnpm eslint src/lib/worktree-tab-label.ts src/lib/worktree-tab-label.test.ts src/lib/worktree-tabs-persistence.ts src/lib/worktree-tabs-persistence.test.ts src/lib/worktree-tabs-navigation.ts src/stores/worktree-tabs-store.ts src/stores/worktree-tabs-store.test.ts src/types/workbench.ts`

Result: passed with no lint output.

Whitespace command:

`git diff --check -- src/lib/worktree-tab-label.ts src/lib/worktree-tab-label.test.ts src/lib/worktree-tabs-persistence.ts src/lib/worktree-tabs-persistence.test.ts src/lib/worktree-tabs-navigation.ts src/stores/worktree-tabs-store.ts src/stores/worktree-tabs-store.test.ts src/types/workbench.ts`

Result: passed with no output.

## Concerns / Follow-Ups

- Task 3 should use `activateWorkbenchScopeWithOuterTab(scopeId)` for explicit left-sidebar Worktree clicks, history selections, and same-scope deeplink/conversation activation that should leave blank presentation. Plain Workbench `activateScope` remains passive by design.
- This task does not render/inert the null-scope UI; it only preserves the selected null entry and retained inner Workbench state for the UI task to hide.
- Local sandbox tooling is broken in this environment because `bwrap` is unavailable. Commands and file writes were run through approved escalated calls. Direct `apply_patch` also failed against this linked worktree for that reason, so owned file writes used a scoped Node writer after approval.

## Round 1 Review Fixes

### Changes

- Wired existing explicit conversation navigation through `activateWorkbenchScopeWithOuterTab(scopeId)`:
  - `src/stores/tab-store.ts`: local `openTab`, `switchTab`, and existing-tab focus now synchronize the outer Worktree tab before activating the inner Workbench scope.
  - `src/components/workspace/deep-link-bootstrap.tsx`: cold deep links and pet/warm focus requests explicitly synchronize the outer Worktree tab before opening the conversation tab.
  - `src/components/layout/workspace-chrome-controller.tsx`: reopen-last-closed-tab now synchronizes the outer Worktree tab before restoring the tab.
- Preserved passive behavior:
  - `tab-store` startup hydration and failed-snapshot draft recovery call `activateWorkbenchConversation(..., { outerNavigation: false })` so selected blank recovery remains selected blank.
  - Passive direct Workbench `activateScope` remains unchanged and does not mutate the outer store.
- Added bounded persistence validation:
  - Reject raw cached payloads over 128 KiB UTF-8 before JSON parsing.
  - Reject persisted arrays over 128 entries before tab iteration.
  - Ignore individual tab IDs over 128 chars.
  - Rejected cache blobs still disable writes via the existing store guard.

### Additional Tests

- `src/stores/worktree-tabs-store.test.ts`: real `useTabStore.openTab` and `useTabStore.switchTab` from selected blank synchronize outer navigation; passive `useTabStore.hydrate()` failure recovery leaves blank selected.
- `src/lib/worktree-tabs-persistence.test.ts`: oversized ASCII payload, oversized multibyte payload, excessive tab count, and oversized ID coverage.
- `src/components/workspace/deep-link-bootstrap.test.tsx`: cold deep link explicitly calls the outer navigation bridge before `openTab`.
- `src/components/workspace/pet-focus-bridge.test.tsx`: queued/live/parked/warm focus requests call the bridge, malformed payloads do not.
- `src/components/layout/workspace-chrome-controller.test.tsx`: reopen-last-closed conversation shortcut calls the bridge before reopening.

### Round 1 Evidence

Focused amended tests command:

`COREPACK_HOME=/tmp/codeg-corepack PATH=/data00/home/fengpanhe/.nvm/versions/node/v24.18.0/bin:$PATH corepack pnpm vitest run src/lib/worktree-tabs-persistence.test.ts src/stores/worktree-tabs-store.test.ts src/components/layout/workspace-chrome-controller.test.tsx src/components/workspace/deep-link-bootstrap.test.tsx src/components/workspace/pet-focus-bridge.test.tsx`

Result: passed, 5 files / 52 tests. Expected stderr only from the intentional `backend down` passive hydrate recovery test.

Existing regressions command:

`COREPACK_HOME=/tmp/codeg-corepack PATH=/data00/home/fengpanhe/.nvm/versions/node/v24.18.0/bin:$PATH corepack pnpm vitest run src/stores/workbench-store.test.ts src/contexts/tab-context.test.tsx`

Result: passed, 2 files / 125 tests. Existing expected stderr from `tab-context.test.tsx` act warnings and intentional backend-failure cases.

Targeted lint command:

`COREPACK_HOME=/tmp/codeg-corepack PATH=/data00/home/fengpanhe/.nvm/versions/node/v24.18.0/bin:$PATH corepack pnpm eslint src/lib/worktree-tabs-persistence.ts src/lib/worktree-tabs-persistence.test.ts src/stores/worktree-tabs-store.test.ts src/stores/tab-store.ts src/components/workspace/deep-link-bootstrap.tsx src/components/workspace/deep-link-bootstrap.test.tsx src/components/workspace/pet-focus-bridge.test.tsx src/components/layout/workspace-chrome-controller.tsx src/components/layout/workspace-chrome-controller.test.tsx`

Result: passed with no lint output.

Whitespace command:

`git diff --check -- src/lib/worktree-tabs-persistence.ts src/lib/worktree-tabs-persistence.test.ts src/stores/worktree-tabs-store.test.ts src/stores/tab-store.ts src/components/workspace/deep-link-bootstrap.tsx src/components/workspace/deep-link-bootstrap.test.tsx src/components/workspace/pet-focus-bridge.test.tsx src/components/layout/workspace-chrome-controller.tsx src/components/layout/workspace-chrome-controller.test.tsx`

Result: passed with no output.
