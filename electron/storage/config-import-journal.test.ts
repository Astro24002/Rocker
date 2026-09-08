import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ConfigImportJournalStore } from "./config-import-journal"
import type { ConfigImportTarget } from "./config-bundle"
import type { AppSettings, HostProfile } from "./types"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("ConfigImportJournalStore", () => {
  it("restores a pending import only when its imported values are still present", async () => {
    const directory = await temporaryDirectory()
    const journal = new ConfigImportJournalStore(join(directory, "config-import.json"))
    const target = createTarget({
      hosts: [importedHost()],
      settings: importedSettings(),
      hostKeys: new Map([["server.example:22", "new-fingerprint"]])
    })
    await journal.begin({
      version: 1,
      state: "pending",
      hosts: [{ kind: "restore-replaced", expected: importedHost(), restore: localHost() }],
      hostKeys: [{ kind: "restore-replaced", host: "server.example", port: 22, expected: "new-fingerprint", restore: "old-fingerprint" }],
      settings: { expected: importedSettings(), restore: localSettings() }
    })

    await expect(journal.recover(target)).resolves.toBeUndefined()
    expect(target.hosts[0]).toMatchObject({ name: "Local", host: "old.example" })
    expect(target.settings).toEqual(localSettings())
    expect(target.hostKeys.get("server.example:22")).toBe("old-fingerprint")
  })

  it("marks completed imports so a later launch never rolls them back", async () => {
    const directory = await temporaryDirectory()
    const journal = new ConfigImportJournalStore(join(directory, "config-import.json"))
    const target = createTarget({ hosts: [importedHost()] })
    await journal.begin({
      version: 1,
      state: "pending",
      hosts: [{ kind: "restore-replaced", expected: importedHost(), restore: localHost() }],
      hostKeys: []
    })
    await journal.commit()

    await expect(journal.recover(target)).resolves.toBeUndefined()
    expect(target.hosts[0]).toMatchObject({ name: "Imported", host: "server.example" })
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rocker-import-journal-"))
  directories.push(directory)
  return directory
}

function createTarget(input: Partial<{ hosts: HostProfile[]; settings: AppSettings; hostKeys: Map<string, string> }> = {}): ConfigImportTarget & {
  hosts: HostProfile[]
  settings: AppSettings
  hostKeys: Map<string, string>
} {
  const hosts = input.hosts ?? [localHost()]
  let settings = input.settings ?? localSettings()
  const hostKeys = input.hostKeys ?? new Map<string, string>()
  return {
    hosts,
    get settings() { return { ...settings } },
    hostKeys,
    listHosts: async () => hosts.map((host) => ({ ...host })),
    saveHost: async (profile) => {
      const index = hosts.findIndex((host) => host.id === profile.id)
      if (index === -1) hosts.push({ ...profile })
      else hosts[index] = { ...profile }
    },
    removeHost: async (id) => {
      const index = hosts.findIndex((host) => host.id === id)
      if (index !== -1) hosts.splice(index, 1)
    },
    getSettings: async () => ({ ...settings }),
    updateSettings: async (next) => { settings = { ...next } },
    getHostKey: async (host, port) => hostKeys.get(`${host}:${port}`),
    trustHostKey: async (host, port, fingerprint) => { hostKeys.set(`${host}:${port}`, fingerprint) },
    replaceHostKey: async (host, port, expected, replacement) => {
      if (hostKeys.get(`${host}:${port}`) !== expected) throw new Error("unexpected Host Key")
      hostKeys.set(`${host}:${port}`, replacement)
    },
    removeHostKey: async (host, port, expected) => {
      if (hostKeys.get(`${host}:${port}`) !== expected) throw new Error("unexpected Host Key")
      hostKeys.delete(`${host}:${port}`)
    },
    assertCredentialsWritable: async () => undefined,
    importCredentials: async () => ({ imported: [], skippedExisting: [] })
  }
}

function localHost(): HostProfile {
  return { id: "host-a", name: "Local", host: "old.example", port: 22, username: "root", authMethod: "password", favorite: false, notes: "" }
}

function importedHost(): HostProfile {
  return { id: "host-a", name: "Imported", host: "server.example", port: 22, username: "root", authMethod: "password", favorite: false, notes: "" }
}

function localSettings(): AppSettings {
  return { locale: "en", sidebarWidth: 220, terminalFont: "JetBrains Mono", terminalFontSize: 13, scrollback: 10000, cursorStyle: "bar", cursorBlink: true, terminalBell: true, connectionTimeout: 15, autoReconnect: true, reconnectMode: "limited", restorePreviousWorkspace: true, confirmMultilinePaste: true, bindAddress: "127.0.0.1" }
}

function importedSettings(): AppSettings {
  return { ...localSettings(), locale: "zh-CN" }
}
