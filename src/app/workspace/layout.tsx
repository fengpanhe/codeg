"use client"

import { BrowserEvalConfirm } from "@/components/browser/browser-eval-confirm"
import { BrowserEventsBridge } from "@/components/browser/browser-events-bridge"
import { BrowserScreenshotMarkupHost } from "@/components/browser/browser-screenshot-markup"
import { BrowserServiceBridge } from "@/components/browser/browser-service-bridge"
import { BrowserTabsPersistence } from "@/components/browser/browser-tabs-persistence"
import { BrowserTabsSuspender } from "@/components/browser/browser-tabs-suspender"
import {
  Suspense,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { ImperativePanelGroupHandle } from "react-resizable-panels"
import { useTranslations } from "next-intl"
import { useWorktreeWorkbenchPresentation } from "@/hooks/use-worktree-workbench-presentation"
import { WorktreeWorkbenchTabBar } from "@/components/workbench/worktree-workbench-tab-bar"
import { rightChromeReserve } from "@/lib/window-chrome"
import { FolderTitleBar } from "@/components/layout/folder-title-bar"
import { Sidebar } from "@/components/layout/sidebar"
import { StatusBar } from "@/components/layout/status-bar"
import {
  AppWorkspaceProvider,
  ConversationStatusEventBridge,
} from "@/contexts/app-workspace-context"
import { AssistantsSync } from "@/stores/assistants-store"
import { ConversationTagsSync } from "@/stores/conversation-tags-store"
import { ConversationTagsManagerHost } from "@/components/conversations/conversation-tags-manager"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { TaskProvider } from "@/contexts/task-context"
import { AlertProvider } from "@/contexts/alert-context"
import {
  AcpConnectionsProvider,
  useAcpActions,
} from "@/contexts/acp-connections-context"
import { DelegationProvider } from "@/contexts/delegation-context"
import { ConversationRuntimeProvider } from "@/contexts/conversation-runtime-context"
import { TabProvider, useTabStore, useTabActions } from "@/contexts/tab-context"
import { SidebarProvider, useSidebarContext } from "@/contexts/sidebar-context"
import { SearchDialogProvider } from "@/contexts/search-dialog-context"
import { AutomationsViewProvider } from "@/contexts/automations-view-context"
import { TasksViewProvider } from "@/contexts/tasks-view-context"
import {
  WorkbenchRouteProvider,
  useWorkbenchRoute,
} from "@/contexts/workbench-route-context"
import {
  WorkbenchRoutePage,
  WorkbenchRouteStrip,
  useHasWorkbenchRouteStrip,
} from "@/components/workbench/workbench-content"
import {
  AuxPanelProvider,
  useAuxPanelContext,
} from "@/contexts/aux-panel-context"
import {
  TerminalProvider,
  useTerminalContext,
} from "@/contexts/terminal-context"
import { GitCredentialProvider } from "@/contexts/git-credential-context"
import {
  WorkspaceProvider,
  useWorkspaceActions,
  useWorkspaceView,
} from "@/contexts/workspace-context"
import { RemoteConnectionGate } from "@/contexts/remote-connection-context"
import { UpdateProvider } from "@/components/providers/update-provider"
import { useWorkspaceBackground, useZoomLevel } from "@/hooks/use-appearance"
import { useHistoryBackDismiss } from "@/hooks/use-history-back-dismiss"
import { FILL_MODE_STYLE } from "@/lib/workspace-background"
import { TerminalPanel } from "@/components/terminal/terminal-panel"
import { AuxPanel } from "@/components/layout/aux-panel"
import { ChromeReserve } from "@/components/layout/chrome-reserve"
import { LeftEdgeChrome } from "@/components/layout/left-edge-chrome"
import { RightEdgeChrome } from "@/components/layout/right-edge-chrome"
import { WorkspaceChromeController } from "@/components/layout/workspace-chrome-controller"
import { WindowControls } from "@/components/layout/window-controls"
import { ExternalConflictDialog } from "@/components/files/external-conflict-dialog"
import { AppToaster } from "@/components/ui/app-toaster"
import {
  DeepLinkBootstrap,
  PetFocusBridge,
} from "@/components/workspace/deep-link-bootstrap"
import { WorkspaceOpenFolderListener } from "@/components/workspace/workspace-open-folder-listener"
import { WorkspaceRestoreNotices } from "@/components/workspace/workspace-restore-notices"
import { HeavyPluginsWarmup } from "@/components/ai-elements/heavy-plugins-warmup"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { cn } from "@/lib/utils"
import { isDesktop } from "@/lib/platform"
import { WINDOW_CAPTION_WIDTH, leftChromeReserve } from "@/lib/window-chrome"
import { useIsMobile } from "@/hooks/use-mobile"
import { usePlatform } from "@/hooks/use-platform"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { OverlayHostHiddenProvider } from "@/components/ui/overlay-host-hidden"

function WorkspaceDocumentTitle() {
  const { activeFolder } = useActiveFolder()

  useEffect(() => {
    document.title = activeFolder ? `${activeFolder.name} - codeg` : "codeg"
  }, [activeFolder])

  return null
}

const TOAST_DURATION_MS = 15000
const FOLDER_SHELL_GROUP_ID = "folder-shell-group"
const FOLDER_SHELL_LEFT_PANEL_ID = "folder-shell-left-panel"
const FOLDER_SHELL_MAIN_PANEL_ID = "folder-shell-main-panel"
const FOLDER_SHELL_RIGHT_PANEL_ID = "folder-shell-right-panel"
const FOLDER_MAIN_GROUP_ID = "folder-main-group"
const FOLDER_MAIN_WORKSPACE_PANEL_ID = "folder-main-workspace-panel"
const FOLDER_MAIN_TERMINAL_PANEL_ID = "folder-main-terminal-panel"
const MIN_CENTER_WIDTH_PX = 420
const MIN_WORKSPACE_HEIGHT_PX = 220
const LAYOUT_EPSILON = 0.25
// Skip-check for re-applying a pixel-derived layout to the library. The
// columns on screen are pinned in px (see sidebarPanelStyle), but the
// library's percent layout is the base a handle drag (or arrow key) starts
// from, so it has to track those px to well under a pixel: with
// LAYOUT_EPSILON (0.25% ≈ 3.6px at 1440px) here, small resize steps were
// skipped until they added up, and the next drag started that far off the
// divider on screen.
const PIXEL_LAYOUT_EPSILON = 0.01
// Slide duration for panel show/hide; must match the CSS transitions on
// `.panel-slide-animating > [data-panel]` and on the top strips' corner
// reserves (`.chrome-reserve`) in globals.css — pinned together by
// chrome-reserve-slide-source.test.ts. The transition class
// is held a touch past this so the animation finishes before it's removed
// (removing it mid-transition would snap the final pixels).
const PANEL_SLIDE_MS = 240
const PANEL_SLIDE_CLEANUP_MS = PANEL_SLIDE_MS + 60

function TabKeysSync() {
  const tabs = useTabStore((s) => s.tabs)
  const { registerOpenTabKeys } = useAcpActions()
  const keys = useMemo(() => new Set(tabs.map((t) => t.id)), [tabs])
  useEffect(() => {
    registerOpenTabKeys(keys)
  }, [keys, registerOpenTabKeys])
  return null
}

function isSameLayout(
  a: number[],
  b: number[],
  epsilon: number = LAYOUT_EPSILON
): boolean {
  if (a.length !== b.length) return false
  return a.every((value, index) => Math.abs(value - b[index]) <= epsilon)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function toPercent(pixels: number, totalPixels: number): number {
  if (totalPixels <= 0) return 0
  return (pixels / totalPixels) * 100
}

function resolvePanelSizeRange(
  minPixels: number,
  maxPixels: number,
  totalPixels: number
): { minSize: number; maxSize: number } {
  const safeTotal = totalPixels > 0 ? totalPixels : 1
  const minSize = clamp(toPercent(minPixels, safeTotal), 0, 100)
  const maxSize = clamp(toPercent(maxPixels, safeTotal), minSize, 100)
  return { minSize, maxSize }
}

/**
 * Returns `true` for a brief window after `open` flips, so the caller can add
 * the `.panel-slide-animating` class that animates the panel resize (a "push"
 * slide) on explicit show/hide toggles only — never on the initial mount, on
 * localStorage hydration, or during resize-handle drags. The first settled
 * `open` value (once `ready`) establishes a baseline without animating.
 *
 * The toggle is detected during render (React's sanctioned "adjust state when a
 * prop changes" pattern) rather than in an effect: turning the class on in the
 * render that observes the flip lands it in the same commit as the panel
 * resize, so the browser has the transition in place before the panel's
 * `flex-basis` (or `flex-grow`) changes. Turn-off is deferred to a timer keyed
 * on a per-toggle sequence, so a fresh toggle mid-slide re-arms the timer
 * instead of inheriting the old one.
 */
function usePanelSlideOnToggle(open: boolean, ready: boolean): boolean {
  const [animating, setAnimating] = useState(false)
  const [slideSeq, setSlideSeq] = useState(0)
  const [prevOpen, setPrevOpen] = useState<boolean | null>(null)

  if (ready) {
    if (prevOpen === null) {
      // Adopt the hydrated value as the baseline without animating.
      setPrevOpen(open)
    } else if (prevOpen !== open) {
      setPrevOpen(open)
      setAnimating(true)
      setSlideSeq((seq) => seq + 1)
    }
  }

  useEffect(() => {
    if (slideSeq === 0) return
    const timer = setTimeout(() => setAnimating(false), PANEL_SLIDE_CLEANUP_MS)
    return () => clearTimeout(timer)
  }, [slideSeq])

  return animating
}

/**
 * The conversation surface while a full-page workbench route covers it: kept
 * MOUNTED (so background conversations keep streaming) and merely stopped from
 * painting.
 *
 * `inert` drops it from the tab order; `invisible` (visibility, not display —
 * keeps mount/layout/scroll) stops it painting, because with a workspace
 * background image the route overlay's ws-surface is translucent and the
 * conversation would ghost through it. `conversation-tab-hidden` hardens that
 * hidden subtree (see globals.css): it kills the subtree's transitions so
 * visibility flips instantly (transition-all ghosts) and re-hides the
 * descendants that declare `visibility: visible` themselves — Monaco's diff
 * panes do, which is why an open git-diff file tab used to show through the
 * tasks / automations / token-usage pages.
 *
 * The fourth part is `OverlayHostHiddenProvider`, and it is the reason this is
 * one component instead of the three lines it used to be in each shell. None
 * of the above reaches a layer that PORTALS out of this subtree, and the
 * session-viewer drawers do exactly that (to the body) — so a sub-agent
 * transcript opened from a conversation went on painting over the tasks board.
 * Keeping the flag welded to the class and the `inert` is what stops the next
 * hidden subtree from reintroducing that.
 */
function KeptMountedSurface({
  hidden,
  children,
}: {
  hidden: boolean
  children: React.ReactNode
}) {
  return (
    <OverlayHostHiddenProvider hidden={hidden}>
      <div
        className={cn(
          "h-full min-h-0",
          hidden && "conversation-tab-hidden invisible"
        )}
        inert={hidden || undefined}
      >
        {children}
      </div>
    </OverlayHostHiddenProvider>
  )
}

function WorkspaceContent({ children }: { children: React.ReactNode }) {
  const { isConversations } = useWorkbenchRoute()
  const hasRouteStrip = useHasWorkbenchRouteStrip()
  const { isOpen: sidebarOpen } = useSidebarContext()
  const { isMac } = usePlatform()
  const { zoomLevel } = useZoomLevel()
  const { isWorkbench, isEmptyWorkbench } = useWorktreeWorkbenchPresentation()
  const leftCornerWidth =
    isWorkbench || sidebarOpen
      ? 0
      : leftChromeReserve(isMac && isDesktop(), zoomLevel)
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <KeptMountedSurface hidden={!isConversations || isEmptyWorkbench}>
        {children}
      </KeptMountedSurface>
      {!isConversations && (
        <div className="absolute inset-0 z-40 flex flex-col bg-background ws-transparent-bg">
          <div
            className={cn(
              "flex h-10 shrink-0 items-stretch",
              hasRouteStrip && "border-b border-border/50 ws-chrome-border"
            )}
          >
            <ChromeReserve width={leftCornerWidth} line={false} />
            <WorkbenchRouteStrip />
            <div data-tauri-drag-region className="h-full min-w-0 flex-1" />
          </div>
          <div className="min-h-0 flex-1">
            <WorkbenchRoutePage />
          </div>
        </div>
      )}
    </div>
  )
}

function MobileWorkspaceContent({ children }: { children: React.ReactNode }) {
  const { isEmptyWorkbench } = useWorktreeWorkbenchPresentation()
  const { mode, activePane } = useWorkspaceView()
  const { activateConversationPane } = useWorkspaceActions()
  const { isConversations } = useWorkbenchRoute()
  const hasRouteStrip = useHasWorkbenchRouteStrip()
  useHistoryBackDismiss(
    isConversations && mode === "fusion" && activePane === "files",
    activateConversationPane
  )
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <KeptMountedSurface hidden={!isConversations || isEmptyWorkbench}>
        {children}
      </KeptMountedSurface>
      {!isConversations && (
        <div className="absolute inset-0 z-40 flex flex-col bg-background ws-transparent-bg">
          {hasRouteStrip && (
            <div className="flex h-10 shrink-0 items-stretch border-b border-border/50 ws-chrome-border">
              <WorkbenchRouteStrip />
              <div className="min-w-0 flex-1" />
            </div>
          )}
          <div className="min-h-0 flex-1">
            <WorkbenchRoutePage />
          </div>
        </div>
      )}
    </div>
  )
}

