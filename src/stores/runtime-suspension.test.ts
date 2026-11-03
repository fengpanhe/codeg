import { renderHook, waitFor } from "@testing-library/react"
import { useConversationDetail } from "@/hooks/use-conversation-detail"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DbConversationDetail, MessageTurn } from "@/lib/types"
import {
  resetConversationRuntimeStore,
  useConversationRuntimeStore,
} from "./conversation-runtime-store"
import { getFolderConversation } from "@/lib/api"

vi.mock("@/lib/api", () => ({
  getFolderConversation: vi.fn(),
  getFolderConversationTurns: vi.fn(),
}))
const turn: MessageTurn = {
  id: "local",
  role: "assistant",
  blocks: [{ type: "text", text: "completed" }],
  timestamp: "2026-11-03T00:00:00Z",
}
const detail = {
  summary: { id: 42, external_id: "session-original" },
  turns: [turn],
  turns_offset: 10,
  turns_total: 11,
  prefix_hash: "abc",
} as DbConversationDetail

function seed(patch = {}) {
  const store = useConversationRuntimeStore.getState()
  store.actions.setExternalId(42, "session-original")
  const session = useConversationRuntimeStore
    .getState()
    .byConversationId.get(42)!
  useConversationRuntimeStore.setState({
    byConversationId: new Map([[42, { ...session, detail, ...patch }]]),
  })
}

beforeEach(() => {
  resetConversationRuntimeStore()
  vi.clearAllMocks()
})
describe("sleeping conversation history", () => {
  it("drops persisted history while retaining identity and completed local turns", () => {
    seed({ localTurns: [turn] })
    useConversationRuntimeStore.getState().actions.unloadDetail(42)
    const session = useConversationRuntimeStore
      .getState()
      .byConversationId.get(42)!
    expect(session.detail).toBeNull()
    expect(session.externalId).toBe("session-original")
    expect(session.localTurns).toEqual([turn])
    expect(session.suspendedDetailOffset).toBe(10)
  })
  it.each([
    { syncState: "awaiting_persist" },
    { optimisticTurns: [turn] },
    { detailLoading: true },
    { liveMessage: { content: [], startedAt: 1 } },
  ])("retains history during %j", (patch) => {
    seed(patch)
    useConversationRuntimeStore.getState().actions.unloadDetail(42)
    expect(
      useConversationRuntimeStore.getState().byConversationId.get(42)!.detail
    ).toBe(detail)
  })
  it("loads the saved history window on waking without erasing local turns", async () => {
    seed({ localTurns: [turn] })
    vi.mocked(getFolderConversation).mockResolvedValue(detail)
    const actions = useConversationRuntimeStore.getState().actions
    actions.unloadDetail(42)
    actions.fetchDetail(42)
    await waitFor(() => {
      expect(
        useConversationRuntimeStore.getState().byConversationId.get(42)!.detail
      ).toEqual(detail)
    })
    expect(getFolderConversation).toHaveBeenCalledWith(42, { fromIndex: 10 })
    expect(
      useConversationRuntimeStore.getState().byConversationId.get(42)!
        .localTurns
    ).toEqual([turn])
  })
})

it("wakes a draft-origin runtime using its bound database conversation", async () => {
  const actions = useConversationRuntimeStore.getState().actions
  actions.setExternalId(-42, "session-original")
  actions.setDbConversationId(-42, 42)
  const session = useConversationRuntimeStore
    .getState()
    .byConversationId.get(-42)!
  useConversationRuntimeStore.setState({
    byConversationId: new Map([
      [-42, { ...session, detail, localTurns: [turn] }],
    ]),
  })
  actions.unloadDetail(-42)
  vi.mocked(getFolderConversation).mockResolvedValue(detail)
  renderHook(() => useConversationDetail(-42))
  await waitFor(() =>
    expect(getFolderConversation).toHaveBeenCalledWith(42, { fromIndex: 10 })
  )
})

it("falls back to the latest history window if a sleeping transcript was compacted", async () => {
  seed()
  const shortened = {
    ...detail,
    turns: [],
    turns_offset: 3,
    turns_total: 3,
    prefix_hash: "rewritten",
  }
  const latest = {
    ...detail,
    turns_offset: 0,
    turns_total: 1,
    prefix_hash: "new-prefix",
  }
  vi.mocked(getFolderConversation)
    .mockResolvedValueOnce(shortened)
    .mockResolvedValueOnce(latest)
  const actions = useConversationRuntimeStore.getState().actions
  actions.unloadDetail(42)
  actions.fetchDetail(42)
  await waitFor(() =>
    expect(
      useConversationRuntimeStore.getState().byConversationId.get(42)!.detail
        ?.turns
    ).toEqual([turn])
  )
  expect(getFolderConversation).toHaveBeenLastCalledWith(42, { tailTurns: 120 })
})

it("retains history for a second reader even when that reader fetches manually", async () => {
  seed()
  const reader = renderHook(() => useConversationDetail(42, { enabled: false }))
  useConversationRuntimeStore.getState().actions.unloadDetail(42)
  expect(
    useConversationRuntimeStore.getState().byConversationId.get(42)!.detail
  ).toBe(detail)
  reader.unmount()
  await waitFor(() =>
    expect(
      useConversationRuntimeStore.getState().byConversationId.get(42)!.detail
    ).toBeNull()
  )
})

it("keeps shared history until the final reader releases it", async () => {
  seed()
  const a = renderHook(() => useConversationDetail(42, { enabled: false }))
  const b = renderHook(() => useConversationDetail(42, { enabled: false }))
  useConversationRuntimeStore.getState().actions.unloadDetail(42)
  a.unmount()
  await Promise.resolve()
  expect(
    useConversationRuntimeStore.getState().byConversationId.get(42)!.detail
  ).toBe(detail)
  b.unmount()
  await waitFor(() =>
    expect(
      useConversationRuntimeStore.getState().byConversationId.get(42)!.detail
    ).toBeNull()
  )
})
