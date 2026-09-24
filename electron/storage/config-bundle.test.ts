import { describe, expect, it, vi } from "vitest"
import {
  ConfigBundleService,
  exportEncryptedBundle,
  exportTemplate,
  hostKeysForHosts,
  inspectBundle,
  type ConfigImportTarget,
  type ExportSnapshot
} from "./config-bundle"
import type { AppSettings, HostProfile } from "./types"
import type { ForwardingProfile } from "./types"

const settings: AppSettings = {
  locale: "en",
  sidebarWidth: 220,
  terminalFont: "JetBrains Mono",
  terminalFontSize: 13,
  scrollback: 10000,
  cursorStyle: "bar",
  cursorBlink: true,
  terminalBell: true,
  connectionTimeout: 15,
  autoReconnect: true,
  reconnectMode: "limited",
  restorePreviousWorkspace: true,
  confirmMultilinePaste: true,
  bindAddress: "127.0.0.1"
}

describe("configuration bundles", () => {
  it("exports a non-sensitive template without credentials or host keys", () => {
    const template = exportTemplate(snapshot())

    expect(template).toMatchObject({ format: "rocker-config", version: 1, containsSecrets: false })
    expect(JSON.stringify(template)).not.toContain("password-value")
    expect(JSON.stringify(template)).not.toContain("host-fingerprint")
  })

  it("encrypts migration payloads and rejects a wrong password", async () => {
    const bundle = await exportEncryptedBundle(snapshot(), "migration password")
    const serialized = new TextDecoder().decode(bundle)

    expect(serialized).not.toContain("password-value")
    await expect(inspectBundle(bundle, "migration password")).resolves.toMatchObject({
      encrypted: true,
      requiresPassword: false,
      hosts: { total: 1 },
      credentials: { total: 1 }
    })
    await expect(inspectBundle(bundle, "wrong password")).rejects.toThrow("Bundle could not be opened")
  })

  it("rejects malformed bundles before inspecting or mutating stores", async () => {
    await expect(inspectBundle(new TextEncoder().encode('{"format":"rocker-config"}'))).rejects.toThrow("Bundle is invalid")
  })

  it("rejects duplicate imported host identifiers", async () => {
    const template = exportTemplate(snapshot())
    const duplicate = {
      ...template,
      hosts: [template.hosts[0], { ...template.hosts[0], name: "Duplicate" }]
    }

    await expect(inspectBundle(new TextEncoder().encode(JSON.stringify(duplicate)))).rejects.toThrow("Configuration hosts are invalid")
  })

  it("rejects Host Keys that do not belong to an exported host endpoint", async () => {
    const invalid = {
      ...snapshot(),
      hostKeys: [{ host: "unrelated.example", port: 22, fingerprint: "unrelated-fingerprint" }]
    }

    await expect(exportEncryptedBundle(invalid, "migration password")).rejects.toThrow("Configuration Host Keys are invalid")
  })

  it("filters stored Host Keys to endpoints represented in an encrypted migration", () => {
    expect(hostKeysForHosts(snapshot().hosts, [
      { host: "server.example", port: 22, fingerprint: "host-fingerprint" },
      { host: "unrelated.example", port: 2222, fingerprint: "unrelated-fingerprint" }
    ])).toEqual([
      { host: "server.example", port: 22, fingerprint: "host-fingerprint" }
    ])
  })

  it("requires explicit resolutions for host and Host Key conflicts", async () => {
    const target = createTarget()
    const service = new ConfigBundleService(target)
    const bundle = await exportEncryptedBundle(snapshot(), "migration password")

    await expect(service.preview(bundle, "migration password")).resolves.toMatchObject({
      hosts: { conflicts: 1 },
      hostKeys: { conflicts: 1 },
      credentials: { total: 1 },
      hostConflicts: [{ id: "host-a", name: "Imported", host: "server.example", port: 22, username: "root" }],
      hostKeyConflicts: [{
        id: "server.example:22",
        host: "server.example",
        port: 22,
        localFingerprint: "old-fingerprint",
        importedFingerprint: "host-fingerprint"
      }]
    })
    await expect(service.import(bundle, "migration password", { importCredentials: true })).rejects.toThrow("Import conflict requires resolution")
    expect(target.hosts[0].name).toBe("Existing")
    expect(target.hostKeys.get("server.example:22")).toBe("old-fingerprint")

    await expect(service.import(bundle, "migration password", {
      importCredentials: true,
      importHostKeys: true,
      hosts: { "host-a": "use-imported" },
      hostKeys: { "server.example:22": "replace-host-key" }
    })).resolves.toMatchObject({ replacedHosts: 1, replacedHostKeys: 1, skippedHostKeys: 0, importedCredentials: 1, skippedCredentials: 0 })
    expect(target.hosts[0].name).toBe("Imported")
    expect(target.hostKeys.get("server.example:22")).toBe("host-fingerprint")
    expect(target.credentials.get("host-a:password")).toBe("password-value")
  })

  it("assigns unique names when importing Hosts that collide locally or in the same bundle", async () => {
    const target = createTarget()
    target.hosts[0]!.name = "G11"
    const imported = snapshot()
    imported.hosts = [
      { ...imported.hosts[0]!, id: "host-b", name: "G11", host: "one.example" },
      { ...imported.hosts[0]!, id: "host-c", name: "g11", host: "two.example" }
    ]
    imported.hostKeys = []
    imported.credentials = []
    imported.profiles = []
    const bundle = new TextEncoder().encode(JSON.stringify(exportTemplate(imported)))
    const service = new ConfigBundleService(target)

    await expect(service.import(bundle, undefined, {})).resolves.toMatchObject({ importedHosts: 2 })
    expect(target.hosts.map((host) => host.name)).toEqual(["G11", "G11 (2)", "g11 (3)"])
  })

  it("rolls back earlier store changes when a later import operation fails", async () => {
    const target = createTarget()
    const service = new ConfigBundleService(target)
    const bundle = await exportEncryptedBundle(snapshot(), "migration password")
    target.replaceHostKey = async () => { throw new Error("disk failure") }

    await expect(service.import(bundle, "migration password", {
      applySettings: true,
      importHostKeys: true,
      hosts: { "host-a": "use-imported" },
      hostKeys: { "server.example:22": "replace-host-key" }
    })).rejects.toThrow("Configuration import could not be completed")

    expect(target.hosts[0]).toMatchObject({ name: "Existing", host: "old.example" })
    expect(target.settings).toEqual(settings)
    expect(target.hostKeys.get("server.example:22")).toBe("old-fingerprint")
  })

  it("never replaces an existing local credential during migration", async () => {
    const target = createTarget()
    target.credentials.set("host-a:password", "local-password")
    const service = new ConfigBundleService(target)
    const bundle = await exportEncryptedBundle(snapshot(), "migration password")

    await expect(service.import(bundle, "migration password", {
      importCredentials: true,
      hosts: { "host-a": "use-imported" }
    })).resolves.toMatchObject({ importedCredentials: 0, skippedCredentials: 1 })

    expect(target.credentials.get("host-a:password")).toBe("local-password")
  })

  it("round-trips forwarding profiles in templates and encrypted bundles", async () => {
    const template = exportTemplate(snapshot())
    expect(template.profiles).toEqual([forwardingProfile()])

    const bundle = await exportEncryptedBundle(snapshot(), "migration password")
    await expect(inspectBundle(bundle, "migration password")).resolves.toMatchObject({
      forwardings: { total: 1 }
    })
  })

  it("previews forwarding conflicts and imports profiles without starting runtimes", async () => {
    const target = createTarget()
    target.forwardingProfiles = [{ ...forwardingProfile(), remotePort: 9090 }]
    const replace = vi.spyOn(target, "replaceForwardingProfiles")
    const service = new ConfigBundleService(target)
    const bundle = await exportEncryptedBundle(snapshot(), "migration password")

    await expect(service.preview(bundle, "migration password")).resolves.toMatchObject({
      forwardings: { total: 1, conflicts: 1 }
    })
    await expect(service.import(bundle, "migration password", {
      hosts: { "host-a": "use-imported" },
      forwardings: { "forwarding-a": "use-imported" }
    })).resolves.toMatchObject({ importedForwardings: 0, replacedForwardings: 1 })
    expect(replace).toHaveBeenCalledOnce()
    expect(target.forwardingProfiles[0]).toMatchObject({ remotePort: 8080 })
  })
})

