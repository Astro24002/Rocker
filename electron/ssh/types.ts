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
  | "network" | "timeout" | "dns" | "authentication"
  | "host-key-changed" | "host-key-rejected" | "configuration"
  | "channel-ended" | "local-port-in-use" | "cancelled" | "unknown"

export interface TerminalDimensions { cols: number; rows: number }

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
  ownerWebContentsId: number
  event: TerminalSessionEvent
}

export interface TerminalSessionInfo {
  sessionId: string
  hostId: string
  channelGeneration: number
  state: TerminalSessionState
}

export interface SessionCommandExecutor {
  exec(sessionId: string, command: string): Promise<string>
}

export interface ConnectionCommandExecutor {
  execOnConnection(connectionId: string, command: string): Promise<string>
}
