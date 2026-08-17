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

export interface AppSettings {
  locale: "en" | "zh-CN"
  sidebarWidth: number
  terminalFont: string
  terminalFontSize: number
  connectionTimeout: number
  autoReconnect: boolean
  portScanInterval: number
  bindAddress: "127.0.0.1" | "::1" | "0.0.0.0"
}
