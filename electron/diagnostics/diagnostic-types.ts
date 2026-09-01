import type { RemoteOperationFailureReason, TerminalFailureReason } from "../ssh/types"

export type StorageFailureReason = "corrupt" | "permission" | "unavailable" | "recovery-failed"

export type DiagnosticReason = TerminalFailureReason | StorageFailureReason | RemoteOperationFailureReason

export type DiagnosticCategory = "connection" | "session" | "forwarding" | "window" | "storage" | "monitoring" | "system"

export type DiagnosticRuntimeMetadata = {
  buildChannel: "development" | "release"
  runtimeMode: "development" | "packaged"
}

export type SafeSettingsSnapshot = {
  locale?: "en" | "zh-CN"
  sidebarWidth?: number
  terminalFont?: string
  terminalFontSize?: number
  connectionTimeout?: number
  autoReconnect?: boolean
  reconnectMode?: "limited" | "continuous"
  restorePreviousWorkspace?: boolean
  confirmMultilinePaste?: boolean
  bindAddress?: "127.0.0.1" | "::1" | "0.0.0.0"
}

export type DiagnosticEvent = {
  at: string
  category: DiagnosticCategory | "unknown"
  action: string
  state?: string
  reason?: DiagnosticReason
  hostId?: string
  connectionId?: string
  sessionId?: string
  attempt?: number
  durationMs?: number
  details?: Record<string, string | number | boolean>
}

export type DiagnosticExport = {
  schemaVersion: 1
  generatedAt: string
  appVersion: string
  platform: string
  arch: string
  buildChannel: DiagnosticRuntimeMetadata["buildChannel"]
  runtimeMode: DiagnosticRuntimeMetadata["runtimeMode"]
  events: DiagnosticEvent[]
  settings: SafeSettingsSnapshot
  lastError?: { category: string; reason?: string; message: string }
}
