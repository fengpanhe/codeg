"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { openSettingsWindow } from "@/lib/api"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useIsActiveChatMode } from "@/hooks/use-is-active-chat-mode"
import { useSidebarContext } from "@/contexts/sidebar-context"
import { useAuxPanelContext } from "@/contexts/aux-panel-context"
import { useTerminalContext } from "@/contexts/terminal-context"
import { useTabActions, useTabStore } from "@/contexts/tab-context"
import {
  useWorkspaceActions,
  useWorkspaceFileTabs,
  useWorkspaceView,
  type WorkspacePane,
} from "@/contexts/workspace-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useSearchDialog } from "@/contexts/search-dialog-context"
import { useShortcutSettings } from "@/hooks/use-shortcut-settings"
import {
  isConversationDeleted,
  useAppWorkspaceStore,
} from "@/stores/app-workspace-store"
import { popClosedTab } from "@/lib/closed-tab-stack"
import { isEmptyWorkbenchPresentation } from "@/hooks/use-worktree-workbench-presentation"
import { useWorktreeTabsStore } from "@/stores/worktree-tabs-store"
import { useWorkbenchStore } from "@/stores/workbench-store"
import {
  classicSelectedTabId,
  classicTabRefs,
} from "@/lib/workbench-classic-projection"
import {
  paneSelectedTabId,
  paneTabRefs,
  workbenchPaneGroup,
} from "@/lib/workbench-pane-layout"
import { leafIds } from "@/lib/tab-group-layout"
import { browserTabBackendId, buildFileTabId } from "@/lib/file-tab-id"
import { activateWorkbenchTab } from "@/components/workbench/workbench-tab-bar"
import {
  matchShortcutEvent,
  numberedTabIndexFromEvent,
  pickNumberedTabId,
} from "@/lib/keyboard-shortcuts"
import {
  CLOSE_SHORTCUT_EVENT,
  closeShortcutOrigin,
  MENU_CLOSE_CHORD,
  tabShortcutTarget,
  workspacePaneOf,
  type CloseShortcutPayload,
} from "@/lib/menu-close-shortcut"
import { getCurrentWindowLabel } from "@/lib/browser/window-label"
import { activateWorkbenchScopeWithOuterTab } from "@/lib/worktree-tabs-navigation"
import { closeCurrentWindow } from "@/lib/platform"
import { getShellTransport, isDesktop } from "@/lib/transport"
import { SearchCommandDialog } from "@/components/conversations/search-command-dialog"
import { WorkspaceFolderDialog } from "@/components/layout/workspace-folder-dialog"

/**
 * Headless owner of the workspace's global keyboard shortcuts and the two
 * dialogs the shortcuts summon (search, remote directory browser). These used
 * to live in the full-width `FolderTitleBar`; with the desktop title bar removed
 * (its buttons relocated into per-column edge clusters), this component keeps
 * the shortcuts + dialogs alive on BOTH desktop and mobile, independent of any
 * visible bar. Renders no visible chrome — only the dialogs.
 */
