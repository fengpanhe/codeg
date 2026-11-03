import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { setLiveComposerContent } from "@/lib/message-input-draft"
import { useLiveComposerContent } from "./use-live-composer-content"

describe("composer content protects sleeping surfaces", () => {
  it("reacts when the final composer or intake releases its draft", () => {
    const { result, unmount } = renderHook(() =>
      useLiveComposerContent("sleep-draft")
    )
    act(() => setLiveComposerContent("sleep-draft", "composer", true))
    expect(result.current).toBe(true)
    act(() => setLiveComposerContent("sleep-draft", "intake", true))
    act(() => setLiveComposerContent("sleep-draft", "composer", false))
    expect(result.current).toBe(true)
    act(() => setLiveComposerContent("sleep-draft", "intake", false))
    expect(result.current).toBe(false)
    unmount()
  })
})
