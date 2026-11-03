import { describe, expect, it } from "vitest"
import { HiddenTabCache } from "./hidden-tab-cache"

describe("hidden tab retention", () => {
  it("keeps a visible tab even after a long reading pause", () => {
    const cache = new HiddenTabCache()
    expect([...cache.update(["a"], new Set(["a"]), 0, 600_000, 5)]).toEqual([])
    expect([
      ...cache.update(["a"], new Set(["a"]), 900_000, 600_000, 5),
    ]).toEqual([])
  })
  it("expires ten minutes after leaving a tab and wakes immediately", () => {
    const cache = new HiddenTabCache()
    cache.update(["a"], new Set(["a"]), 0, 600_000, 5)
    cache.update(["a"], new Set(), 1_000, 600_000, 5)
    expect([...cache.update(["a"], new Set(), 600_999, 600_000, 5)]).toEqual([])
    expect([...cache.update(["a"], new Set(), 601_000, 600_000, 5)]).toEqual([
      "a",
    ])
    expect([
      ...cache.update(["a"], new Set(["a"]), 602_000, 600_000, 5),
    ]).toEqual([])
    cache.update(["a"], new Set(), 603_000, 600_000, 5)
    expect([...cache.update(["a"], new Set(), 604_000, 600_000, 5)]).toEqual([])
  })
  it("keeps only five recent hidden views during rapid navigation", () => {
    const cache = new HiddenTabCache()
    const ids = ["a", "b", "c", "d", "e", "f", "g"]
    ids.forEach((id, i) =>
      cache.update(ids, new Set([id]), i * 1_000, 600_000, 5)
    )
    const sleeping = cache.update(ids, new Set(["g"]), 7_000, 600_000, 5)
    expect([...sleeping]).toEqual(["a"])
  })
  it("does not populate heavy caches for never-viewed restored tabs", () => {
    const cache = new HiddenTabCache()
    expect([
      ...cache.update(["a", "b", "c"], new Set(["a"]), 0, 600_000, 5),
    ]).toEqual(["b", "c"])
  })
  it("forgets closed tabs so reopening cannot inherit an expired timer", () => {
    const cache = new HiddenTabCache()
    cache.update(["a"], new Set(["a"]), 0, 600_000, 5)
    cache.update([], new Set(), 1_000, 600_000, 5)
    expect([
      ...cache.update(["a"], new Set(["a"]), 900_000, 600_000, 5),
    ]).toEqual([])
  })
})