function MobileFolderWorkspaceShell({
  children,
}: {
  children: React.ReactNode
}) {
  const { isWorkbench, isEmptyWorkbench } = useWorktreeWorkbenchPresentation()
  const tOuter = useTranslations("Workbench.Outer")
  const {
    isOpen: sidebarOpen,
    restored: sidebarRestored,
    toggle: toggleSidebar,
  } = useSidebarContext()
  const {
    isOpen: auxOpen,
    restored: auxRestored,
    toggle: toggleAux,
    setOpen: setAuxOpen,
  } = useAuxPanelContext()
  const { isOpen: terminalOpen, toggle: toggleTerminal } = useTerminalContext()

  // A full-page route opened from inside the aux drawer — a work tab's "open
  // full page", a repository row's task chip — would otherwise land UNDER the
  // drawer, which on a phone covers nearly the whole screen. The desktop panel
  // collapses for a route by itself (see FolderWorkspaceShell); here the drawer
  // closes, and its toggle stays hidden until the conversations come back.
  const { isConversations } = useWorkbenchRoute()
  useEffect(() => {
    if (!isConversations) setAuxOpen(false)
  }, [isConversations, setAuxOpen])

  // Each of these drawers is a state toggle, not a route: without a history
  // entry behind them the back gesture falls through and unloads the whole
  // page. One pushed entry per open drawer lets back close the topmost one
  // (the entries stack in open order, so drawers open on top of each other
  // unwind top-down).
  useHistoryBackDismiss(sidebarRestored && sidebarOpen, toggleSidebar)
  useHistoryBackDismiss(auxRestored && auxOpen, toggleAux)
  useHistoryBackDismiss(terminalOpen, toggleTerminal)

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* These three opt back into press-outside-to-close, against the app-wide
          drawer default. They are mobile NAVIGATION: each covers most of the
          screen and the strip of page left showing is the affordance for
          getting back to it — tapping there to dismiss is the platform habit,
          and there is nothing behind them a user would want to click *through*
          to while they are open. */}
      <Drawer
        open={sidebarRestored && sidebarOpen}
        onOpenChange={toggleSidebar}
        swipeDirection="left"
        disablePointerDismissal={false}
      >
        <DrawerContent
          showCloseButton={false}
          className="w-[85%] max-w-[22.5rem] p-0"
        >
          <DrawerTitle className="sr-only">Sidebar</DrawerTitle>
          <Sidebar />
        </DrawerContent>
      </Drawer>

      <main className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
        {isWorkbench && (
          <div className="flex h-10 shrink-0 border-b bg-muted ws-surface-muted">
            <WorktreeWorkbenchTabBar />
          </div>
        )}
        <div className="min-h-0 flex-1">
          <MobileWorkspaceContent>{children}</MobileWorkspaceContent>
        </div>
        {isEmptyWorkbench && isConversations && (
          <div className="absolute inset-x-0 bottom-0 top-10 flex items-center justify-center p-6 text-sm text-muted-foreground">
            {tOuter("chooseProject")}
          </div>
        )}
      </main>

      <Drawer
        open={auxRestored && auxOpen}
        onOpenChange={toggleAux}
        swipeDirection="right"
        disablePointerDismissal={false}
      >
        <DrawerContent
          showCloseButton={false}
          className="w-[85%] max-w-[22.5rem] p-0"
        >
          <DrawerTitle className="sr-only">Panel</DrawerTitle>
          <KeptMountedSurface hidden={isEmptyWorkbench}>
            <AuxPanel />
          </KeptMountedSurface>
        </DrawerContent>
      </Drawer>

      <Drawer
        open={terminalOpen}
        onOpenChange={toggleTerminal}
        swipeDirection="down"
        disablePointerDismissal={false}
      >
        <DrawerContent showCloseButton={false} className="h-[95vh] p-0">
          <DrawerTitle className="sr-only">Terminal</DrawerTitle>
          <div className="h-full min-h-0 overflow-hidden">
            <KeptMountedSurface hidden={isEmptyWorkbench}>
              <TerminalPanel />
            </KeptMountedSurface>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

