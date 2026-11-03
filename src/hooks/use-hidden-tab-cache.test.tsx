import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useHiddenTabCache } from "./use-hidden-tab-cache"

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => vi.useRealTimers())
describe("hidden tab cache lifecycle", () => {
  it("expires a hidden view even when no tab interaction follows", () => {
    const ids = ["a"]
    const { result, rerender, unmount } = renderHook(
      ({ visible, enabled }) =>
        useHiddenTabCache(ids, new Set(visible), enabled, 5),
      { initialProps: { visible: ["a"], enabled: true } }
    )
    rerender({ visible: [], enabled: true })
    act(() => vi.advanceTimersByTime(600_000))
    expect(result.current.has("a")).toBe(true)
    rerender({ visible: ["a"], enabled: true })
    expect(result.current.has("a")).toBe(false)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it("keeps all views and stops its timer when folder mode is disabled", () => {
    const ids = ["a", "b"]
    const { result, rerender } = renderHook(
      ({ enabled }) => useHiddenTabCache(ids, new Set(["a"]), enabled, 5),
      { initialProps: { enabled: true } }
    )
    expect(result.current.has("b")).toBe(true)
    rerender({ enabled: false })
    expect(result.current.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
