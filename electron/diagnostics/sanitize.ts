import type { TerminalFailureReason } from "../ssh/types"
import type { DiagnosticCategory, DiagnosticEvent, DiagnosticExport, SafeSettingsSnapshot } from "./diagnostic-types"

const MAX_STRING = 256
const MAX_EVENTS = 1000
const categories = new Set<DiagnosticCategory>(["connection", "session", "forwarding", "window", "system"])
const reasons = new Set<TerminalFailureReason>([
  "network", "timeout", "dns", "authentication", "host-key-changed", "host-key-rejected",
  "configuration", "channel-ended", "local-port-in-use", "cancelled", "unknown"
])
const sensitiveKeys = /password|passphrase|private.?key|terminal.?input|terminal.?output|remote.?file|ssh.?config|fingerprint/i
const fingerprintValue = /\b(?:sha256|md5):[a-z0-9+/=:_-]+/i

function bounded(value: unknown): string {
  if (typeof value !== "string") return "unknown"
  const boundedValue = value.slice(0, MAX_STRING)
  return fingerprintValue.test(boundedValue) ? "[redacted]" : boundedValue
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const boundedValue = value.slice(0, MAX_STRING)
  return fingerprintValue.test(boundedValue) ? "[redacted]" : boundedValue
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function category(value: unknown): DiagnosticCategory | "unknown" {
  return typeof value === "string" && categories.has(value as DiagnosticCategory) ? value as DiagnosticCategory : "unknown"
}

function reason(value: unknown): TerminalFailureReason | undefined {
  return typeof value === "string" && reasons.has(value as TerminalFailureReason) ? value as TerminalFailureReason : value === undefined ? undefined : "unknown"
}

function details(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const result: Record<string, string | number | boolean> = {}
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKeys.test(key)) continue
    if (typeof item === "string") result[key.slice(0, MAX_STRING)] = fingerprintValue.test(item) ? "[redacted]" : item.slice(0, MAX_STRING)
    else if (typeof item === "number" && Number.isFinite(item)) result[key.slice(0, MAX_STRING)] = item
    else if (typeof item === "boolean") result[key.slice(0, MAX_STRING)] = item
  }
  return Object.keys(result).length ? result : undefined
}

export function sanitizeDiagnosticEvent(input: unknown): DiagnosticEvent {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {}
  const event: DiagnosticEvent = {
    at: bounded(source.at),
    category: category(source.category),
    action: bounded(source.action)
  }
  const fields = ["state", "hostId", "connectionId", "sessionId"] as const
  for (const field of fields) {
    const value = optionalString(source[field])
    if (value !== undefined) event[field] = value
  }
  const eventReason = reason(source.reason)
  if (eventReason !== undefined) event.reason = eventReason
  const attempt = optionalNumber(source.attempt)
  if (attempt !== undefined) event.attempt = attempt
  const durationMs = optionalNumber(source.durationMs)
  if (durationMs !== undefined) event.durationMs = durationMs
  const eventDetails = details(source.details)
  if (eventDetails) event.details = eventDetails
  return event
}

export function sanitizeSettingsSnapshot(input: unknown): SafeSettingsSnapshot {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {}
  const result: SafeSettingsSnapshot = {}
  if (source.locale === "en" || source.locale === "zh-CN") result.locale = source.locale
  for (const field of ["sidebarWidth", "terminalFontSize", "connectionTimeout"] as const) {
    const value = optionalNumber(source[field]); if (value !== undefined) result[field] = value
  }
  const font = optionalString(source.terminalFont); if (font !== undefined) result.terminalFont = font
  for (const field of ["autoReconnect", "restorePreviousWorkspace", "confirmMultilinePaste"] as const) {
    if (typeof source[field] === "boolean") result[field] = source[field] as boolean
  }
  if (source.reconnectMode === "limited" || source.reconnectMode === "continuous") result.reconnectMode = source.reconnectMode
  if (source.bindAddress === "127.0.0.1" || source.bindAddress === "::1" || source.bindAddress === "0.0.0.0") result.bindAddress = source.bindAddress
  return result
}

export function sanitizeDiagnosticExport(input: unknown): DiagnosticExport {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {}
  const rawEvents = Array.isArray(source.events) ? source.events : []
  const result: DiagnosticExport = {
    schemaVersion: 1,
    generatedAt: bounded(source.generatedAt),
    appVersion: bounded(source.appVersion),
    platform: bounded(source.platform),
    arch: bounded(source.arch),
    events: rawEvents.slice(-MAX_EVENTS).map(sanitizeDiagnosticEvent),
    settings: sanitizeSettingsSnapshot(source.settings)
  }
  if (source.lastError && typeof source.lastError === "object") {
    const error = source.lastError as Record<string, unknown>
    result.lastError = { category: category(error.category), reason: reason(error.reason) ?? "unknown", message: bounded(error.message) }
  }
  return result
}