export function WorkspaceChromeController() {
  const { activeFolder } = useActiveFolder()
  const isChatMode = useIsActiveChatMode()
  const { toggle } = useSidebarContext()
  const { toggle: toggleAuxPanel } = useAuxPanelContext()
  const { toggle: toggleTerminal } = useTerminalContext()
  const {
    openNewConversationTab,
    openChatModeTab,
    openTab,
    switchTab,
    closeTab,
  } = useTabActions()
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const uiMode = useWorkbenchStore((s) => s.uiMode)
  // Tab-close/navigation shortcuts used to live in the visible tab strips.
  // Mobile no longer mounts those strips, so this always-mounted controller now
  // owns them too (see the keydown handler below).
  const { mode, activePane, filesMaximized, conversationMaximized } =
    useWorkspaceView()
  const { activeFileTabId, fileTabs } = useWorkspaceFileTabs()
  const {
    closeFileTab,
    closeAllFileTabs,
    switchFileTab,
    openFilePreview,
    openBrowserTab,
    setActivePane,
  } = useWorkspaceActions()
  const { openConversations } = useWorkbenchRoute()
  const { shortcuts } = useShortcutSettings()
  // Search open-state is shared (see search-dialog-context): the trigger lives
  // in the sidebar, but this always-mounted controller owns the dialog and the
  // ⌘K shortcut so search works even when the sidebar is collapsed.
  const { open: searchOpen, setOpen: setSearchOpen } = useSearchDialog()
  const [browserOpen, setBrowserOpen] = useState(false)

  // One dialog on every platform: it owns directory selection *and* the
  // follow-up step that links other folders into the new workspace, so the
  // native picker can't be a separate path that skips half the flow.
  const handleOpenFolder = useCallback(() => setBrowserOpen(true), [])

  const handleOpenSettings = useCallback(() => {
    openSettingsWindow().catch((err) => {
      console.error("[WorkspaceChromeController] failed to open settings:", err)
    })
  }, [])

  // Close the current tab of the strip that belongs to `pane`. False when
  // there is none, which leaves ⌘W to the OS: it closes the window.
  const closeCurrentTab = useCallback(
    (pane: WorkspacePane): boolean => {
      const workbench = useWorkbenchStore.getState()
      const target = tabShortcutTarget(
        mode,
        pane,
        filesMaximized,
        conversationMaximized
      )
      const targetPane = target.files ? "files" : "conversation"
      const workspace = workbench.workspaces[String(workbench.activeScopeId)]
      if (workspace && (target.files || target.conversation)) {
        const groupId = workbenchPaneGroup(workspace, targetPane)
        const id = paneSelectedTabId(workspace, targetPane, groupId)
        const tab = workspace.tabRefs.find((item) => item.id === id)
        if (tab) {
          if (tab.type === "conversation") closeTab(tab.entityId)
          else closeFileTab(tab.entityId)
          return true
        }
        if (
          workbench.uiMode === "unified" &&
          groupId === workspace.focusedGroupId &&
          !workspace.tabRefs.some(
            (item) => workspace.groupOf[item.id] === groupId
          ) &&
          leafIds(workspace.groupLayout).length > 1
        ) {
          workbench.dissolveGroup(workspace.scopeId, groupId, targetPane)
          return true
        }
        return false
      }
      if (target.conversation) {
        if (!activeTabId) return false
        closeTab(activeTabId)
        return true
      }
      if (target.files) {
        if (!activeFileTabId) return false
        closeFileTab(activeFileTabId)
        return true
      }
      return false
    },
    [
      activeFileTabId,
      activeTabId,
      closeFileTab,
      closeTab,
      conversationMaximized,
      filesMaximized,
      mode,
    ]
  )

  // ⌘W the macOS app menu caught (see `menu-close-shortcut`): pressed where
  // the listener below cannot hear it — inside an iframe, a browser page, an
  // HTML document view — or heard there and let through. The first kind is
  // routed as if it had been pressed at the element that stands for that
  // spot; the second keeps the meaning ⌘W always had, closing the window.
  const handleMenuClose = useCallback(
    (payload: CloseShortcutPayload) => {
      if (isEmptyWorkbenchPresentation()) {
        const outer = useWorktreeTabsStore.getState()
        if (outer.activeTabId) outer.closeTab(outer.activeTabId)
        return
      }
      const closeWindow = () => {
        closeCurrentWindow().catch((err) => {
          console.error("[WorkspaceChromeController] ⌘W close failed:", err)
        })
      }
      // Not this person's close-tab key.
      if (!matchShortcutEvent(MENU_CLOSE_CHORD, shortcuts.close_current_tab)) {
        closeWindow()
        return
      }
      const origin = closeShortcutOrigin(payload.surfaceTabId)
      // A surface this document does not show: nothing here is safe to close.
      if (origin.kind === "unknown") return
      // The listener below heard it and had no tab to close.
      if (origin.kind === "page") {
        closeWindow()
        return
      }
      if (origin.kind === "element") {
        const placement = origin.element.closest<HTMLElement>(
          "[data-workbench-tab-id]"
        )
        if (placement) {
          const state = useWorkbenchStore.getState()
          const workspace = state.workspaces[String(state.activeScopeId)]
          if (
            placement.dataset.workbenchScopeId !== String(state.activeScopeId)
          )
            return
          const tab = workspace?.tabRefs.find(
            (ref) => ref.id === placement.dataset.workbenchTabId
          )
          if (!tab || !workspace) return
          const groupId = workspace.groupOf[tab.id]
          const visible =
            state.uiMode === "classic"
              ? classicSelectedTabId(
                  workspace,
                  tab.type === "conversation" ? "conversation" : "files"
                ) === tab.id
              : paneSelectedTabId(
                  workspace,
                  tab.type === "conversation" ? "conversation" : "files",
                  groupId
                ) === tab.id ||
                (tab.type === "conversation" && workspace.tileByGroup[groupId])
          if (!visible) return
          state.activateTab(workspace.scopeId, tab.id)
          if (tab.type === "conversation") closeTab(tab.entityId)
          else closeFileTab(tab.entityId)
          return
        }
      }
      if (payload.surfaceTabId && origin.kind === "element") {
        const state = useWorkbenchStore.getState()
        const workspace = state.workspaces[String(state.activeScopeId)]
        const tab = workspace?.tabRefs.find(
          (ref) =>
            ref.type === "browser" &&
            browserTabBackendId(ref.entityId) === payload.surfaceTabId
        )
        const visible =
          tab &&
          workspace &&
          (state.uiMode === "classic"
            ? classicSelectedTabId(workspace, "files") === tab.id &&
              !conversationMaximized
            : paneSelectedTabId(
                workspace,
                "files",
                workspace.groupOf[tab.id]
              ) === tab.id && !conversationMaximized)
        if (tab && workspace && visible) {
          state.activateTab(workspace.scopeId, tab.id)
          closeFileTab(tab.entityId)
          return
        }
      }
      let pane = activePane
      const pressedIn =
        origin.kind === "element" ? workspacePaneOf(origin.element) : null
      if (pressedIn) {
        pane = pressedIn
        // What a click there would have done (see the pane handlers in the
        // workspace layout): a page gives the workspace no pointer or focus
        // event of its own. It also routes the next ⌘W, which arrives with
        // no view holding the keyboard once this page has closed. Never into
        // a column the other one is maximized over.
        const covered =
          pressedIn === "files" ? conversationMaximized : filesMaximized
        if (mode === "fusion" && !covered) {
          setActivePane(pressedIn)
        }
      }
      if (!closeCurrentTab(pane)) closeWindow()
    },
    [
      activePane,
      closeCurrentTab,
      closeFileTab,
      closeTab,
      conversationMaximized,
      filesMaximized,
      mode,
      setActivePane,
      shortcuts.close_current_tab,
    ]
  )
  const handleMenuCloseRef = useRef(handleMenuClose)
  useEffect(() => {
    handleMenuCloseRef.current = handleMenuClose
  }, [handleMenuClose])
  useEffect(() => {
    if (!isDesktop()) return
    let disposed = false
    let unsubscribe: (() => void) | null = null
    // This app's own backend — the menu is local even in a window whose
    // workspace is on a remote server.
    getShellTransport()
      .subscribe<CloseShortcutPayload>(CLOSE_SHORTCUT_EVENT, (payload) => {
        if (payload.window !== getCurrentWindowLabel()) return
        handleMenuCloseRef.current(payload)
      })
      .then((fn) => {
        if (disposed) fn()
        else unsubscribe = fn
      })
      .catch((err) => {
        console.error("[WorkspaceChromeController] ⌘W listener failed:", err)
      })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    function handleEmptyKeyDown(e: KeyboardEvent) {
      if (!isEmptyWorkbenchPresentation()) return
      if (
        matchShortcutEvent(e, shortcuts.close_current_tab) ||
        matchShortcutEvent(e, "mod+w")
      ) {
        e.preventDefault()
        e.stopImmediatePropagation()
        const outer = useWorktreeTabsStore.getState()
        if (outer.activeTabId) outer.closeTab(outer.activeTabId)
        return
      }
      const contentShortcuts = [
        shortcuts.new_conversation,
        shortcuts.next_tab,
        shortcuts.prev_tab,
        shortcuts.reopen_last_closed_tab,
        shortcuts.close_all_file_tabs,
        "mod+s",
      ]
      if (
        contentShortcuts.some((chord) => matchShortcutEvent(e, chord)) ||
        numberedTabIndexFromEvent(e, shortcuts) !== null
      ) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (matchShortcutEvent(e, shortcuts.toggle_search)) {
        e.preventDefault()
        setSearchOpen((prev) => !prev)
        return
      }
      if (matchShortcutEvent(e, shortcuts.toggle_sidebar)) {
        e.preventDefault()
        toggle()
        return
      }
      if (matchShortcutEvent(e, shortcuts.toggle_terminal)) {
        e.preventDefault()
        toggleTerminal()
        return
      }
      if (matchShortcutEvent(e, shortcuts.toggle_aux_panel)) {
        // The aux panel hosts the Session Details tab, so it's usable in chat
        // mode too; only suppress the toggle when there's nothing to show.
        if (!activeFolder && !isChatMode) return
        e.preventDefault()
        toggleAuxPanel()
        return
      }
      if (matchShortcutEvent(e, shortcuts.new_conversation)) {
        if (isChatMode) {
          e.preventDefault()
          openConversations()
          const current = useWorkbenchStore.getState()
          const workspace = current.workspaces[String(current.activeScopeId)]
          openChatModeTab({
            targetGroup: workspace
              ? workbenchPaneGroup(workspace, "conversation")
              : undefined,
          })
          return
        }
        if (!activeFolder) return
        e.preventDefault()
        // Return to the conversation workspace if a route (e.g. Automations) was
        // covering the content region, else the new tab opens unseen.
        openConversations()
        openNewConversationTab(activeFolder.id, activeFolder.path)
        return
      }
      if (matchShortcutEvent(e, shortcuts.open_folder)) {
        e.preventDefault()
        void handleOpenFolder()
        return
      }
      if (matchShortcutEvent(e, shortcuts.open_settings)) {
        e.preventDefault()
        handleOpenSettings()
        return
      }

      // Tab navigation + close. These once lived in the visible tab strips,
      // which mobile no longer mounts; owning them here keeps mod+w / mod+tab /
      // mod+shift+tab working at every width — and, crucially, keeps
      // preventDefault firing so mod+w never falls through to closing the OS
      // window. Routing mirrors the old split: conversation pane vs files pane.
      const { conversation: conversationPaneActive, files: filesPaneActive } =
        tabShortcutTarget(
          mode,
          activePane,
          filesMaximized,
          conversationMaximized
        )

      const workbench = useWorkbenchStore.getState()
      const workspace = workbench.workspaces[String(workbench.activeScopeId)]
      if (workbench.uiMode === "unified" && workspace) {
        const pane = filesPaneActive ? "files" : "conversation"
        const groupId = workbenchPaneGroup(workspace, pane)
        const groupTabs = paneTabRefs(workspace, pane, groupId)
        const selected = paneSelectedTabId(workspace, pane, groupId)
        const next = matchShortcutEvent(e, shortcuts.next_tab)
        const previous = matchShortcutEvent(e, shortcuts.prev_tab)
        if (next || previous) {
          if (groupTabs.length < 2) return
          e.preventDefault()
          const index = groupTabs.findIndex((tab) => tab.id === selected)
          const target =
            groupTabs[
              (Math.max(0, index) + (next ? 1 : -1) + groupTabs.length) %
                groupTabs.length
            ]
          activateWorkbenchTab(workspace.scopeId, target)
          return
        }
        const numbered = numberedTabIndexFromEvent(e, shortcuts)
        if (numbered !== null) {
          if (
            e.ctrlKey &&
            !e.metaKey &&
            e.target instanceof Element &&
            e.target.closest('[data-terminal-panel-region="true"]')
          )
            return
          const id = pickNumberedTabId(
            groupTabs.map((tab) => tab.id),
            numbered
          )
          const target = groupTabs.find((tab) => tab.id === id)
          if (target) {
            e.preventDefault()
            activateWorkbenchTab(workspace.scopeId, target)
          }
          return
        }
        if (matchShortcutEvent(e, shortcuts.close_all_file_tabs)) {
          e.preventDefault()
          groupTabs
            .filter((tab) => tab.type !== "conversation")
            .forEach((tab) => closeFileTab(tab.entityId))
          return
        }
      }

      const isNextTab = matchShortcutEvent(e, shortcuts.next_tab)
      const isPrevTab = matchShortcutEvent(e, shortcuts.prev_tab)
      if (isNextTab || isPrevTab) {
        if (!conversationPaneActive) return
        const groupTabs = workspace?.tabRefs.length
          ? classicTabRefs(workspace, "conversation")
          : null
        const ids = groupTabs
          ? groupTabs.map((tab) => tab.id)
          : tabs.map((tab) => tab.id)
        const selected =
          groupTabs && workspace
            ? classicSelectedTabId(workspace, "conversation")
            : activeTabId
        if (ids.length < 2 || !selected) return
        const currentIndex = ids.indexOf(selected)
        if (currentIndex === -1) return
        e.preventDefault()
        const nextIndex =
          (currentIndex + (isNextTab ? 1 : -1) + ids.length) % ids.length
        if (groupTabs && workspace)
          activateWorkbenchTab(workspace.scopeId, groupTabs[nextIndex])
        else switchTab(ids[nextIndex])
        return
      }

      const numberedIndex = numberedTabIndexFromEvent(e, shortcuts)
      if (numberedIndex !== null) {
        // A Ctrl chord belongs to a focused terminal — with the defaults it is
        // a control code, and Ctrl+6 is the Ctrl+^ that switches vim's
        // alternate file — so decline there, the same way the zoom listener
        // declines Ctrl+-/Ctrl+= (see appearance-provider). This covers a
        // remapped Ctrl binding too, which is the behaviour we want. Cmd
        // carries no shell meaning, so on macOS the jump keeps working over a
        // focused terminal.
        if (
          e.ctrlKey &&
          !e.metaKey &&
          e.target instanceof Element &&
          e.target.closest('[data-terminal-panel-region="true"]')
        ) {
          return
        }
        if (conversationPaneActive) {
          const tabId = pickNumberedTabId(
            workspace?.tabRefs.length
              ? classicTabRefs(workspace, "conversation").map((tab) => tab.id)
              : tabs.map((tab) => tab.id),
            numberedIndex
          )
          if (!tabId) return
          e.preventDefault()
          const ref = workspace?.tabRefs.find((tab) => tab.id === tabId)
          if (ref && workspace) activateWorkbenchTab(workspace.scopeId, ref)
          else switchTab(tabId)
          return
        }
        if (filesPaneActive) {
          const tabId = pickNumberedTabId(
            workspace?.tabRefs.length
              ? classicTabRefs(workspace, "files").map((tab) => tab.id)
              : fileTabs.map((tab) => tab.id),
            numberedIndex
          )
          if (!tabId) return
          e.preventDefault()
          const ref = workspace?.tabRefs.find((tab) => tab.id === tabId)
          if (ref && workspace) activateWorkbenchTab(workspace.scopeId, ref)
          else switchFileTab(tabId)
          return
        }
        return
      }

      if (matchShortcutEvent(e, shortcuts.close_all_file_tabs)) {
        if (!filesPaneActive) return
        e.preventDefault()
        if (workspace?.tabRefs.length)
          classicTabRefs(workspace, "files").forEach((tab) =>
            closeFileTab(tab.entityId)
          )
        else closeAllFileTabs()
        return
      }

      if (matchShortcutEvent(e, shortcuts.close_current_tab)) {
        if (closeCurrentTab(activePane)) e.preventDefault()
        return
      }

      if (matchShortcutEvent(e, shortcuts.reopen_last_closed_tab)) {
        e.preventDefault()
        // Every entry carries the slot it was closed from, and each opener
        // puts the tab back there (clamped to the strip) rather than at the
        // end.
        while (true) {
          const closed = popClosedTab()
          if (!closed) return
          const workbench = useWorkbenchStore.getState()
          const proposedScope =
            closed.scopeId ??
            (closed.folderId != null && closed.folderId > 0
              ? closed.folderId
              : "global")
          const scopeId =
            typeof proposedScope === "number" &&
            !useAppWorkspaceStore.getState().getFolder(proposedScope)
              ? "global"
              : proposedScope
          if (!activateWorkbenchScopeWithOuterTab(scopeId)) return
          const initialWorkspace =
            useWorkbenchStore.getState().workspaces[String(scopeId)]
          if (
            closed.groupId &&
            initialWorkspace &&
            leafIds(initialWorkspace.groupLayout).includes(closed.groupId)
          )
            workbench.focusGroup(scopeId, closed.groupId)
          const restorePosition = (tabId: string) => {
            const ws = useWorkbenchStore.getState().workspaces[String(scopeId)]
            if (!ws?.tabRefs.some((tab) => tab.id === tabId)) return
            const group =
              closed.groupId && leafIds(ws.groupLayout).includes(closed.groupId)
                ? closed.groupId
                : ws.focusedGroupId
            useWorkbenchStore
              .getState()
              .moveTab(scopeId, tabId, group, closed.groupIndex ?? closed.index)
          }
          if (closed.kind === "file") {
            void openFilePreview(closed.path, {
              folderId: closed.folderId ?? undefined,
              index: closed.groupIndex ?? closed.index,
            }).then((path) => {
              if (path) restorePosition(buildFileTabId({ kind: "file", path }))
            })
            return
          }
          if (closed.kind === "browser") {
            // Back at the page it was showing; a tab already on that page is
            // activated instead (the usual one-tab-per-URL rule).
            const reopened = openBrowserTab(closed.url, {
              folderId: closed.folderId ?? undefined,
              index: closed.groupIndex ?? closed.index,
              profile: closed.profile,
              // Said only when it was remote: otherwise the address decides,
              // as it does when the tab comes back after a restart.
              ...(closed.remote === true ? { remote: true } : {}),
              ...(closed.device ? { device: closed.device } : {}),
            })
            if (reopened) restorePosition(reopened)
            return
          }
          if (closed.conversationId != null) {
            // A deletion seen at any point wins. `applyConversationRemove`
            // purges what is on the stack when it runs, but a tab that was
            // still open then gets recorded afterwards, when the user closes
            // it by hand — that entry can only be caught here.
            if (isConversationDeleted(closed.conversationId)) continue
            openConversations()
            openTab(
              closed.folderId,
              closed.conversationId,
              closed.agentType,
              closed.isPinned,
              closed.title,
              { index: closed.index }
            )
            const reopened = useTabStore
              .getState()
              .rawTabs.find(
                (tab) =>
                  tab.folderId === closed.folderId &&
                  tab.conversationId === closed.conversationId &&
                  tab.agentType === closed.agentType
              )
            if (reopened) restorePosition(reopened.id)
            return
          }
          const folder = useAppWorkspaceStore
            .getState()
            .getFolder(closed.folderId)
          const workingDir = closed.workingDir ?? folder?.path
          if (!workingDir) continue
          openConversations()
          const reopened = openNewConversationTab(closed.folderId, workingDir, {
            index: closed.index,
            targetGroup: closed.groupId,
          })
          if (reopened) restorePosition(reopened.tabId)
          return
        }
      }
    }
    window.addEventListener("keydown", handleEmptyKeyDown, true)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleEmptyKeyDown, true)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [
    activeFolder,
    uiMode,
    closeFileTab,
    handleOpenFolder,
    handleOpenSettings,
    openConversations,
    openNewConversationTab,
    openChatModeTab,
    openTab,
    openFilePreview,
    openBrowserTab,
    setSearchOpen,
    shortcuts,
    toggle,
    toggleAuxPanel,
    toggleTerminal,
    isChatMode,
    tabs,
    activeTabId,
    switchTab,
    closeCurrentTab,
    mode,
    activePane,
    filesMaximized,
    conversationMaximized,
    fileTabs,
    closeAllFileTabs,
    switchFileTab,
  ])

  return (
    <>
      <SearchCommandDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <WorkspaceFolderDialog open={browserOpen} onOpenChange={setBrowserOpen} />
    </>
  )
}