function FolderWorkspaceShell({ children }: { children: React.ReactNode }) {
  const { isWorkbench, isEmptyWorkbench } = useWorktreeWorkbenchPresentation()
  const { isMac, isWindows, isLinux } = usePlatform()
  const { zoomLevel } = useZoomLevel()
  const tOuter = useTranslations("Workbench.Outer")
  const {
    isOpen: sidebarOpen,
    restored: sidebarRestored,
    width: sidebarWidth,
    minWidth: sidebarMinWidth,
    maxWidth: sidebarMaxWidth,
    setWidth: setSidebarWidth,
  } = useSidebarContext()
  const {
    isOpen: auxOpenRequested,
    restored: auxRestored,
    width: auxWidth,
    minWidth: auxMinWidth,
    maxWidth: auxMaxWidth,
    setWidth: setAuxWidth,
  } = useAuxPanelContext()
  const {
    isOpen: terminalOpenRequested,
    height: terminalHeight,
    minHeight: terminalMinHeight,
    maxHeight: terminalMaxHeight,
    setHeight: setTerminalHeight,
  } = useTerminalContext()
  // A full-page workbench route (tasks / automations) replaces only the CENTER
  // panel — the terminal sits below it and the aux panel beside it, both
  // outside the overlay. Their toggles are hidden on those routes
  // (RightEdgeChrome), so anything left open would be stranded on screen with
  // no way to close it. Collapse both for the duration; the contexts keep the
  // user's real open state (and the terminal keeps running), so switching back
  // to conversations restores exactly what was there.
  const { isConversations } = useWorkbenchRoute()
  const auxOpen = auxOpenRequested && isConversations
  const terminalOpen = terminalOpenRequested && isConversations

  // Animate the shell (horizontal) group while the sidebar/aux toggle and the
  // main (vertical) group while the terminal toggles, so the panes slide open
  // and closed instead of snapping. Gated on `restored` so hydrating the
  // persisted open/closed state on load doesn't animate. The terminal has no
  // persisted state (always starts closed), so it's always "ready".
  const sidebarAnimating = usePanelSlideOnToggle(sidebarOpen, sidebarRestored)
  const auxAnimating = usePanelSlideOnToggle(auxOpen, auxRestored)
  const terminalAnimating = usePanelSlideOnToggle(terminalOpen, true)
  const shellSlideAnimating = sidebarAnimating || auxAnimating

  const shellGroupRef = useRef<ImperativePanelGroupHandle | null>(null)
  const mainGroupRef = useRef<ImperativePanelGroupHandle | null>(null)
  const shellContainerRef = useRef<HTMLDivElement | null>(null)
  const mainContainerRef = useRef<HTMLDivElement | null>(null)

  const [shellWidth, setShellWidth] = useState(0)
  const [mainHeight, setMainHeight] = useState(0)
  // The panels split the width LEFT OVER by the dividers, not the container's:
  // an open divider is a fixed 1px flex item (a closed one is `w-0`), and the
  // panels' percentages are shares of the remainder. Converting px <-> percent
  // against the full container width left the side columns up to a pixel off
  // their requested width, by an amount that changes with every window width —
  // the divider crept sub-pixel on each resize step.
  const shellHandlesWidth = (sidebarOpen ? 1 : 0) + (auxOpen ? 1 : 0)
  const shellPanelsWidth =
    shellWidth > 0 ? Math.max(1, shellWidth - shellHandlesWidth) : 0
  const mainHandlesHeight = terminalOpen ? 1 : 0
  const mainPanelsHeight =
    mainHeight > 0 ? Math.max(1, mainHeight - mainHandlesHeight) : 0

  const shellDesiredLayoutRef = useRef<[number, number, number]>([0, 100, 0])
  const shellAppliedLayoutRef = useRef<[number, number, number] | null>(null)
  const mainDesiredLayoutRef = useRef<[number, number]>([100, 0])
  const mainAppliedLayoutRef = useRef<[number, number] | null>(null)

  // A window resize needs no JS to keep the panes in place: the side columns
  // and the terminal are sized in px through CSS (see the panel styles below)
  // and the center / workspace pane flexes. The container size is only tracked
  // to keep react-resizable-panels' percent layout and min/max in step (and to
  // shrink the side columns once the window is too narrow for them), so an
  // ordinary state update is enough: no frame depends on it being flushed
  // synchronously, and none has to wait for a re-render of the shell.
  //
  // Each container size is held twice: as last observed, and as last applied
  // to the library's layout (by the layout effects below). While the two
  // differ, a container resize is on its way to that layout effect, and the
  // onLayout calls in between (the library re-clamping the panels against the
  // new min/max percentages, then our own setLayout) aren't user resizes and
  // must not be persisted — the re-clamp reports through an onLayout still
  // holding the old container size. Comparing sizes, rather than raising a
  // flag in the observer for the layout effect to lower, also holds when two
  // observations cancel out before React renders: that render bails out with
  // no layout effect run, and a flag left raised would swallow every later
  // drag until the next resize.
  const shellWidthRef = useRef(0)
  const shellAppliedWidthRef = useRef(0)
  const mainHeightRef = useRef(0)
  const mainAppliedHeightRef = useRef(0)

  useEffect(() => {
    const container = shellContainerRef.current
    if (!container) return

    shellWidthRef.current = container.clientWidth
    setShellWidth(container.clientWidth)
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? container.clientWidth
      if (Math.abs(shellWidthRef.current - next) < 1) return
      shellWidthRef.current = next
      setShellWidth(next)
    })

    observer.observe(container)
    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const container = mainContainerRef.current
    if (!container) return

    const initialHeight =
      container.clientHeight -
      (parseFloat(getComputedStyle(container).paddingTop) || 0)
    mainHeightRef.current = initialHeight
    setMainHeight(initialHeight)
    const observer = new ResizeObserver((entries) => {
      const next =
        entries[0]?.contentRect.height ??
        container.clientHeight -
          (parseFloat(getComputedStyle(container).paddingTop) || 0)
      if (Math.abs(mainHeightRef.current - next) < 1) return
      mainHeightRef.current = next
      setMainHeight(next)
    })

    observer.observe(container)
    return () => {
      observer.disconnect()
    }
  }, [isWorkbench])

  // The side columns' widths in px: the requested widths, scaled down together
  // when the window is too narrow to also leave MIN_CENTER_WIDTH_PX between —
  // but never below a column's own minimum. These px are what is drawn, and
  // the library clamps its own layout to the panels' minSize, so they have to
  // land where that clamp would: below it, a column renders narrower than its
  // content allows (the aux minimum on Windows/Linux is what keeps the
  // title-bar overlay off the center column), and the library's layout — the
  // base a handle drag starts from — sits tens of px away from the divider on
  // screen.
  const shellSides = useMemo(() => {
    const requestedLeft = sidebarOpen
      ? clamp(sidebarWidth, sidebarMinWidth, sidebarMaxWidth)
      : 0
    const requestedRight = auxOpen
      ? clamp(auxWidth, auxMinWidth, auxMaxWidth)
      : 0

    const totalWidth =
      shellPanelsWidth > 0
        ? shellPanelsWidth
        : requestedLeft + requestedRight + 960

    let left = requestedLeft
    let right = requestedRight

    const maxSideTotal = Math.max(0, totalWidth - MIN_CENTER_WIDTH_PX)
    const sideTotal = left + right
    if (sideTotal > maxSideTotal && sideTotal > 0) {
      const scale = maxSideTotal / sideTotal
      left *= scale
      right *= scale

      // Back up to each open column's minimum the way the library's clamp
      // does it (validatePanelGroupLayout): a panel raised to its minSize
      // takes the shortfall from the first panel in order that can spare it —
      // the sidebar, down to its own minimum, and then the center.
      let shortfall = 0
      if (sidebarOpen && left < sidebarMinWidth) {
        shortfall += sidebarMinWidth - left
        left = sidebarMinWidth
      }
      if (auxOpen && right < auxMinWidth) {
        shortfall += auxMinWidth - right
        right = auxMinWidth
      }
      if (sidebarOpen && shortfall > 0) {
        left -= Math.min(shortfall, left - sidebarMinWidth)
      }
    }

    return { left, right, totalWidth }
  }, [
    auxMaxWidth,
    auxMinWidth,
    auxOpen,
    auxWidth,
    shellPanelsWidth,
    sidebarMaxWidth,
    sidebarMinWidth,
    sidebarOpen,
    sidebarWidth,
  ])

  const buildShellLayout = useCallback((): [number, number, number] => {
    const { left, right, totalWidth } = shellSides
    const center = Math.max(1, totalWidth - left - right)
    const total = left + center + right

    return [(left / total) * 100, (center / total) * 100, (right / total) * 100]
  }, [shellSides])

  // The side panels are sized in px straight through CSS, overriding the
  // `flex-grow: <percent>` react-resizable-panels writes (a Panel's `style`
  // prop wins over its computed one), and the center — the only panel left
  // growing — takes whatever remains. That style is rounded to 3 significant
  // digits (`toPrecision(3)`, e.g. 20.83% → "20.8"): ~0.5px at 1440px wide, by
  // an error that changes with every window width, so a sidebar sized through
  // it wobbled on each resize step however precise the layout fed in. Pinned
  // in px, a window resize leaves the side columns alone and only the center
  // flexes. The library's layout is still kept in step (buildShellLayout) — it
  // drives handle drags and the min/max clamping, and a drag reaches these px
  // through handleShellLayout → setSidebarWidth / setAuxWidth.
  const sidebarPanelStyle = useMemo(
    () => ({ flexGrow: 0, flexShrink: 0, flexBasis: `${shellSides.left}px` }),
    [shellSides.left]
  )
  const auxPanelStyle = useMemo(
    () => ({ flexGrow: 0, flexShrink: 0, flexBasis: `${shellSides.right}px` }),
    [shellSides.right]
  )

  // The terminal's height in px: the requested height, capped so the workspace
  // above keeps MIN_WORKSPACE_HEIGHT_PX — but, like the side columns, never
  // below the panel's own minimum, where the library's layout clamps it.
  const terminalSize = useMemo(() => {
    if (!terminalOpen) return { terminal: 0, totalHeight: 0 }

    const requestedTerminalHeight = clamp(
      terminalHeight,
      terminalMinHeight,
      terminalMaxHeight
    )
    const totalHeight =
      mainPanelsHeight > 0 ? mainPanelsHeight : requestedTerminalHeight + 640

    const maxTerminalHeight = Math.max(0, totalHeight - MIN_WORKSPACE_HEIGHT_PX)
    const terminal = Math.max(
      Math.min(requestedTerminalHeight, maxTerminalHeight),
      terminalMinHeight
    )
    return { terminal, totalHeight }
  }, [
    mainPanelsHeight,
    terminalHeight,
    terminalMaxHeight,
    terminalMinHeight,
    terminalOpen,
  ])

  const buildMainLayout = useCallback((): [number, number] => {
    if (!terminalOpen) {
      return [100, 0]
    }

    const { terminal, totalHeight } = terminalSize
    const workspace = Math.max(1, totalHeight - terminal)
    const total = workspace + terminal

    return [(workspace / total) * 100, (terminal / total) * 100]
  }, [terminalOpen, terminalSize])

  // Same px pinning as the side columns (see sidebarPanelStyle), so a window
  // height change leaves the terminal alone and only the workspace flexes.
  const terminalPanelStyle = useMemo(
    () => ({
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: `${terminalSize.terminal}px`,
    }),
    [terminalSize.terminal]
  )

  const applyShellLayout = useCallback((layout: [number, number, number]) => {
    shellDesiredLayoutRef.current = layout
    if (
      shellAppliedLayoutRef.current &&
      isSameLayout(shellAppliedLayoutRef.current, layout, PIXEL_LAYOUT_EPSILON)
    ) {
      return
    }

    const shellGroup = shellGroupRef.current
    if (!shellGroup) return

    try {
      shellGroup.setLayout(layout)
      shellAppliedLayoutRef.current = layout
    } catch {
      /* retry via onLayout */
    }
  }, [])

  const applyMainLayout = useCallback((layout: [number, number]) => {
    mainDesiredLayoutRef.current = layout
    if (
      mainAppliedLayoutRef.current &&
      isSameLayout(mainAppliedLayoutRef.current, layout, PIXEL_LAYOUT_EPSILON)
    ) {
      return
    }

    const mainGroup = mainGroupRef.current
    if (!mainGroup) return

    try {
      mainGroup.setLayout(layout)
      mainAppliedLayoutRef.current = layout
    } catch {
      /* retry via onLayout */
    }
  }, [])

  // Layout effects so the library catches up in the same commit as the new
  // container size. Recording the size the layout was applied for, AFTER the
  // apply (whose own onLayout must still read as resize-caused), ends the
  // resize window (see the ResizeObserver note).
  useLayoutEffect(() => {
    applyShellLayout(buildShellLayout())
    shellAppliedWidthRef.current = shellWidth
  }, [applyShellLayout, buildShellLayout, shellWidth])

  useLayoutEffect(() => {
    applyMainLayout(buildMainLayout())
    mainAppliedHeightRef.current = mainHeight
  }, [applyMainLayout, buildMainLayout, mainHeight])

  const handleShellLayout = useCallback(
    (layout: number[]) => {
      if (layout.length !== 3) return

      const normalizedLayout: [number, number, number] = [
        layout[0],
        layout[1],
        layout[2],
      ]
      shellAppliedLayoutRef.current = normalizedLayout

      const desired = shellDesiredLayoutRef.current
      const shouldEnforceDesiredLayout =
        (!sidebarOpen && normalizedLayout[0] > LAYOUT_EPSILON) ||
        (!auxOpen && normalizedLayout[2] > LAYOUT_EPSILON)

      if (
        shouldEnforceDesiredLayout &&
        !isSameLayout(normalizedLayout, desired)
      ) {
        applyShellLayout(desired)
        return
      }

      if (
        shellWidthRef.current !== shellAppliedWidthRef.current ||
        shellPanelsWidth <= 0
      )
        return

      if (sidebarOpen) {
        const nextSidebarWidth = (normalizedLayout[0] / 100) * shellPanelsWidth
        const withinSidebarRange =
          nextSidebarWidth >= sidebarMinWidth - 1 &&
          nextSidebarWidth <= sidebarMaxWidth + 1
        if (
          withinSidebarRange &&
          Math.abs(nextSidebarWidth - sidebarWidth) >= 1
        ) {
          setSidebarWidth(nextSidebarWidth)
        }
      }

      if (auxOpen) {
        const nextAuxWidth = (normalizedLayout[2] / 100) * shellPanelsWidth
        const withinAuxRange =
          nextAuxWidth >= auxMinWidth - 1 && nextAuxWidth <= auxMaxWidth + 1
        if (withinAuxRange && Math.abs(nextAuxWidth - auxWidth) >= 1) {
          setAuxWidth(nextAuxWidth)
        }
      }
    },
    [
      applyShellLayout,
      auxMaxWidth,
      auxMinWidth,
      auxOpen,
      auxWidth,
      setAuxWidth,
      setSidebarWidth,
      shellPanelsWidth,
      sidebarMaxWidth,
      sidebarMinWidth,
      sidebarOpen,
      sidebarWidth,
    ]
  )

  const handleMainLayout = useCallback(
    (layout: number[]) => {
      if (layout.length !== 2) return

      const normalizedLayout: [number, number] = [layout[0], layout[1]]
      mainAppliedLayoutRef.current = normalizedLayout

      const desired = mainDesiredLayoutRef.current
      if (
        !terminalOpen &&
        normalizedLayout[1] > LAYOUT_EPSILON &&
        !isSameLayout(normalizedLayout, desired)
      ) {
        applyMainLayout(desired)
        return
      }

      if (
        !terminalOpen ||
        mainHeightRef.current !== mainAppliedHeightRef.current ||
        mainPanelsHeight <= 0
      )
        return

      const nextTerminalHeight = (normalizedLayout[1] / 100) * mainPanelsHeight
      const withinTerminalRange =
        nextTerminalHeight >= terminalMinHeight - 1 &&
        nextTerminalHeight <= terminalMaxHeight + 1
      if (
        withinTerminalRange &&
        Math.abs(nextTerminalHeight - terminalHeight) >= 1
      ) {
        setTerminalHeight(nextTerminalHeight)
      }
    },
    [
      applyMainLayout,
      mainPanelsHeight,
      setTerminalHeight,
      terminalHeight,
      terminalMaxHeight,
      terminalMinHeight,
      terminalOpen,
    ]
  )

  // The panes' contents as stable elements: the shell re-renders on every
  // container resize step (and on each drag step), and none of these read
  // anything from it — they take their state from context — so React bails
  // out of re-rendering their (large) subtrees instead of redoing the whole
  // workspace each frame.
  const sidebarElement = useMemo(() => <Sidebar />, [])
  const auxElement = useMemo(() => <AuxPanel />, [])
  const terminalElement = useMemo(() => <TerminalPanel />, [])
  const workspaceElement = useMemo(
    () => <WorkspaceContent>{children}</WorkspaceContent>,
    [children]
  )

  const safeShellWidth = shellPanelsWidth > 0 ? shellPanelsWidth : 1440
  const sidebarSizeRange = resolvePanelSizeRange(
    sidebarMinWidth,
    sidebarMaxWidth,
    safeShellWidth
  )
  const auxSizeRange = resolvePanelSizeRange(
    auxMinWidth,
    auxMaxWidth,
    safeShellWidth
  )

  const safeMainHeight = mainPanelsHeight > 0 ? mainPanelsHeight : 900
  const terminalSizeRange = resolvePanelSizeRange(
    terminalMinHeight,
    terminalMaxHeight,
    safeMainHeight
  )

  return (
    <div
      ref={shellContainerRef}
      className="relative flex flex-1 min-h-0 overflow-hidden"
    >
      {isWorkbench && (
        <div
          data-worktree-outer-row
          className={cn(
            "absolute right-0 top-0 z-30 flex h-10 items-stretch border-b border-border/50 ws-chrome-border bg-muted ws-surface-muted",
            sidebarAnimating &&
              "transition-[left] duration-[240ms] ease-in-out motion-reduce:transition-none [&_.chrome-reserve]:transition-[width] [&_.chrome-reserve]:duration-[240ms] [&_.chrome-reserve]:ease-in-out motion-reduce:[&_.chrome-reserve]:transition-none"
          )}
          style={{ left: sidebarOpen ? shellSides.left + 1 : 0 }}
        >
          <ChromeReserve
            width={
              sidebarOpen
                ? 0
                : leftChromeReserve(isMac && isDesktop(), zoomLevel)
            }
            line={false}
          />
          <WorktreeWorkbenchTabBar />
          <ChromeReserve
            width={rightChromeReserve(
              isDesktop() && (isWindows || isLinux),
              zoomLevel
            )}
            line={false}
          />
        </div>
      )}
      <ResizablePanelGroup
        id={FOLDER_SHELL_GROUP_ID}
        ref={shellGroupRef}
        direction="horizontal"
        onLayout={handleShellLayout}
        className={shellSlideAnimating ? "panel-slide-animating" : undefined}
      >
        <ResizablePanel
          id={FOLDER_SHELL_LEFT_PANEL_ID}
          order={1}
          defaultSize={18}
          style={sidebarPanelStyle}
          minSize={sidebarOpen ? sidebarSizeRange.minSize : 0}
          maxSize={sidebarOpen ? sidebarSizeRange.maxSize : 0}
        >
          {/* `bg-sidebar` on the wrapper (not just the Sidebar surface) so the
              collapse never flashes white: Sidebar `return null`s the instant
              it closes, but the panel keeps a shrinking width for the 240ms
              slide — an un-backed wrapper would show the root `bg-background`
              (white) through that gap. */}
          <div className="h-full min-h-0 overflow-hidden ws-surface-sidebar">
            {sidebarElement}
          </div>
        </ResizablePanel>

        <ResizableHandle
          withHandle
          disabled={!sidebarOpen}
          className={
            sidebarOpen ? "" : "pointer-events-none w-0 opacity-0 after:w-0"
          }
        />

        <ResizablePanel
          id={FOLDER_SHELL_MAIN_PANEL_ID}
          order={2}
          defaultSize={64}
          minSize={10}
        >
          <main
            ref={mainContainerRef}
            className="relative flex h-full min-h-0 flex-col overflow-hidden"
            style={{ paddingTop: isWorkbench ? "2.5rem" : undefined }}
          >
            {isEmptyWorkbench && isConversations && (
              <div className="absolute inset-x-0 bottom-0 top-10 z-20 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
                {tOuter("chooseProject")}
              </div>
            )}
            <ResizablePanelGroup
              id={FOLDER_MAIN_GROUP_ID}
              ref={mainGroupRef}
              direction="vertical"
              onLayout={handleMainLayout}
              className={
                terminalAnimating ? "panel-slide-animating" : undefined
              }
            >
              <ResizablePanel
                id={FOLDER_MAIN_WORKSPACE_PANEL_ID}
                order={1}
                defaultSize={72}
                minSize={15}
              >
                {workspaceElement}
              </ResizablePanel>

              {/* Closed, the handle gives up its BOX, not just its paint — and
                  the override has to carry the same
                  `data-[panel-group-direction=vertical]` prefix the base size
                  does. A bare `h-0` is (0,1,0) against that rule's (0,2,0)
                  attribute selector and tailwind-merge keeps both (different
                  modifier sets), so it loses in silence: the closed terminal
                  kept a 1px invisible strip of the app background between the
                  workspace and the status bar, which reads as a gap under a
                  browser page or an HTML preview (the only panes that paint to
                  their own edge). The horizontal handles' `w-0` needs no
                  prefix — their base `w-px` is unprefixed, so twMerge drops
                  it. */}
              <ResizableHandle
                withHandle
                disabled={!terminalOpen}
                className={
                  terminalOpen
                    ? ""
                    : "pointer-events-none opacity-0 data-[panel-group-direction=vertical]:h-0 data-[panel-group-direction=vertical]:after:h-0"
                }
              />

              <ResizablePanel
                id={FOLDER_MAIN_TERMINAL_PANEL_ID}
                order={2}
                defaultSize={28}
                style={terminalPanelStyle}
                minSize={terminalOpen ? terminalSizeRange.minSize : 0}
                maxSize={terminalOpen ? terminalSizeRange.maxSize : 0}
              >
                <div className="h-full min-h-0 overflow-hidden">
                  <KeptMountedSurface hidden={isEmptyWorkbench}>
                    {terminalElement}
                  </KeptMountedSurface>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </main>
        </ResizablePanel>

        <ResizableHandle
          withHandle
          disabled={!auxOpen}
          className={
            auxOpen ? "" : "pointer-events-none w-0 opacity-0 after:w-0"
          }
        />

        <ResizablePanel
          id={FOLDER_SHELL_RIGHT_PANEL_ID}
          order={3}
          defaultSize={18}
          style={auxPanelStyle}
          minSize={auxOpen ? auxSizeRange.minSize : 0}
          maxSize={auxOpen ? auxSizeRange.maxSize : 0}
        >
          {/* Transparent canvas so the right column reads like the middle
              conversation area (its own frosted chrome — the aux toolbar — sits
              on top): with a background image on, the file tree shows the image
              through instead of a second frosted layer over the toolbar. The
              paired `bg-background` is the off-state (image disabled): equivalent
              to the old opaque wrapper, so the 240ms collapse slide still never
              flashes white while AuxPanel `return null`s. */}
          <div
            className="h-full min-h-0 overflow-hidden bg-background ws-transparent-bg"
            style={{ paddingTop: isWorkbench ? "2.5rem" : undefined }}
          >
            <KeptMountedSurface hidden={isEmptyWorkbench}>
              {auxElement}
            </KeptMountedSurface>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

function FolderLayoutShell({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile()
  const { isWindows, isLinux } = usePlatform()
  const winLinuxControls = isDesktop() && (isWindows || isLinux)
  const {
    workspaceBgEnabled,
    workspaceBgImageUrl,
    workspaceBgMaskOpacity,
    workspaceBgImageBlur,
    workspaceBgFillMode,
  } = useWorkspaceBackground()
  const showBackground = workspaceBgEnabled && workspaceBgImageUrl !== null
  const fillStyle = FILL_MODE_STYLE[workspaceBgFillMode]

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      {/* 用户背景图片：铺在整个工作区底层。根 div 是 fixed，已建立层叠上下文，故
          -z-10 绘于自身 bg-background 之上、所有流内容之下。遮罩是朝 --background 的
          面纱（明暗自适配），保证内容可读；结构性面板的半透明由 globals.css 的
          [data-workspace-bg] 规则处理，不在此。 */}
      {showBackground && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-center"
            style={{
              backgroundImage: `url("${workspaceBgImageUrl}")`,
              backgroundSize: fillStyle.size,
              backgroundRepeat: fillStyle.repeat,
              filter: workspaceBgImageBlur
                ? `blur(${workspaceBgImageBlur}px)`
                : undefined,
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              backgroundColor: `color-mix(in oklch, var(--background) ${Math.round(
                workspaceBgMaskOpacity * 100
              )}%, transparent)`,
            }}
          />
        </>
      )}
      {/* Global shortcuts + the search / remote-directory dialogs (formerly
          owned by the full-width FolderTitleBar). Mounted on both platforms. */}
      <WorkspaceChromeController />
      {isMobile ? (
        <>
          {/* Mobile keeps the visible full-width bar; desktop moved its buttons
              into fixed corner overlays (LeftEdgeChrome / RightEdgeChrome). */}
          <FolderTitleBar />
          <MobileFolderWorkspaceShell>{children}</MobileFolderWorkspaceShell>
        </>
      ) : (
        <FolderWorkspaceShell>{children}</FolderWorkspaceShell>
      )}
      <StatusBar />
      {/* Desktop window chrome, pinned to the window corners so it never moves —
          or re-mounts — when the side panels open/close (that re-parenting is
          what made the old in-header clusters flicker). Left = sidebar toggle +
          search; right = terminal/aux/settings, sitting to the LEFT of the
          Windows/Linux caption buttons; then the caption buttons themselves
          (self-null on macOS/web). Each edge column reserves the matching width
          beneath these (see leftChromeReserve / rightChromeReserve). */}
      {!isMobile && (
        <>
          <div className="absolute left-0 top-0 z-50 h-10">
            <LeftEdgeChrome />
          </div>
          <div
            className="absolute top-0 z-50 h-10"
            style={{ right: winLinuxControls ? WINDOW_CAPTION_WIDTH : 0 }}
          >
            <RightEdgeChrome />
          </div>
          <div className="absolute right-0 top-0 z-50 h-10">
            <WindowControls />
          </div>
        </>
      )}
      <AppToaster
        position="bottom-right"
        duration={TOAST_DURATION_MS}
        closeButton
      />
    </div>
  )
}

