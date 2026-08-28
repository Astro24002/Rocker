import { readFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { AppSettings } from "../storage/types"
import { diagnosticFileName, writeDiagnosticExport } from "./diagnostic-export"

const directories: string[] = []
const settings: AppSettings = {
  locale: "en",
  sidebarWidth: 220,
  terminalFont: "JetBrains Mono",
  terminalFontSize: 13,
  connectionTimeout: 15,
  autoReconnect: true,
  reconnectMode: "limited",
  restorePreviousWorkspace: true,
  confirmMultilinePaste: true,
  bindAddress: "127.0.0.1"
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("diagnostic export", () => {
  it("writes a sanitized versioned document without requiring Electron", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-diagnostic-export-"))
    directories.push(directory)
    const path = join(directory, "diagnostics.json")

    await writeDiagnosticExport(path, {
      logger: { snapshot: () => [{ at: "2026-08-28T12:00:00.000Z", category: "session", action: "connected", password: "secret" }] },
      settings,
      now: () => new Date("2026-08-28T12:01:00.000Z")
    })

    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-08-28T12:01:00.000Z",
      appVersion: "unknown",
      platform: "unknown",
      arch: "unknown",
      events: [{ action: "connected" }]
    })
  })

  it("uses a stable local filename format", () => {
    expect(diagnosticFileName(new Date("2026-08-28T12:01:02.000Z"))).toBe("rocker-diagnostics-20260828-120102.json")
  })
})
