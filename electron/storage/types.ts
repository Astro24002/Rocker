export type AuthMethod = "password" | "privateKey" | "agent"

export type CredentialKind = "password" | "passphrase"

export interface HostProfile {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  identityFile?: string
  group?: string
  favorite: boolean
  notes: string
}

export interface StoredHostDocument {
  hosts: HostProfile[]
}

export interface ConnectionHistoryItem {
  id: string
  hostId: string
  connectedAt: string
  durationMs: number
  outcome: "connected" | "failed" | "disconnected"
}

export type StoredTerminalLayout =
  | { kind: "leaf"; sessionId: string }
  | {
      kind: "split"
      direction: "horizontal"
      ratio: number
      first: StoredTerminalLayout
      second: StoredTerminalLayout
    }

export interface StoredWorkspaceSession {
  sessionId: string
  hostId: string
  label: string
  cols: number
  rows: number
}

export interface StoredWorkspaceWindow {
  workspaceId: string
  bounds?: { x: number; y: number; width: number; height: number }
  maximized: boolean
  activeSessionId?: string
  sessions: StoredWorkspaceSession[]
  layout?: StoredTerminalLayout
}

export interface StoredWorkspaceDocument {
  version: 1
  windows: StoredWorkspaceWindow[]
}

export interface AppSettings {
  locale: "en" | "zh-CN"
  sidebarWidth: number
  terminalFont: string
  terminalFontSize: number
  scrollback: 1000 | 5000 | 10000 | 25000 | 50000
  cursorStyle: "block" | "underline" | "bar"
  cursorBlink: boolean
  terminalBell: boolean
  connectionTimeout: number
  autoReconnect: boolean
  reconnectMode: "limited" | "continuous"
  restorePreviousWorkspace: boolean
  confirmMultilinePaste: boolean
  bindAddress: "127.0.0.1" | "::1" | "0.0.0.0"
}