// Single chokepoint that keeps the workbench route honest: opening or switching
// to a conversation from ANY entry point (sidebar, ⌘T, search, deep links, pet
// focus, branch switch, run history …) activates a tab, so leaving a non-default
// route whenever activeTabId changes covers every opener — present and future —
// without patching each call site. Re-selecting the ALREADY-active tab does not
// change activeTabId, so the interactive conversation pickers (sidebar list,
// search dialog, run history) also call openConversations() directly.
function WorkbenchRouteConversationSync() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const { consumeRemoteActivation } = useTabActions()
  const { openConversations } = useWorkbenchRoute()
  const prevRef = useRef(activeTabId)
  useEffect(() => {
    if (prevRef.current === activeTabId) return
    prevRef.current = activeTabId
    // A remote tab snapshot that mirrors another client's focus also changes
    // activeTabId. That's not a local conversation activation, so don't hijack
    // this window into the conversations route — doing so would unmount whatever
    // non-conversation view it's on (e.g. the Automations editor + unsaved
    // edits). Local activations leave the flag false and switch as before.
    if (consumeRemoteActivation()) return
    openConversations()
  }, [activeTabId, openConversations, consumeRemoteActivation])
  return null
}

function WorkspaceLayoutInner({ children }: { children: React.ReactNode }) {
  return (
    <AppWorkspaceProvider>
      <AlertProvider>
        <GitCredentialProvider>
          <TaskProvider>
            <AcpConnectionsProvider>
              <DelegationProvider>
                <ConversationStatusEventBridge />
                {/* Tag definitions (names, colours) for every chip in this
                    window; which tags a conversation carries rides on its
                    summary instead. */}
                <ConversationTagsSync />
                <AssistantsSync />
                {/* The tag manager, opened from tag pickers, folder menus and
                    the sidebar's tag filter — all popovers or menus that
                    unmount as they close, so none can host it. */}
                <ConversationTagsManagerHost />
                <ConversationRuntimeProvider>
                  <WorkspaceProvider>
                    <TabProvider>
                      <WorkspaceDocumentTitle />
                      <TabKeysSync />
                      <BrowserEventsBridge />
                      {/* Beside the events bridge and not inside it: that one
                          stops where no built-in browser exists, and a local
                          server is worth hearing about in web mode too (the
                          port bridge can show it). */}
                      <BrowserServiceBridge />
                      {/* Mounted beside the bridge, not inside a tab: the tab
                          an agent asks to run code on is usually not the one
                          the person is looking at. */}
                      <BrowserEvalConfirm />
                      {/* Here and not in the browser tab it is opened from:
                          only the tab on screen is mounted, and a tab opening
                          on its own would take the marks with it. */}
                      <BrowserScreenshotMarkupHost />
                      <BrowserTabsPersistence />
                      <BrowserTabsSuspender />
                      <HeavyPluginsWarmup />
                      <DeepLinkBootstrap />
                      <PetFocusBridge />
                      <WorkspaceRestoreNotices />
                      {/* Always mounted: external-change conflicts must be
                            resolvable even with the aux file tree closed. */}
                      <ExternalConflictDialog />
                      <SidebarProvider>
                        <AuxPanelProvider>
                          <TerminalProvider>
                            <SearchDialogProvider>
                              <AutomationsViewProvider>
                                <TasksViewProvider>
                                  <WorkbenchRouteProvider>
                                    <WorkbenchRouteConversationSync />
                                    {/* Inside WorkbenchRouteProvider: the
                                          listener calls openConversations() to
                                          surface a launcher-opened folder. */}
                                    <WorkspaceOpenFolderListener />
                                    <FolderLayoutShell>
                                      {children}
                                    </FolderLayoutShell>
                                  </WorkbenchRouteProvider>
                                </TasksViewProvider>
                              </AutomationsViewProvider>
                            </SearchDialogProvider>
                          </TerminalProvider>
                        </AuxPanelProvider>
                      </SidebarProvider>
                    </TabProvider>
                  </WorkspaceProvider>
                </ConversationRuntimeProvider>
              </DelegationProvider>
            </AcpConnectionsProvider>
          </TaskProvider>
        </GitCredentialProvider>
      </AlertProvider>
    </AppWorkspaceProvider>
  )
}

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense>
      <RemoteConnectionGate>
        <UpdateProvider>
          <WorkspaceLayoutInner>{children}</WorkspaceLayoutInner>
        </UpdateProvider>
      </RemoteConnectionGate>
    </Suspense>
  )
}
