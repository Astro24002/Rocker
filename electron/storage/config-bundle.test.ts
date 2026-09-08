import { describe, expect, it } from "vitest"
import {
  ConfigBundleService,
  exportEncryptedBundle,
  exportTemplate,
  inspectBundle,
  type ConfigImportTarget,
  type ExportSnapshot
} from "./config-bundle"
import type { AppSettings, HostProfile } from "./types"

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

  it("requires explicit resolutions for host and Host Key conflicts", async () => {
    const target = createTarget()
    const service = new ConfigBundleService(target)
    const bundle = await exportEncryptedBundle(snapshot(), "migration password")

    await expect(service.preview(bundle, "migration password")).resolves.toMatchObject({
      hosts: { conflicts: 1 },
      hostKeys: { conflicts: 1 },
      credentials: { total: 1 }
    })
    await expect(service.import(bundle, "migration password", { importCredentials: true })).rejects.toThrow("Import conflict requires resolution")
    expect(target.hosts[0].name).toBe("Existing")
    expect(target.hostKeys.get("server.example:22")).toBe("old-fingerprint")

    await expect(service.import(bundle, "migration password", {
      importCredentials: true,
      hosts: { "host-a": "use-imported" },
      hostKeys: { "server.example:22": "replace-host-key" }
    })).resolves.toMatchObject({ replacedHosts: 1, replacedHostKeys: 1, importedCredentials: 1 })
    expect(target.hosts[0].name).toBe("Imported")
    expect(target.hostKeys.get("server.example:22")).toBe("host-fingerprint")
    expect(target.credentials.get("host-a:password")).toBe("password-value")
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
    credentials: [{ hostId: "host-a", kind: "password", value: "password-value" }]
  }
}

function createTarget(): ConfigImportTarget & {
  hosts: HostProfile[]
  hostKeys: Map<string, string>
  credentials: Map<string, string>
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
  return {
    hosts,
    hostKeys,
    credentials,
    listHosts: async () => hosts.map((host) => ({ ...host })),
    saveHost: async (profile) => {
      const index = hosts.findIndex((host) => host.id === profile.id)
      if (index === -1) hosts.push({ ...profile })
      else hosts[index] = { ...profile }
    },
    getSettings: async () => ({ ...settings }),
    updateSettings: async () => undefined,
    getHostKey: async (host, port) => hostKeys.get(`${host}:${port}`),
    trustHostKey: async (host, port, fingerprint) => { hostKeys.set(`${host}:${port}`, fingerprint) },
    replaceHostKey: async (host, port, expected, replacement) => {
      if (hostKeys.get(`${host}:${port}`) !== expected) throw new Error("Host Key changed")
      hostKeys.set(`${host}:${port}`, replacement)
    },
    assertCredentialsWritable: async () => undefined,
    importCredentials: async (values) => {
      for (const [key, value] of Object.entries(values)) credentials.set(key, value)
    }
  }
}
