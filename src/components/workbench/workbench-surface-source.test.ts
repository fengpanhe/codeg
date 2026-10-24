import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const surfaceSource = readFileSync(
  resolve(process.cwd(), "src/components/workbench/workbench-surface.tsx"),
  "utf8"
)
const tabBarSource = readFileSync(
  resolve(process.cwd(), "src/components/workbench/workbench-tab-bar.tsx"),
  "utf8"
)
const workspaceLayoutSource = readFileSync(
  resolve(process.cwd(), "src/app/workspace/layout.tsx"),
  "utf8"
)
const globalsCssSource = readFileSync(
  resolve(process.cwd(), "src/app/globals.css"),
  "utf8"
)

describe("WorkbenchSurface source layout invariants", () => {
  it("couples hidden keep-alive panes to the transition and Monaco hardening CSS", () => {
    const hiddenClass =
      '"conversation-tab-hidden invisible pointer-events-none"'
    expect(surfaceSource.match(/!position\.visible &&/g)).toHaveLength(2)
    expect(
      surfaceSource.match(/aria-hidden=\{!position\.visible\}/g)
    ).toHaveLength(2)
    expect(
      surfaceSource.match(/inert=\{!position\.visible \|\| undefined\}/g)
    ).toHaveLength(2)
    expect(
      surfaceSource.match(
        /<OverlayHostHiddenProvider hidden=\{!position\.visible\}>/g
      )
    ).toHaveLength(2)
    expect(surfaceSource).toContain(hiddenClass)

    expect(workspaceLayoutSource).toContain("function KeptMountedSurface({")
    expect(workspaceLayoutSource).toContain(
      'hidden && "conversation-tab-hidden invisible"'
    )
    expect(workspaceLayoutSource).toContain("inert={hidden || undefined}")
    expect(workspaceLayoutSource).toContain(
      "<OverlayHostHiddenProvider hidden={hidden}>"
    )
    expect(
      workspaceLayoutSource.match(
        /<KeptMountedSurface hidden=\{!isConversations\}>/g
      )
    ).toHaveLength(2)

    expect(globalsCssSource).toContain(".conversation-tab-hidden *")
    const transitionRule = globalsCssSource.slice(
      globalsCssSource.indexOf(".conversation-tab-hidden,"),
      globalsCssSource.indexOf(".conversation-tab-hidden,") + 200
    )
    expect(transitionRule).toContain("transition-property: none !important")

    const monacoSelector =
      ".conversation-tab-hidden .monaco-diff-editor > .editor"
    expect(globalsCssSource).toContain(monacoSelector)
    const monacoRule = globalsCssSource.slice(
      globalsCssSource.indexOf(monacoSelector),
      globalsCssSource.indexOf(monacoSelector) + 120
    )
    expect(monacoRule).toContain("visibility: hidden !important")
  })

  it("keeps conversation and file panes as flat, stably keyed canvas siblings", () => {
    expect(surfaceSource).toContain(
      'workbenchPaneLayout(workspace, "conversation")'
    )
    expect(surfaceSource).toContain('workbenchPaneLayout(workspace, "files")')
    expect(surfaceSource).toContain("{stableConversations.map((tab) => {")
    expect(surfaceSource).toContain("key={\`conversation:\${tab.id}\`}")
    expect(surfaceSource).toContain("{fileSurfaces.map(({ ws, tab }) => {")
    expect(surfaceSource).toContain("key={\`file:\${ws.scopeId}:\${tab.id}\`}")
    expect(surfaceSource).toContain("style={bodyStyle(position.rect)}")
    expect(surfaceSource).not.toContain("<RenderGroupShell")
    expect(surfaceSource).not.toContain("<RenderTabWrapper")
  })

  it("renders one strip per group and pairs each visible surface with its own title/header", () => {
    expect(surfaceSource).toContain("{strips.map((strip) => (")
    expect(surfaceSource).toContain("key={strip.key}")
    expect(surfaceSource).toContain("left: \`\${strip.rect.x}%\`")
    expect(surfaceSource).toContain("width: \`\${strip.rect.w}%\`")
    expect(surfaceSource).toContain("<WorkbenchTabBar")
    expect(surfaceSource).toContain("groupId={strip.groupId}")
    expect(surfaceSource).toContain("tabs={strip.tabs}")

    const conversationPaneStart = surfaceSource.indexOf(
      "{stableConversations.map((tab) => {"
    )
    const conversationPaneEnd = surfaceSource.indexOf(
      "{fileSurfaces.map(({ ws, tab }) => {",
      conversationPaneStart
    )
    expect(conversationPaneStart).toBeGreaterThan(-1)
    expect(conversationPaneEnd).toBeGreaterThan(conversationPaneStart)
    const conversationPane = surfaceSource.slice(
      conversationPaneStart,
      conversationPaneEnd
    )
    expect(conversationPane).toContain("<ConversationDetailHeader")
    expect(conversationPane).toContain("tabId={tab.id}")
    expect(conversationPane).toContain("style={bodyStyle(position.rect)}")

    const filePaneStart = conversationPaneEnd
    const filePaneEnd = surfaceSource.indexOf(
      "{strips\n          .filter",
      filePaneStart
    )
    expect(filePaneEnd).toBeGreaterThan(filePaneStart)
    const filePane = surfaceSource.slice(filePaneStart, filePaneEnd)
    expect(filePane).toContain("<FileWorkspaceHeader tabId={tab.entityId} />")
    expect(filePane).toContain("<FileWorkspacePanel")
    expect(filePane).toContain("groupId={position.groupId}")
  })

  it("preserves the active-session cue whenever split or tiled conversations are visible", () => {
    expect(surfaceSource).toContain("position.active &&")
    expect(surfaceSource).toContain("leafIds(workspace.groupLayout).length > 1")
    expect(surfaceSource).toContain("workspace.tileByGroup[position.groupId]")
    expect(surfaceSource).toContain(
      '<span className="sr-only">{t("activeConversation")}</span>'
    )
    expect(surfaceSource).toContain("isActive: position.active")
  })

  it("keeps tab drag surfaces on every workbench strip", () => {
    expect(surfaceSource).not.toContain('aria-label={t("interfaceMode")}')
    expect(surfaceSource).toContain("pane={strip.pane}")
    expect(tabBarSource).toContain("data-workbench-group={groupId}")
    expect(tabBarSource).toContain("draggable")
    expect(tabBarSource).toContain(
      'event.dataTransfer.setData(\n                    "application/x-codeg-workbench-tab"'
    )
    expect(tabBarSource).toContain(
      'event.dataTransfer.types.includes("application/x-codeg-workbench-tab")'
    )
    expect(tabBarSource).toMatch(
      /useWorkbenchStore\s*\.getState\(\)\s*\.moveTab/
    )
    expect(tabBarSource).toContain(
      '<div data-tauri-drag-region className="min-w-4 flex-1" />'
    )
    const historyIndex = tabBarSource.indexOf(
      '{pane === "conversation" && (\n        <WorkbenchConversationHistory'
    )
    const tabMapIndex = tabBarSource.indexOf("{tabs.map((tab, index) => {")
    expect(historyIndex).toBeGreaterThan(-1)
    expect(tabMapIndex).toBeGreaterThan(historyIndex)
    expect(tabBarSource).toContain(
      '{pane === "conversation" && (\n        <WorkbenchConversationHistory'
    )
  })
})
