import type { ForwardingProfileView, PortStatus } from "../../../electron/ports/types"
import type { TerminalDimensions, TerminalFailureReason, TerminalSessionInfo, TerminalSessionState, TerminalStateEvent } from "../../../electron/ssh/types"
import { removeSessionFromLayout, type TerminalLayout } from "./layout"

export type SessionKind = "ssh" | "sftp" | "pf"

/** Explicit application protocol for PF preview. Never inferred from a port number. */
export type ApplicationProtocol = "http" | "https"

interface WorkspaceSessionBase {
  id: string
  hostId: string
  label: string
  state: TerminalSessionState
}

export interface SshWorkspaceSession extends WorkspaceSessionBase {
  /** Missing kind is the compatibility shape used by pre-unification workspace data. */
  kind?: "ssh"
  channelGeneration: number
  dimensions?: TerminalDimensions
  reason?: TerminalFailureReason
  attempt?: number
  nextRetryAt?: string
  /** Runtime-only activity raised by terminal output received while this session is not visible. */
  hasUnreadActivity?: boolean
}

export interface SftpDirectoryEntry {
  name: string
  path: string
  type: "file" | "directory" | "symlink" | "other"
  size?: number
  modifiedAt?: string
  permissions?: number
  uid?: number
  gid?: number
}

export interface SftpBrowserState {
  path: string
  entries: SftpDirectoryEntry[]
  loading: boolean
  error?: string
}

export interface SftpWorkspaceSession extends WorkspaceSessionBase {
  kind: "sftp"
  browser: SftpBrowserState
  /** Runtime-only count sourced from active SFTP transfer tasks. */
  activeTransferCount?: number
}

export interface PortForwardingWorkspaceSession extends WorkspaceSessionBase {
  kind: "pf"
  /** Stable profile identity. Host-detail PF sessions may not have a rule yet. */
  profileId?: string
  forwardingId?: string
  forwardingStatus: PortStatus
  applicationProtocol?: ApplicationProtocol
}

export type WorkspaceSession = SshWorkspaceSession | SftpWorkspaceSession | PortForwardingWorkspaceSession

export interface TerminalWorkspaceState {
  sessions: WorkspaceSession[]
  activeSessionId?: string
  layout?: TerminalLayout
}

interface OpenSessionBase {
  id: string
  hostId: string
  label: string
}

export type OpenSessionInput = OpenSessionBase & (
  | {
      kind?: "ssh"
      dimensions?: TerminalDimensions
    }
  | {
      kind: "sftp"
      path?: string
    }
  | {
      kind: "pf"
      profileId?: string
      forwardingId?: string
      forwardingStatus?: PortStatus
      applicationProtocol?: ApplicationProtocol
    }
)

export type WorkspaceSessionPatch =
  | {
      kind: "ssh"
      hasUnreadActivity: boolean
    }
  | {
      kind: "sftp"
      state?: TerminalSessionState
      browser?: Partial<SftpBrowserState>
      activeTransferCount?: number
    }
  | {
      kind: "pf"
      profileId?: string
      label?: string
      state?: TerminalSessionState
      forwardingId?: string
      forwardingStatus?: PortStatus
      applicationProtocol?: ApplicationProtocol
    }

export function sessionKind(session: Pick<WorkspaceSession, "kind"> | undefined): SessionKind {
  return session?.kind ?? "ssh"
}

export function isSshSession(session: WorkspaceSession | undefined): session is SshWorkspaceSession {
  return sessionKind(session) === "ssh"
}

export function isSftpSession(session: WorkspaceSession | undefined): session is SftpWorkspaceSession {
  return session?.kind === "sftp"
}

export function isPortForwardingSession(session: WorkspaceSession | undefined): session is PortForwardingWorkspaceSession {
  return session?.kind === "pf"
}

export function createTerminalWorkspaceState(): TerminalWorkspaceState {
  return { sessions: [] }
}

export function openSession(
  state: TerminalWorkspaceState,
  input: OpenSessionInput,
  options?: { activate?: boolean }
): TerminalWorkspaceState {
  const session = createSession(input)
  const activate = options?.activate !== false
  return {
    ...state,
    sessions: [...state.sessions, session],
    activeSessionId: activate ? session.id : state.activeSessionId
  }
}

