import type { TerminalDimensions, TerminalFailureReason, TerminalSessionInfo, TerminalSessionState, TerminalStateEvent } from "../../../electron/ssh/types"
import { removeSessionFromLayout, type TerminalLayout } from "./layout"

export interface WorkspaceSession {
  id: string
  hostId: string
  label: string
  state: TerminalSessionState
  channelGeneration: number
  dimensions?: TerminalDimensions
  reason?: TerminalFailureReason
  attempt?: number
  nextRetryAt?: string
}

export interface TerminalWorkspaceState {
  sessions: WorkspaceSession[]
  activeSessionId?: string
  layout?: TerminalLayout
}

export function createTerminalWorkspaceState(): TerminalWorkspaceState {
  return { sessions: [] }
}

export function openSession(
  state: TerminalWorkspaceState,
  input: Pick<WorkspaceSession, "id" | "hostId" | "label" | "dimensions">
): TerminalWorkspaceState {
  const session: WorkspaceSession = {
    ...input,
    state: "idle",
    channelGeneration: 0
  }
  return {
    ...state,
    sessions: [...state.sessions, session],
    activeSessionId: session.id
  }
}

export function closeSession(state: TerminalWorkspaceState, sessionId: string): TerminalWorkspaceState {
  const index = state.sessions.findIndex((session) => session.id === sessionId)
  if (index === -1) return state
  const sessions = state.sessions.filter((session) => session.id !== sessionId)
  const activeSessionId = state.activeSessionId === sessionId
    ? sessions[Math.max(0, Math.min(index - 1, sessions.length - 1))]?.id
    : state.activeSessionId
  return {
    sessions,
    activeSessionId,
    layout: state.layout ? removeSessionFromLayout(state.layout, sessionId) : undefined
  }
}

export function activateSession(state: TerminalWorkspaceState, sessionId: string): TerminalWorkspaceState {
  return state.sessions.some((session) => session.id === sessionId)
    ? { ...state, activeSessionId: sessionId }
    : state
}

export function applyTerminalState(state: TerminalWorkspaceState, event: TerminalStateEvent): TerminalWorkspaceState {
  return {
    ...state,
    sessions: state.sessions.map((session) => session.id === event.sessionId
      ? {
          ...session,
          channelGeneration: event.channelGeneration,
          state: event.state,
          reason: event.reason,
          attempt: event.attempt,
          nextRetryAt: event.nextRetryAt
        }
      : session)
  }
}

export function attachChannel(state: TerminalWorkspaceState, info: TerminalSessionInfo): TerminalWorkspaceState {
  return {
    ...state,
    sessions: state.sessions.map((session) => session.id === info.sessionId
      ? { ...session, channelGeneration: info.channelGeneration, state: info.state }
      : session)
  }
}
