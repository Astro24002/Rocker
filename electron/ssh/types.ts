import type { RuntimeOwner } from "../runtime/owner"

export type ConnectionFailureReason =
  | "network" | "timeout" | "dns" | "authentication"
  | "host-key-changed" | "host-key-rejected"
  | "configuration" | "cancelled"

export class ConnectionFailureError extends Error {
  public constructor(
    message: string,
    public readonly reason: ConnectionFailureReason,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = "ConnectionFailureError"
  }
}

export type TerminalSessionState =
  | "idle"
  | "restoring"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error"
  | "closing"

export type TerminalFailureReason =
  | ConnectionFailureReason
  | "channel-ended" | "local-port-in-use" | "unknown"

export interface TerminalDimensions { cols: number; rows: number }

export interface RemoteExecOptions {
  timeoutMs: number
  maxOutputBytes: number
  signal?: AbortSignal
}

export type RemoteOperationFailureReason = "timeout" | "cancelled" | "output-limit" | "channel-error"

export class RemoteOperationError extends Error {
  public constructor(message: string, public readonly reason: RemoteOperationFailureReason) {
    super(message)
    this.name = "RemoteOperationError"
  }
}

export interface TerminalOutputPacket {
  sessionId: string
  channelGeneration: number
  sequence: number
  bytes: Uint8Array
}

export interface TerminalStateEvent {
  kind: "state"
  sessionId: string
  connectionId?: string
  channelGeneration: number
  state: TerminalSessionState
  reason?: TerminalFailureReason
  attempt?: number
  nextRetryAt?: string
  notice?: "reconnected" | "restored-new-shell"
}

export type TerminalSessionEvent =
  | { kind: "output"; packet: TerminalOutputPacket }
  | TerminalStateEvent

export interface OwnedTerminalSessionEvent {
  owner: RuntimeOwner
  event: TerminalSessionEvent
}

export interface TerminalSessionInfo {
  sessionId: string
  hostId: string
  channelGeneration: number
  state: TerminalSessionState
}

export interface SessionCommandExecutor {
  exec(sessionId: string, command: string, options?: RemoteExecOptions): Promise<string>
}

export interface ConnectionCommandExecutor {
  execOnConnection(connectionId: string, command: string, options?: RemoteExecOptions): Promise<string>
}