function createSession(input: OpenSessionInput): WorkspaceSession {
  if (input.kind === "sftp") {
    return {
      id: input.id,
      hostId: input.hostId,
      label: input.label,
      kind: "sftp",
      state: "idle",
      browser: {
        path: input.path ?? "/",
        entries: [],
        loading: false
      }
    }
  }
  if (input.kind === "pf") {
    const forwardingStatus = input.forwardingStatus ?? "stopped"
    return {
      id: input.id,
      hostId: input.hostId,
      label: input.label,
      kind: "pf",
      state: forwardingToSessionState(forwardingStatus),
      ...(input.profileId ? { profileId: input.profileId } : {}),
      forwardingStatus,
      ...(input.forwardingId ? { forwardingId: input.forwardingId } : {}),
      ...(input.applicationProtocol ? { applicationProtocol: input.applicationProtocol } : {})
    }
  }
  return {
    id: input.id,
    hostId: input.hostId,
    label: input.label,
    kind: "ssh",
    state: "idle",
    channelGeneration: 0,
    ...(input.dimensions ? { dimensions: input.dimensions } : {})
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

export function patchSession(
  state: TerminalWorkspaceState,
  sessionId: string,
  patch: WorkspaceSessionPatch
): TerminalWorkspaceState {
  if (!state.sessions.some((session) => session.id === sessionId)) return state
  let changed = false
  const sessions: WorkspaceSession[] = state.sessions.map((session): WorkspaceSession => {
    if (session.id !== sessionId) return session
    if (patch.kind === "ssh" && isSshSession(session)) {
      if (patch.hasUnreadActivity === true) {
        if (session.hasUnreadActivity === true) return session
        changed = true
        return { ...session, hasUnreadActivity: true }
      }
      if (session.hasUnreadActivity !== true) return session
      const clearedSession = { ...session }
      delete clearedSession.hasUnreadActivity
      changed = true
      return clearedSession
    }
    if (patch.kind === "sftp" && isSftpSession(session)) {
      const requestedActiveTransferCount = patch.activeTransferCount === undefined
        ? session.activeTransferCount
        : Math.max(0, patch.activeTransferCount)
      const activeTransferCount = requestedActiveTransferCount === 0 ? undefined : requestedActiveTransferCount
      if (patch.state === undefined && patch.browser === undefined && activeTransferCount === session.activeTransferCount) return session
      changed = true
      const updatedSession: SftpWorkspaceSession = {
        ...session,
        ...(patch.state ? { state: patch.state } : {}),
        browser: patch.browser ? { ...session.browser, ...patch.browser } : session.browser
      }
      if (activeTransferCount === undefined) delete updatedSession.activeTransferCount
      else updatedSession.activeTransferCount = activeTransferCount
      return updatedSession
    }
    if (patch.kind === "pf" && isPortForwardingSession(session)) {
      changed = true
      return { ...session, ...patch, kind: "pf" }
    }
    return session
  })
  return changed ? { ...state, sessions } : state
}

export function applyTerminalState(state: TerminalWorkspaceState, event: TerminalStateEvent): TerminalWorkspaceState {
  return {
    ...state,
    sessions: state.sessions.map((session) => {
      if (session.id !== event.sessionId || !isSshSession(session) || event.channelGeneration < session.channelGeneration) return session
      const updated = {
        ...session,
        channelGeneration: event.channelGeneration,
        state: event.state,
        reason: event.reason,
        attempt: event.attempt,
        nextRetryAt: event.nextRetryAt
      }
      if (event.reason === undefined) delete updated.reason
      if (event.attempt === undefined) delete updated.attempt
      if (event.nextRetryAt === undefined) delete updated.nextRetryAt
      return updated
    })
  }
}

export function attachChannel(state: TerminalWorkspaceState, info: TerminalSessionInfo): TerminalWorkspaceState {
  return {
    ...state,
    sessions: state.sessions.map((session) => session.id === info.sessionId && isSshSession(session)
      ? { ...session, channelGeneration: info.channelGeneration, state: info.state }
      : session)
  }
}

export function forwardingToSessionState(status: PortStatus): TerminalSessionState {
  if (status === "starting" || status === "stopping") return "connecting"
  if (status === "forwarding") return "connected"
  if (status === "error") return "error"
  if (status === "suspended" || status === "stopped") return "disconnected"
  return "idle"
}

export function synchronizePortForwardingSessions(
  state: TerminalWorkspaceState,
  rows: readonly ForwardingProfileView[]
): TerminalWorkspaceState {
  return rows.reduce((current, { profile, runtime }) => {
    const existing = current.sessions.find((session) => isPortForwardingSession(session) && session.profileId === profile.id)
    const forwardingStatus = runtime?.status ?? "stopped"
    if (isPortForwardingSession(existing)) {
      return patchSession(current, existing.id, {
        kind: "pf",
        label: profile.name,
        forwardingId: runtime?.id,
        forwardingStatus,
        state: forwardingToSessionState(forwardingStatus)
      })
    }
    return current
  }, state)
}
