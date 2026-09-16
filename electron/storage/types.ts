export type AuthMethod = "password" | "privateKey" | "agent"

export type HostPlatform = "ubuntu" | "debian" | "linux"

export type HostCharset = "utf-8" | "gb18030" | "iso-8859-1"

export type HostThemeColor = "rocker" | "amber" | "ocean" | "slate"

export type HostEnvironment = "production" | "staging" | "development" | "personal"

export type CredentialKind = "password" | "passphrase"

export interface HostProfile {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  platform?: HostPlatform
  identityFile?: string
  group?: string
  publicKeyEnabled?: boolean
  snippetsEnabled?: boolean
  snippetCollection?: string
  charset?: HostCharset
  themeColor?: HostThemeColor
  environment?: HostEnvironment
  tags?: string[]
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

export type ForwardingLocalAddress = "127.0.0.1" | "::1" | "0.0.0.0"

export interface ForwardingProfile {
  id: string
  hostId: string
  name: string
  description?: string
  localAddress: ForwardingLocalAddress
  localPort: number
  remoteAddress: string
  remotePort: number
  autoStart: boolean
  createdAt: string
  updatedAt: string
}

export interface StoredForwardingDocument {
  version: 1
  profiles: ForwardingProfile[]
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