function snapshot(): ExportSnapshot {
  return {
    createdAt: "2026-09-08T00:00:00.000Z",
    hosts: [{
      id: "host-a",
      name: "Imported",
      host: "server.example",
      port: 22,
      username: "root",
      authMethod: "password",
      favorite: false,
      notes: ""
    }],
    settings,
    hostKeys: [{ host: "server.example", port: 22, fingerprint: "host-fingerprint" }],
    credentials: [{ hostId: "host-a", kind: "password", value: "password-value" }],
    profiles: [forwardingProfile()]
  }
}

function forwardingProfile(): ForwardingProfile {
  return {
    id: "forwarding-a",
    hostId: "host-a",
    name: "Web console",
    description: "Local console",
    localAddress: "127.0.0.1",
    localPort: 18080,
    remoteAddress: "127.0.0.1",
    remotePort: 8080,
    autoStart: false,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z"
  }
}

function createTarget(): ConfigImportTarget & {
  hosts: HostProfile[]
  hostKeys: Map<string, string>
  credentials: Map<string, string>
  forwardingProfiles: ForwardingProfile[]
  settings: AppSettings
} {
  const hosts: HostProfile[] = [{
    id: "host-a",
    name: "Existing",
    host: "old.example",
    port: 22,
    username: "root",
    authMethod: "password",
    favorite: false,
    notes: ""
  }]
  const hostKeys = new Map([["server.example:22", "old-fingerprint"]])
  const credentials = new Map<string, string>()
  let forwardingProfiles: ForwardingProfile[] = []
  let currentSettings = { ...settings }
  return {
    hosts,
    hostKeys,
    credentials,
    get forwardingProfiles() { return forwardingProfiles },
    set forwardingProfiles(profiles: ForwardingProfile[]) { forwardingProfiles = profiles },
    get settings() { return { ...currentSettings } },
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
    getSettings: async () => ({ ...currentSettings }),
    updateSettings: async (next) => { currentSettings = { ...next } },
    getHostKey: async (host, port) => hostKeys.get(`${host}:${port}`),
    trustHostKey: async (host, port, fingerprint) => { hostKeys.set(`${host}:${port}`, fingerprint) },
    replaceHostKey: async (host, port, expected, replacement) => {
      if (hostKeys.get(`${host}:${port}`) !== expected) throw new Error("Host Key changed")
      hostKeys.set(`${host}:${port}`, replacement)
    },
    removeHostKey: async (host, port, expected) => {
      if (hostKeys.get(`${host}:${port}`) !== expected) throw new Error("Host Key changed")
      hostKeys.delete(`${host}:${port}`)
    },
    assertCredentialsWritable: async () => undefined,
    importCredentials: async (values) => {
      const imported: string[] = []
      const skippedExisting: string[] = []
      for (const [key, value] of Object.entries(values)) {
        if (credentials.has(key)) skippedExisting.push(key)
        else {
          credentials.set(key, value)
          imported.push(key)
        }
      }
      return { imported, skippedExisting }
    },
    listForwardingProfiles: async () => forwardingProfiles.map((profile) => ({ ...profile })),
    replaceForwardingProfiles: async (profiles) => { forwardingProfiles = profiles.map((profile) => ({ ...profile })) }
  }
}
