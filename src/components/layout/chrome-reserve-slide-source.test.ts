import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

// Source-level guards for the top strips' corner reserves (ChromeReserve):
// what they slide with lives in CSS and in where the strips mount them, so the
// invariants are asserted on the source, as conversation-detail-panel-layout
// does for the rest of this layout.
const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8")
const flatCss = read("src/app/globals.css")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ")
const layout = read("src/app/workspace/layout.tsx")
const surface = read("src/components/workbench/workbench-surface.tsx")

const RESERVE_SELECTOR =
  '.panel-slide-animating[data-panel-group-direction="horizontal"] .chrome-reserve'

describe("corner reserve slide", () => {
  // Three copies of one timing: the JS hold on the class, the panels' own
  // transition, and the reserves'. Tabs only change width monotonically while
  // the reserve and its column move on the same curve.
  it("slides the reserves on the side panels' own duration and easing", () => {
    const panelRule = flatCss.match(
      /\.panel-slide-animating > \[data-panel\] \{ transition: flex-grow (\d+)ms ([\w-]+), flex-basis (\d+)ms ([\w-]+); \}/
    )
    const reserveRule = flatCss.match(
      /\.panel-slide-animating\[data-panel-group-direction="horizontal"\] \.chrome-reserve \{ transition: width (\d+)ms ([\w-]+); \}/
    )
    const panelSlideMs = layout.match(/const PANEL_SLIDE_MS = (\d+)/)
    expect(panelRule).not.toBeNull()
    expect(reserveRule).not.toBeNull()
    expect(panelSlideMs).not.toBeNull()
    const [, growMs, growEase, basisMs, basisEase] = panelRule!
    expect(growMs).toBe(basisMs)
    expect(growEase).toBe(basisEase)
    expect(reserveRule![1]).toBe(basisMs)
    expect(reserveRule![2]).toBe(basisEase)
    expect(panelSlideMs![1]).toBe(basisMs)
  })

  // The nested vertical (terminal) group carries the same class while the
  // terminal slides, and no reserve follows the terminal.
  it("arms the reserve transition only from the horizontal shell group", () => {
    expect(flatCss).not.toContain(".panel-slide-animating .chrome-reserve")
  })

  // The opt-out has to repeat the full selector: a shorter one loses on
  // specificity and the reserves would keep sliding under reduced motion.
  it("snaps the reserves under reduced motion", () => {
    const reduced = flatCss.match(
      /@media \(prefers-reduced-motion: reduce\) \{ \.panel-slide-animating > \[data-panel\], ([^{]*) \{ transition: none; \} \}/
    )
    expect(reduced).not.toBeNull()
    expect(reduced![1]).toBe(RESERVE_SELECTOR)
  })

  it("routes every corner reserve through ChromeReserve", () => {
    expect(layout).not.toMatch(/style={{ width: (left|right)Reserve }}/)
    expect(surface).not.toMatch(/style={{ width: (left|right)Reserve }}/)
    // The workbench-route band reserves the left corner too, and draws its
    // own bottom border, so no strip hairline on its reserve.
    expect(layout).toContain(
      "<ChromeReserve width={leftCornerWidth} line={false} />"
    )
    // Conversation/files share one workbench toolbar now. It owns both edge
    // reserves, using the zoom-aware platform helpers and sidebar/aux state.
    expect(surface).toContain(
      'import { ChromeReserve } from "@/components/layout/chrome-reserve"'
    )
    expect(surface).toContain("const { zoomLevel } = useZoomLevel()")
    expect(surface).toContain(
      "const { isOpen: sidebarOpen } = useSidebarContext()"
    )
    expect(surface).toContain(
      "const { isOpen: auxOpen } = useAuxPanelContext()"
    )
    expect(surface).toContain(
      "leftChromeReserve(isMac && isDesktop(), zoomLevel)"
    )
    expect(surface).toContain("rightChromeReserve(")
    expect(surface).toContain("zoomLevel")
  })

  // Width follows the side panel over the corner (that change slides); which
  // column holds the corner follows the workspace mode / which column is
  // maximized (that change snaps the layout), so it decides whether the
  // reserve is mounted — a reserve still animating after its column had moved
  // left a closing gap.
  it("mounts the workbench toolbar reserves once and sizes them by side-panel state", () => {
    const jsxReserveCount = surface.match(/<ChromeReserve\b/g)?.length ?? 0
    expect(jsxReserveCount).toBe(2)
    expect(surface).toContain("sidebarOpen")
    expect(surface).toContain("? 0")
    expect(surface).toContain(
      "leftChromeReserve(isMac && isDesktop(), zoomLevel)"
    )
    expect(surface).toContain("auxOpen")
    expect(surface).toContain("rightChromeReserve(")
    expect(surface).toContain("isDesktop() && (isWindows || isLinux)")
    expect(surface).toContain("line={false}")
    expect(surface).not.toContain("convHoldsRight")
    expect(surface).not.toContain("fileHoldsLeft")
    expect(surface).not.toContain("fileHoldsRight")
  })

  it("does not mount per-split strip reserves after the global toolbar move", () => {
    expect(surface).not.toContain("SplitStripCornerReserve")
    expect(surface).not.toContain("convHoldsRight")
    expect(surface).not.toContain("fileHoldsRight")
    expect(surface).toContain(
      '<div data-tauri-drag-region className="h-full min-w-2 flex-1" />'
    )
  })
})
