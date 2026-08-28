import { describe, expect, it } from "vitest"
import { sanitizeDiagnosticEvent, sanitizeDiagnosticExport, sanitizeSettingsSnapshot } from "./sanitize"

describe("diagnostic sanitization", () => {
  it("keeps only allow-listed event fields and removes sensitive payloads", () => {
    const result = sanitizeDiagnosticEvent({
      at: "2026-08-28T12:00:00.000Z",
      category: "connection",
      action: "connect",
      state: "connected",
      reason: "network",
      hostId: "host-1",
      connectionId: "connection-1",
      sessionId: "session-1",
      attempt: 2,
      durationMs: 120,
      details: { retryable: true, port: 22, note: "ok" },
      password: "secret",
      passphrase: "secret",
      privateKey: "-----BEGIN PRIVATE KEY-----",
      terminalInput: "rm -rf /",
      terminalOutput: "secret output",
      remoteFileContents: "secret file",
      sshConfig: "Host *",
      fingerprint: "SHA256:secret"
    })

    expect(result).toEqual({
      at: "2026-08-28T12:00:00.000Z",
      category: "connection",
      action: "connect",
      state: "connected",
      reason: "network",
      hostId: "host-1",
      connectionId: "connection-1",
      sessionId: "session-1",
      attempt: 2,
      durationMs: 120,
      details: { retryable: true, port: 22, note: "ok" }
    })
  })

  it("normalizes unknown categories and bounds strings and event count", () => {
    const long = "x".repeat(600)
    const event = sanitizeDiagnosticEvent({ at: long, category: "secret-category", action: long })
    expect(event.category).toBe("unknown")
    expect(event.at).toHaveLength(256)
    expect(event.action).toHaveLength(256)

    const exported = sanitizeDiagnosticExport({
      schemaVersion: 99,
      generatedAt: "now",
      appVersion: "1.0.0",
      platform: "linux",
      arch: "x64",
      events: Array.from({ length: 1100 }, (_, index) => ({ at: String(index), category: "system", action: "tick" })),
      settings: {}
    })
    expect(exported.schemaVersion).toBe(1)
    expect(exported.events).toHaveLength(1000)
  })

  it("redacts fingerprint values even when they appear inside allowed strings", () => {
    const event = sanitizeDiagnosticEvent({
      at: "2026-08-28T12:00:00.000Z",
      category: "connection",
      action: "host-key-check",
      details: { note: "Received SHA256:raw-host-key-fingerprint" }
    })
    const exported = sanitizeDiagnosticExport({
      generatedAt: "2026-08-28T12:00:00.000Z",
      appVersion: "0.3.1",
      platform: "linux",
      arch: "x64",
      events: [],
      settings: {},
      lastError: { category: "connection", message: "Expected SHA256:raw-host-key-fingerprint" }
    })

    expect(event.details).toEqual({ note: "[redacted]" })
    expect(exported.lastError?.message).toBe("[redacted]")
  })

  it("sanitizes settings and last errors using allow-listed fields", () => {
    expect(sanitizeSettingsSnapshot({
      locale: "zh-CN",
      terminalFontSize: 14,
      connectionTimeout: 20,
      autoReconnect: false,
      reconnectMode: "continuous",
      restorePreviousWorkspace: true,
      confirmMultilinePaste: false,
      password: "secret",
      sshConfig: "Host *"
    })).toEqual({
      locale: "zh-CN",
      terminalFontSize: 14,
      connectionTimeout: 20,
      autoReconnect: false,
      reconnectMode: "continuous",
      restorePreviousWorkspace: true,
      confirmMultilinePaste: false
    })

    const result = sanitizeDiagnosticExport({
      generatedAt: "2026-08-28T12:00:00.000Z",
      appVersion: "0.3.1",
      platform: "linux",
      arch: "x64",
      events: [],
      settings: {},
      lastError: { category: "private-key", reason: "password=secret", message: "x".repeat(600) }
    })
    expect(result.lastError).toEqual({ category: "unknown", reason: "unknown", message: "x".repeat(256) })
  })
})
