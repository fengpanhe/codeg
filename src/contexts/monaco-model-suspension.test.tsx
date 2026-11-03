import { useEffect } from "react"
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { Monaco } from "@monaco-editor/react"
import {
  MonacoModelProvider,
  useTrackMonacoModel,
} from "./monaco-model-context"

function fixture() {
  const model = {
    disposed: false,
    attached: false,
    isAttachedToEditor: () => model.attached,
    dispose: () => {
      model.disposed = true
    },
  }
  const engine = {
    Uri: { parse: (uri: string) => uri },
    editor: { getModel: () => model },
  } as unknown as Monaco
  function Track() {
    const track = useTrackMonacoModel()
    useEffect(() => track("file:///repo/a.ts", engine), [track])
    return null
  }
  return { model, Track }
}
describe("sleeping editor models", () => {
  it("releases a detached model for a suspended open file", () => {
    const { model, Track } = fixture()
    const tabs = [{ id: "a", path: "/repo/a.ts" }]
    const view = render(
      <MonacoModelProvider fileTabs={tabs}>
        <Track />
      </MonacoModelProvider>
    )
    expect(model.disposed).toBe(false)
    view.rerender(
      <MonacoModelProvider fileTabs={tabs} suspendedTabIds={new Set(["a"])}>
        <Track />
      </MonacoModelProvider>
    )
    expect(model.disposed).toBe(true)
  })
  it("keeps a shared model while another alias still owns its cache", () => {
    const { model, Track } = fixture()
    render(
      <MonacoModelProvider
        fileTabs={[
          { id: "a", path: "/repo/a.ts" },
          { id: "b", path: "/repo/a.ts" },
        ]}
        suspendedTabIds={new Set(["a"])}
      >
        <Track />
      </MonacoModelProvider>
    )
    expect(model.disposed).toBe(false)
  })
  it("never disposes a model still attached to an editor", () => {
    const { model, Track } = fixture()
    model.attached = true
    render(
      <MonacoModelProvider
        fileTabs={[{ id: "a", path: "/repo/a.ts" }]}
        suspendedTabIds={new Set(["a"])}
      >
        <Track />
      </MonacoModelProvider>
    )
    expect(model.disposed).toBe(false)
  })
})
