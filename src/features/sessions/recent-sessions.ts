export type RecentSessionState = Record<string, number>

export type RecentSessionReference = string | { id: string }

export function recordSessionFocus(state: RecentSessionState, sessionId: string, focusedAt = Date.now()): RecentSessionState {
  return { ...state, [sessionId]: focusedAt }
}

export function removeRecentSession(state: RecentSessionState, sessionId: string): RecentSessionState {
  if (!(sessionId in state)) return state
  const next = { ...state }
  delete next[sessionId]
  return next
}

export function recentSessionIds(state: RecentSessionState, liveSessions: Iterable<RecentSessionReference> = Object.keys(state)): string[] {
  const liveIds = new Set<string>()
  for (const session of liveSessions) liveIds.add(typeof session === "string" ? session : session.id)

  return Object.entries(state)
    .filter(([sessionId]) => liveIds.has(sessionId))
    .sort(([leftId, leftFocusedAt], [rightId, rightFocusedAt]) => rightFocusedAt - leftFocusedAt || leftId.localeCompare(rightId))
    .map(([sessionId]) => sessionId)
}
