import { describe, expect, it } from "vitest"
import { canSuspendConnection } from "./connection-suspension"

const idle = {
  agentType: "codex",
  sessionId: "original-session",
  status: "connected",
  backgroundOutstanding: 0,
  hasBackgroundTasks: false,
}
describe("idle connection suspension", () => {
  it("allows a known resumable idle session", () => {
    expect(canSuspendConnection(idle)).toBe(true)
    expect(canSuspendConnection({ ...idle, agentType: "claude_code" })).toBe(
      true
    )
  })
  it.each([
    { sessionId: null },
    { agentType: "custom:unknown" },
    { agentType: "cline" },
    { status: "prompting" },
    { status: "connecting" },
    { backgroundOutstanding: 1 },
    { hasBackgroundTasks: true },
    { pendingPermission: {} },
    { pendingQuestion: {} },
    { pendingAskQuestion: {} },
    { pendingPlanApproval: {} },
    { remoteControl: {} },
    { isDelegationChild: true },
    { isViewer: true },
  ])("protects a session with %j", (patch) => {
    expect(canSuspendConnection({ ...idle, ...patch })).toBe(false)
  })
})
