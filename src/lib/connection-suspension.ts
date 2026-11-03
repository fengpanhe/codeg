export const HIDDEN_CONNECTION_IDLE_MS = 5 * 60_000

interface SuspendableConnection {
  agentType: string
  sessionId: string | null
  status: string | null
  backgroundOutstanding: number
  hasBackgroundTasks: boolean
  pendingPermission?: unknown
  pendingQuestion?: unknown
  pendingAskQuestion?: unknown
  pendingPlanApproval?: unknown
  remoteControl?: unknown
  isDelegationChild?: boolean
  isViewer?: boolean
}

/** Generic resume capabilities are not exposed to the client yet. */
export function canSuspendConnection(conn: SuspendableConnection): boolean {
  return (
    (conn.agentType === "claude_code" || conn.agentType === "codex") &&
    Boolean(conn.sessionId) &&
    conn.status === "connected" &&
    conn.backgroundOutstanding === 0 &&
    !conn.hasBackgroundTasks &&
    !conn.pendingPermission &&
    !conn.pendingQuestion &&
    !conn.pendingAskQuestion &&
    !conn.pendingPlanApproval &&
    !conn.remoteControl &&
    !conn.isDelegationChild &&
    !conn.isViewer
  )
}
