import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: { sender: { id: number } }, ...args: unknown[]) => unknown>()
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (event: { sender: { id: number } }, ...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel))
    },
    BrowserWindow: {
      fromWebContents: vi.fn()
    },
    dialog: {
      showOpenDialog: vi.fn(),
      showMessageBox: vi.fn(),
      showSaveDialog: vi.fn()
    },
    shell: {
      openExternal: vi.fn()
    }
  }
})

vi.mock("electron", () => electron)

import { ipcChannels } from "./bridge-contract"
import { registerIpcHandlers, type IpcDependencies } from "./register"
import { sameRuntimeOwner, type RuntimeOwner } from "../runtime/owner"
import { HostStore } from "../storage/host-store"
import type { HostProfile } from "../storage/types"
import type { AppSettings } from "../storage/types"
import type { ForwardingProfile } from "../storage/types"
import type { ForwardingInfo } from "../ports/types"

const sessionId = "11111111-1111-4111-8111-111111111111"
const connectionId = "22222222-2222-4222-8222-222222222222"
const owner21: RuntimeOwner = { webContentsId: 21, rendererGeneration: 1 }
const owner21Generation2: RuntimeOwner = { webContentsId: 21, rendererGeneration: 2 }
const owner22: RuntimeOwner = { webContentsId: 22, rendererGeneration: 1 }

describe("registerIpcHandlers", () => {
  afterEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it("routes output only to the session owner", () => {
    const harness = createHarness()
    registerIpcHandlers(harness.dependencies)

    harness.emitSession({
      owner: owner21,
      event: {
        kind: "output",
        packet: { sessionId, channelGeneration: 1, sequence: 1, bytes: Uint8Array.of(0x61) }
      }
    })

    expect(harness.owner.webContents.send).toHaveBeenCalledWith(ipcChannels.sessionEvent, expect.objectContaining({ kind: "output" }))
    expect(harness.other.webContents.send).not.toHaveBeenCalled()
  })

  it("does not register a host-monitoring IPC channel", () => {
    const harness = createHarness()
    registerIpcHandlers(harness.dependencies)

    expect([...electron.handlers.keys()]).not.toContain("rocker:monitor:sample")
  })

  it("returns the current native maximize state for the owning window", async () => {
    const harness = createHarness()
    const nativeWindow = { isMaximized: vi.fn(() => true) }
    electron.BrowserWindow.fromWebContents.mockReturnValue(nativeWindow)
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.windowIsMaximized)).resolves.toBe(true)
    expect(nativeWindow.isMaximized).toHaveBeenCalledOnce()
    expect(electron.BrowserWindow.fromWebContents).toHaveBeenCalledWith({ id: 21 })
  })

  it("lists the Host Key inventory and audit history for the current renderer owner", async () => {
    const harness = createHarness()
    harness.hostKeys.entries.mockResolvedValue([{ host: "server.example", port: 22, fingerprint: "fingerprint-a" }])
    harness.hostKeys.auditEntries.mockResolvedValue([{
      at: "2026-09-11T00:00:00.000Z",
      action: "trusted",
      host: "server.example",
      port: 22,
      fingerprint: "fingerprint-a"
    }])
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.hostKeysList)).resolves.toEqual({
      entries: [{ host: "server.example", port: 22, fingerprint: "fingerprint-a" }],
      history: [{
        at: "2026-09-11T00:00:00.000Z",
        action: "trusted",
        host: "server.example",
        port: 22,
        fingerprint: "fingerprint-a"
      }]
    })
  })

  it("tests a saved Host through the current renderer owner without opening a Session", async () => {
    const harness = createHarness()
    harness.hosts.list.mockResolvedValue([{ id: "host-a", name: "Host A", host: "server.example", port: 22, username: "root", authMethod: "agent", favorite: false, notes: "" }])
    harness.connections.testConnection.mockResolvedValue({ status: "reachable", latencyMs: 18 })
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.hostsTestConnection, "host-a")).resolves.toEqual({ status: "reachable", latencyMs: 18 })
    expect(harness.connections.testConnection).toHaveBeenCalledWith({ hostId: "host-a", owner: owner21 })
    expect(harness.sessions.open).not.toHaveBeenCalled()
    expect(harness.history.add).not.toHaveBeenCalled()
  })

  it("rejects a Host connection test when the Host is missing", async () => {
    const harness = createHarness()
    harness.hosts.list.mockResolvedValue([])
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.hostsTestConnection, "host-missing")).rejects.toThrow("Host profile not found")
    expect(harness.connections.testConnection).not.toHaveBeenCalled()
  })

  it("rejects a Host connection test when the renderer owner is replaced", async () => {
    const harness = createHarness()
    harness.hosts.list.mockResolvedValue([{ id: "host-a", name: "Host A", host: "server.example", port: 22, username: "root", authMethod: "agent", favorite: false, notes: "" }])
    harness.windows.currentOwnerForWebContents
      .mockReturnValueOnce(owner21)
      .mockReturnValue(owner21Generation2)
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.hostsTestConnection, "host-a")).rejects.toThrow("Renderer owner was replaced")
    expect(harness.connections.testConnection).not.toHaveBeenCalled()
  })

  it("removes a Host Key only through the current owner and expected fingerprint", async () => {
    const harness = createHarness()
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.hostKeysRemove, {
      host: "server.example",
      port: 22,
      fingerprint: "fingerprint-a"
    })).resolves.toBeUndefined()
    expect(harness.hostKeys.remove).toHaveBeenCalledWith("server.example", 22, "fingerprint-a")

    await expect(invokeFrom(21, ipcChannels.hostKeysRemove, {
      host: "",
      port: 22,
      fingerprint: "fingerprint-a"
    })).rejects.toThrow("Invalid Host Key removal request")
  })

  it("rejects Host Key inventory requests from a replaced renderer generation", async () => {
    const harness = createHarness()
    harness.windows.currentOwnerForWebContents
      .mockReturnValueOnce(owner21)
      .mockReturnValue(owner21Generation2)
    harness.hostKeys.entries.mockResolvedValue([])
    harness.hostKeys.auditEntries.mockResolvedValue([])
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.hostKeysList)).rejects.toThrow("Renderer owner was replaced")
    expect(harness.hostKeys.entries).not.toHaveBeenCalled()
  })

  it("rejects Host Key removal when the renderer generation changes before mutation", async () => {
    const harness = createHarness()
    harness.windows.currentOwnerForWebContents
      .mockReturnValueOnce(owner21)
      .mockReturnValue(owner21Generation2)
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.hostKeysRemove, {
      host: "server.example",
      port: 22,
      fingerprint: "fingerprint-a"
    })).rejects.toThrow("Renderer owner was replaced")
    expect(harness.hostKeys.remove).not.toHaveBeenCalled()
  })

  it("does not deliver a session event from an old renderer generation", () => {
    const harness = createHarness()
    harness.windows.currentOwnerForWebContents.mockReturnValue(owner21Generation2)
    registerIpcHandlers(harness.dependencies)

    harness.emitSession({
      owner: owner21,
      event: {
        kind: "output",
        packet: { sessionId, channelGeneration: 1, sequence: 1, bytes: Uint8Array.of(0x61) }
      }
    })

    expect(harness.windows.sendToOwner).toHaveBeenCalledWith(
      owner21,
      ipcChannels.sessionEvent,
      expect.objectContaining({ kind: "output" })
    )
    expect(harness.owner.webContents.send).not.toHaveBeenCalled()
  })

  it("rejects a renderer request for a session owned by another window", async () => {
    const harness = createHarness()
    harness.sessions.ownerForSession.mockReturnValue(owner21)
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(22, ipcChannels.sessionClose, sessionId)).rejects.toThrow("Session is owned by another window")
    expect(harness.sessions.close).not.toHaveBeenCalled()
  })

  it("rejects a renderer request for a session owned by another generation", async () => {
    const harness = createHarness()
    harness.windows.currentOwnerForWebContents.mockReturnValue(owner21Generation2)
    harness.sessions.ownerForSession.mockReturnValue(owner21)
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.sessionClose, sessionId))
      .rejects.toThrow("Session is owned by another renderer generation")
    expect(harness.sessions.close).not.toHaveBeenCalled()
  })

  it("rejects session open when the renderer owner changes while hosts are listed", async () => {
    const harness = createHarness()
    let resolveHosts!: (hosts: HostProfile[]) => void
    const hostsListed = new Promise<HostProfile[]>((resolve) => { resolveHosts = resolve })
    harness.hosts.list.mockReturnValueOnce(hostsListed)
    harness.windows.currentOwnerForWebContents
      .mockReturnValueOnce(owner21)
      .mockReturnValue(owner21Generation2)
    registerIpcHandlers(harness.dependencies)

    const opening = invokeFrom(21, ipcChannels.sessionOpen, {
      sessionId,
      hostId: "host-a",
      cols: 80,
      rows: 24
    })
    await flush()

    expect(harness.hosts.list).toHaveBeenCalledOnce()
    resolveHosts([{
      id: "host-a",
      name: "Host A",
      host: "127.0.0.1",
      port: 22,
      username: "rock",
      authMethod: "password",
      favorite: false,
      notes: ""
    }])

    await expect(opening).rejects.toThrow("Renderer owner was replaced")
    expect(harness.windows.currentOwnerForWebContents).toHaveBeenCalledTimes(2)
    expect(harness.sessions.open).not.toHaveBeenCalled()
  })

  it("rejects a port scan for a connection owned by another window", async () => {
    const harness = createHarness()
    harness.connections.ownerForConnection.mockReturnValue(owner21)
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(22, ipcChannels.portsScan, connectionId)).rejects.toThrow("SSH connection is owned by another window")
    expect(harness.ports.scan).not.toHaveBeenCalled()
  })

  it("lists saved forwarding profiles globally, including stopped runtimes", async () => {
    const harness = createHarness()
    const profile = testForwardingProfile()
    harness.forwardingProfiles.list.mockResolvedValue([profile])
    harness.forwarding.list.mockReturnValue([{
      id: "forwarding-runtime",
      profileId: profile.id,
      hostId: profile.hostId,
      connectionId,
      localAddress: profile.localAddress,
      localPort: profile.localPort,
      remoteAddress: profile.remoteAddress,
      remotePort: profile.remotePort,
      status: "stopped"
    }])
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.portsListOverview)).resolves.toEqual([{ profile, runtime: expect.objectContaining({ status: "stopped" }) }])
  })

  it("creates a Host-bound profile without starting a runtime", async () => {
    const harness = createHarness()
    const profile = testForwardingProfile()
    harness.hosts.list.mockResolvedValue([{ id: profile.hostId, name: "Host A", host: "server.example", port: 22, username: "root", authMethod: "agent", favorite: false, notes: "" }])
    harness.forwardingProfiles.save.mockResolvedValue(undefined)
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.portsCreateProfile, profile.hostId, {
      name: profile.name,
      description: profile.description,
      localAddress: profile.localAddress,
      localPort: profile.localPort,
      remoteAddress: profile.remoteAddress,
      remotePort: profile.remotePort,
      autoStart: profile.autoStart
    })).resolves.toMatchObject({ hostId: profile.hostId, name: profile.name })
    expect(harness.forwardingProfiles.save).toHaveBeenCalledOnce()
    expect(harness.forwarding.startProfile).not.toHaveBeenCalled()
  })

  it("stops and removes Host forwarding resources before deleting the Host", async () => {
    const harness = createHarness()
    const profile = testForwardingProfile()
    const runtime: ForwardingInfo = {
      id: "runtime-1",
      profileId: profile.id,
      hostId: profile.hostId,
      connectionId,
      localAddress: profile.localAddress,
      localPort: profile.localPort,
      remoteAddress: profile.remoteAddress,
      remotePort: profile.remotePort,
      status: "forwarding"
    }
    harness.hosts.list.mockResolvedValue([{ id: profile.hostId, name: "Host A", host: "server.example", port: 22, username: "root", authMethod: "agent", favorite: false, notes: "" }])
    harness.forwardingProfiles.list.mockResolvedValue([profile])
    harness.forwarding.list.mockReturnValue([runtime])
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.hostsRemove, profile.hostId)).resolves.toBeUndefined()
    expect(harness.forwarding.stop).toHaveBeenCalledWith(runtime.id)
    expect(harness.forwardingProfiles.remove).toHaveBeenCalledWith(profile.id)
    expect(harness.hosts.remove).toHaveBeenCalledWith(profile.hostId)
  })

  it("starts a saved profile through Host acquisition without a terminal", async () => {
    const harness = createHarness()
    const profile = testForwardingProfile()
    harness.hosts.list.mockResolvedValue([{ id: profile.hostId, name: "Host A", host: "server.example", port: 22, username: "root", authMethod: "agent", favorite: false, notes: "" }])
    harness.forwardingProfiles.get.mockResolvedValue(profile)
    harness.forwarding.startProfile.mockResolvedValue({
      id: "runtime-1",
      profileId: profile.id,
      hostId: profile.hostId,
      connectionId,
      localAddress: profile.localAddress,
      localPort: profile.localPort,
      remoteAddress: profile.remoteAddress,
      remotePort: profile.remotePort,
      status: "forwarding"
    })
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.portsStartProfile, profile.id)).resolves.toMatchObject({ profileId: profile.id })
    expect(harness.forwarding.startProfile).toHaveBeenCalledWith(profile, owner21)
  })

  it("delivers forwarding events only to the owning window", () => {
    const harness = createHarness()
    let emitForwarding: ((event: unknown) => void) | undefined
    harness.dependencies.forwarding.onEvent = vi.fn((listener: (event: unknown) => void) => {
      emitForwarding = listener
      return vi.fn()
    })
    registerIpcHandlers(harness.dependencies)

    emitForwarding?.({ kind: "stopped", forwardingId: "runtime-1", connectionId, owner: owner21, profileId: "profile-1", hostId: "host-a" })
    expect(harness.owner.webContents.send).toHaveBeenCalledWith(ipcChannels.portsEvent, expect.objectContaining({ profileId: "profile-1" }))
    expect(harness.other.webContents.send).not.toHaveBeenCalled()
  })

  it("applies updated reconnect settings to the connection manager", async () => {
    const harness = createHarness()
    const nextSettings = {
      locale: "en" as const,
      sidebarWidth: 220,
      terminalFont: "JetBrains Mono",
      terminalFontSize: 13,
      connectionTimeout: 15,
      autoReconnect: false,
      reconnectMode: "limited" as const,
      restorePreviousWorkspace: true,
      confirmMultilinePaste: true,
      bindAddress: "127.0.0.1" as const
    }
    harness.settings.update.mockResolvedValue(nextSettings)
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.settingsUpdate, { autoReconnect: false })).resolves.toEqual(nextSettings)
    expect(harness.connections.updateRetryPolicy).toHaveBeenCalledWith(nextSettings)
  })

  it("returns a canceled diagnostics export without writing a file", async () => {
    const harness = createHarness()
    electron.BrowserWindow.fromWebContents.mockReturnValue(harness.owner)
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: true })
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.diagnosticsExport)).resolves.toEqual({ canceled: true })
    expect(electron.dialog.showSaveDialog).toHaveBeenCalledWith(harness.owner, expect.objectContaining({
      defaultPath: expect.stringMatching(/^rocker-diagnostics-\d{8}-\d{6}\.json$/)
    }))
    expect(harness.diagnostics.snapshot).not.toHaveBeenCalled()
  })

  it("exports a non-sensitive configuration template without loading credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-config-export-"))
    try {
      const output = join(directory, "rocker-config.json")
      const harness = createHarness()
      harness.createConfigurationExportSnapshot.mockResolvedValue(configurationSnapshot())
      electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: output })
      registerIpcHandlers(harness.dependencies)

      await expect(invokeFrom(21, ipcChannels.configExportTemplate)).resolves.toEqual({ canceled: false, path: output })

      expect(harness.createConfigurationExportSnapshot).toHaveBeenCalledWith(false)
      const serialized = await readFile(output, "utf8")
      expect(serialized).not.toContain("password-value")
      expect(JSON.parse(serialized)).toMatchObject({ format: "rocker-config", containsSecrets: false })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("exports an encrypted migration bundle without plaintext credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-config-export-"))
    try {
      const output = join(directory, "rocker-config.bundle")
      const harness = createHarness()
      harness.createConfigurationExportSnapshot.mockResolvedValue(configurationSnapshot())
      electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: output })
      registerIpcHandlers(harness.dependencies)

      await expect(invokeFrom(21, ipcChannels.configExportBundle, "migration password"))
        .resolves.toEqual({ canceled: false, path: output })

      expect(harness.createConfigurationExportSnapshot).toHaveBeenCalledWith(true)
      expect(await readFile(output, "utf8")).not.toContain("password-value")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("keeps selected import bytes in Main and binds the ticket to its owner", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-config-import-"))
    try {
      const input = join(directory, "rocker-config.json")
      await writeFile(input, '{"format":"rocker-config","version":1,"containsSecrets":false,"createdAt":"2026-09-08T00:00:00.000Z","hosts":[],"settings":{}}', "utf8")
      const harness = createHarness()
      harness.configuration.preview.mockResolvedValue({ encrypted: false, requiresPassword: false })
      harness.configuration.import.mockResolvedValue({ importedHosts: 0 })
      electron.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [input] })
      registerIpcHandlers(harness.dependencies)

      const selected = await invokeFrom(21, ipcChannels.configImportChoose) as { canceled: boolean; importId?: string }
      expect(selected).toMatchObject({ canceled: false })
      expect(selected.importId).toEqual(expect.any(String))
      expect(harness.configuration.preview).toHaveBeenCalledWith(expect.any(Uint8Array), undefined)

      await expect(invokeFrom(22, ipcChannels.configImportApply, { importId: selected.importId, resolution: {} }))
        .rejects.toThrow("Import is owned by another window")
      await expect(invokeFrom(21, ipcChannels.configImportApply, { importId: selected.importId, resolution: {} }))
        .resolves.toEqual({ importedHosts: 0 })
      expect(harness.configuration.import).toHaveBeenCalledWith(expect.any(Uint8Array), undefined, {})
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("does not apply the same import ticket concurrently", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-config-import-"))
    try {
      const input = join(directory, "rocker-config.json")
      await writeFile(input, '{"format":"rocker-config","version":1,"containsSecrets":false,"createdAt":"2026-09-08T00:00:00.000Z","hosts":[],"settings":{}}', "utf8")
      const harness = createHarness()
      let resolveImport!: (value: { importedHosts: number }) => void
      harness.configuration.preview.mockResolvedValue({ encrypted: false, requiresPassword: false })
      harness.configuration.import.mockReturnValue(new Promise((resolve) => { resolveImport = resolve }))
      electron.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [input] })
      registerIpcHandlers(harness.dependencies)
      const selected = await invokeFrom(21, ipcChannels.configImportChoose) as { importId: string }

      const first = invokeFrom(21, ipcChannels.configImportApply, { importId: selected.importId, resolution: {} })
      await flush()
      await expect(invokeFrom(21, ipcChannels.configImportApply, { importId: selected.importId, resolution: {} }))
        .rejects.toThrow("Configuration import is already running")
      resolveImport({ importedHosts: 0 })
      await expect(first).resolves.toEqual({ importedHosts: 0 })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("exposes sanitized credential protection state and validates Vault passwords", async () => {
    const harness = createHarness()
    harness.credentials.protectionStatus.mockResolvedValue({ mode: "keychain", keychainAvailable: true, vaultState: "not-configured" })
    harness.credentials.enableVault.mockResolvedValue(undefined)
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.credentialProtectionStatus)).resolves.toEqual({
      mode: "keychain",
      keychainAvailable: true,
      vaultState: "not-configured"
    })
    await expect(invokeFrom(21, ipcChannels.credentialVaultEnable, "vault password")).resolves.toEqual({
      mode: "keychain",
      keychainAvailable: true,
      vaultState: "not-configured"
    })
    expect(harness.credentials.enableVault).toHaveBeenCalledWith("vault password")
    await expect(invokeFrom(21, ipcChannels.credentialVaultEnable, "")).rejects.toThrow("Credential Vault password is invalid")
    expect(JSON.stringify(harness.credentials.protectionStatus.mock.results)).not.toContain("vault password")
  })

  it("writes a versioned diagnostics export selected by the owning window", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-ipc-diagnostics-"))
    try {
      const target = join(directory, "diagnostics.json")
      const harness = createHarness()
      electron.BrowserWindow.fromWebContents.mockReturnValue(harness.owner)
      electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
      registerIpcHandlers(harness.dependencies)

      await expect(invokeFrom(21, ipcChannels.diagnosticsExport)).resolves.toEqual({ canceled: false, path: target })
      const payload = JSON.parse(await readFile(target, "utf8")) as { schemaVersion: number; events: unknown[]; buildChannel: string; runtimeMode: string }
      expect(payload.schemaVersion).toBe(1)
      expect(payload.events).toHaveLength(1)
      expect(payload.buildChannel).toBe("release")
      expect(payload.runtimeMode).toBe("packaged")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("returns all six bootstrap resources without protected values", async () => {
    const harness = createHarness()
    harness.settings.loadWithStatus.mockResolvedValue({
      status: "ok",
      value: { locale: "en", sidebarWidth: 220, terminalFont: "JetBrains Mono", terminalFontSize: 13, connectionTimeout: 15, autoReconnect: true, reconnectMode: "limited", restorePreviousWorkspace: true, confirmMultilinePaste: true, bindAddress: "127.0.0.1" }
    })
    harness.history.loadWithStatus.mockResolvedValue({ status: "defaulted", value: [], reason: "missing" })
    harness.hosts.loadWithStatus.mockResolvedValue({ status: "ok", value: [] })
    harness.credentials.health.mockResolvedValue({ store: "credentials", status: "ok" })
    harness.hostKeys.health.mockResolvedValue({ store: "hostKeys", status: "recovered", source: "backup" })
    harness.windows.loadWorkspaceWithStatus.mockResolvedValue({
      health: { store: "workspace", status: "ok" },
      value: undefined
    })
    registerIpcHandlers(harness.dependencies)

    const result = await invokeFrom(21, ipcChannels.bootstrapLoad)

    expect(Object.keys(result as object)).toEqual(["settings", "history", "workspace", "hosts", "credentials", "hostKeys"])
    expect(result).toMatchObject({
      settings: { value: expect.objectContaining({ locale: "en" }), health: { store: "settings", status: "ok" } },
      history: { value: [], health: { store: "history", status: "defaulted", reason: "missing" } },
      workspace: { health: { store: "workspace", status: "ok" } },
      hosts: { value: [], health: { store: "hosts", status: "ok" } },
      credentials: { health: { store: "credentials", status: "ok" } },
      hostKeys: { health: { store: "hostKeys", status: "recovered", source: "backup" } }
    })
    expect((result as { credentials: Record<string, unknown> }).credentials).not.toHaveProperty("value")
    expect((result as { hostKeys: Record<string, unknown> }).hostKeys).not.toHaveProperty("value")
    expect(harness.credentials.health).toHaveBeenCalledWith({ consumeHealth: true })
    expect(harness.hostKeys.health).toHaveBeenCalledWith({ consumeHealth: true })
  })

  it("redacts host identity file paths from the bootstrap snapshot", async () => {
    const harness = createHarness()
    const identityFile = "/private/user-data/.ssh/id_ed25519"
    harness.hosts.loadWithStatus.mockResolvedValue({
      status: "ok",
      value: [{
        id: "host-a",
        name: "Host A",
        host: "127.0.0.1",
        port: 22,
        username: "rock",
        authMethod: "privateKey",
        identityFile,
        favorite: true,
        notes: ""
      }]
    })
    registerIpcHandlers(harness.dependencies)

    const result = await invokeFrom(21, ipcChannels.bootstrapLoad) as {
      hosts: { value?: Array<Record<string, unknown>> }
    }

    expect(result.hosts.value).toHaveLength(1)
    expect(result.hosts.value?.[0]).toMatchObject({ id: "host-a", hasIdentityFile: true })
    expect(result.hosts.value?.[0]).not.toHaveProperty("identityFile")
    expect(JSON.stringify(result)).not.toContain(identityFile)

    const retry = await invokeFrom(21, ipcChannels.bootstrapRetry, ["hosts"]) as {
      hosts: { value?: Array<Record<string, unknown>> }
    }
    expect(retry.hosts.value?.[0]).toMatchObject({ id: "host-a", hasIdentityFile: true })
    expect(retry.hosts.value?.[0]).not.toHaveProperty("identityFile")
    expect(JSON.stringify(retry)).not.toContain(identityFile)
  })

  it("restores a redacted host identity file in Main before saving", async () => {
    const harness = createHarness()
    registerIpcHandlers(harness.dependencies)

    await invokeFrom(21, ipcChannels.hostsSave, {
      profile: {
        id: "host-a",
        name: "Host A",
        host: "127.0.0.1",
        port: 22,
        username: "rock",
        authMethod: "privateKey",
        hasIdentityFile: true,
        favorite: true,
        notes: ""
      }
    })

    expect(harness.hosts.saveRedacted).toHaveBeenCalledWith(expect.objectContaining({
      id: "host-a",
      hasIdentityFile: true,
      favorite: true
    }))
    expect(harness.hosts.save).not.toHaveBeenCalled()
  })

  it("duplicates a host through the serialized mutation queue", async () => {
    const harness = createHarness()
    const duplicate = { id: "host-copy", name: "Host A copy", authMethod: "agent", favorite: false, notes: "" }
    harness.hosts.duplicate.mockResolvedValue(duplicate)
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.hostsDuplicate, "host-a")).resolves.toEqual(duplicate)
    expect(harness.mutations.run).toHaveBeenCalled()
    expect(harness.hosts.duplicate).toHaveBeenCalledWith("host-a")
  })

  it("rejects non-boolean favorite values before storage", async () => {
    const harness = createHarness()
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.hostsSetFavorite, "host-a", "yes"))
      .rejects.toThrow("Invalid favorite setting")
    expect(harness.hosts.setFavorite).not.toHaveBeenCalled()
  })

  it("updates a host favorite through the serialized mutation queue", async () => {
    const harness = createHarness()
    harness.hosts.setFavorite.mockResolvedValue({ id: "host-a", name: "Host A", favorite: true })
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.hostsSetFavorite, "host-a", true)).resolves.toMatchObject({ favorite: true })
    expect(harness.mutations.run).toHaveBeenCalled()
    expect(harness.hosts.setFavorite).toHaveBeenCalledWith("host-a", true)
  })

  it("accepts valid optional Host Profile editor metadata", async () => {
    const harness = createHarness()
    registerIpcHandlers(harness.dependencies)

    await invokeFrom(21, ipcChannels.hostsSave, {
      profile: {
        id: "host-a",
        name: "Host A",
        host: "127.0.0.1",
        port: 22,
        username: "rock",
        authMethod: "password",
        publicKeyEnabled: false,
        snippetsEnabled: true,
        snippetCollection: "Deployment",
        charset: "gb18030",
        themeColor: "amber",
        environment: "production",
        tags: [" core ", "linux"],
        favorite: false,
        notes: ""
      }
    })

    expect(harness.hosts.save).toHaveBeenCalledWith(expect.objectContaining({
      publicKeyEnabled: false,
      snippetsEnabled: true,
      snippetCollection: "Deployment",
      charset: "gb18030",
      themeColor: "amber",
      environment: "production",
      tags: [" core ", "linux"]
    }))
  })

  it("rejects malformed Host organization metadata before saving", async () => {
    const harness = createHarness()
    registerIpcHandlers(harness.dependencies)

    const base = {
      id: "host-a",
      name: "Host A",
      host: "127.0.0.1",
      port: 22,
      username: "rock",
      authMethod: "agent" as const,
      favorite: false,
      notes: ""
    }

    await expect(invokeFrom(21, ipcChannels.hostsSave, { profile: { ...base, environment: "unknown" } }))
      .rejects.toThrow("Invalid host environment")
    await expect(invokeFrom(21, ipcChannels.hostsSave, { profile: { ...base, tags: ["x".repeat(65)] } }))
      .rejects.toThrow("Invalid host tags")
    expect(harness.hosts.save).not.toHaveBeenCalled()
  })

  it("accepts empty optional values while their capabilities are disabled", async () => {
    const harness = createHarness()
    registerIpcHandlers(harness.dependencies)

    await invokeFrom(21, ipcChannels.hostsSave, {
      profile: {
        id: "host-a",
        name: "Host A",
        host: "127.0.0.1",
        port: 22,
        username: "rock",
        authMethod: "password",
        publicKeyEnabled: false,
        snippetsEnabled: false,
        snippetCollection: "",
        favorite: false,
        notes: ""
      }
    })

    expect(harness.hosts.save).toHaveBeenCalledWith(expect.objectContaining({
      publicKeyEnabled: false,
      snippetsEnabled: false
    }))
  })

  it("rejects enabled optional capabilities without their required values", async () => {
    const harness = createHarness()
    registerIpcHandlers(harness.dependencies)

    const base = {
      id: "host-a",
      name: "Host A",
      host: "127.0.0.1",
      port: 22,
      username: "rock",
      authMethod: "password" as const,
      favorite: false,
      notes: ""
    }

    await expect(invokeFrom(21, ipcChannels.hostsSave, {
      profile: { ...base, snippetsEnabled: true }
    })).rejects.toThrow("Snippet collection is required")
    await expect(invokeFrom(21, ipcChannels.hostsSave, {
      profile: { ...base, publicKeyEnabled: true, authMethod: "privateKey" }
    })).rejects.toThrow("Private key path is required")
    expect(harness.hosts.save).not.toHaveBeenCalled()
  })

  it("rejects an overlong private key path before saving credentials", async () => {
    const harness = createHarness()
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.hostsSave, {
      profile: {
        id: "host-a",
        name: "Host A",
        host: "127.0.0.1",
        port: 22,
        username: "rock",
        authMethod: "privateKey",
        publicKeyEnabled: true,
        identityFile: "x".repeat(4_097),
        favorite: false,
        notes: ""
      },
      credentials: { passphrase: "should-not-be-persisted" }
    })).rejects.toThrow("Invalid private key path")

    expect(harness.hosts.save).not.toHaveBeenCalled()
    expect(harness.hosts.saveRedacted).not.toHaveBeenCalled()
    expect(harness.credentials.set).not.toHaveBeenCalled()
  })

  it("serializes redacted host saves so a stale identity file cannot overwrite a newer save", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-ipc-hosts-"))
    try {
      const store = new HostStore(join(directory, "rocker.json"))
      const oldIdentityFile = "/private/user-data/.ssh/old_key"
      const newIdentityFile = "/private/user-data/.ssh/new_key"
      await store.save({
        id: "host-a",
        name: "Host A",
        host: "127.0.0.1",
        port: 22,
        username: "rock",
        authMethod: "privateKey",
        identityFile: oldIdentityFile,
        favorite: false,
        notes: ""
      })
      const harness = createHarness()
      const dependencies = { ...harness.dependencies, hosts: store } as IpcDependencies
      registerIpcHandlers(dependencies)

      await Promise.all([
        invokeFrom(21, ipcChannels.hostsSave, {
          profile: {
            id: "host-a",
            name: "Host A",
            host: "127.0.0.1",
            port: 22,
            username: "rock",
            authMethod: "privateKey",
            hasIdentityFile: true,
            favorite: true,
            notes: ""
          }
        }),
        invokeFrom(21, ipcChannels.hostsSave, {
          profile: {
            id: "host-a",
            name: "Host A",
            host: "127.0.0.1",
            port: 22,
            username: "rock",
            authMethod: "privateKey",
            identityFile: newIdentityFile,
            favorite: false,
            notes: ""
          }
        })
      ])

      const stored = (await store.list()).find((profile) => profile.id === "host-a")
      expect(stored).toMatchObject({ id: "host-a", identityFile: newIdentityFile, favorite: false })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("settles each bootstrap resource independently and bounds unexpected adapter errors", async () => {
    const harness = createHarness()
    harness.settings.loadWithStatus.mockResolvedValue({ status: "ok", value: { locale: "en" } })
    harness.history.loadWithStatus.mockResolvedValue({ status: "ok", value: [] })
    harness.hosts.loadWithStatus.mockRejectedValue(new Error("/private/user-data/hosts.json leaked"))
    harness.credentials.health.mockRejectedValue(new Error("safeStorage secret leaked"))
    harness.hostKeys.health.mockResolvedValue({ store: "hostKeys", status: "ok" })
    harness.windows.loadWorkspaceWithStatus.mockResolvedValue({ health: { store: "workspace", status: "ok" }, value: undefined })
    registerIpcHandlers(harness.dependencies)

    const result = await invokeFrom(21, ipcChannels.bootstrapLoad) as {
      settings: { value?: unknown }
      history: { value?: unknown }
      hosts: { health: Record<string, unknown> }
      credentials: { health: Record<string, unknown> }
      hostKeys: { health: Record<string, unknown> }
    }

    expect(result.settings.value).toEqual({ locale: "en" })
    expect(result.history.value).toEqual([])
    expect(result.hosts.health).toEqual({ store: "hosts", status: "blocked", reason: "unavailable", message: "Stored data is unavailable." })
    expect(result.credentials.health).toEqual({ store: "credentials", status: "blocked", reason: "unavailable", message: "Stored data is unavailable." })
    expect(JSON.stringify(result)).not.toContain("private/user-data")
    expect(JSON.stringify(result)).not.toContain("safeStorage secret")
  })

  it("rejects bootstrap results when the renderer owner is replaced while loading", async () => {
    const harness = createHarness()
    let resolveSettings!: (result: unknown) => void
    harness.settings.loadWithStatus.mockReturnValue(new Promise((resolve) => { resolveSettings = resolve }))
    harness.windows.currentOwnerForWebContents
      .mockReturnValueOnce(owner21)
      .mockReturnValue(owner21Generation2)
    registerIpcHandlers(harness.dependencies)

    const loading = invokeFrom(21, ipcChannels.bootstrapLoad)
    await flush()
    resolveSettings({ status: "ok", value: {} })

    await expect(loading).rejects.toThrow("Renderer owner was replaced")
  })

  it("retries only a validated selected subset of bootstrap resources", async () => {
    const harness = createHarness()
    harness.hosts.loadWithStatus.mockResolvedValue({ status: "recovered", value: [], source: "backup" })
    registerIpcHandlers(harness.dependencies)

    const result = await invokeFrom(21, ipcChannels.bootstrapRetry, ["hosts"])

    expect(result).toEqual({ hosts: { value: [], health: { store: "hosts", status: "recovered", source: "backup" } } })
    expect(harness.hosts.loadWithStatus).toHaveBeenCalledWith({ consumeHealth: true })
    expect(harness.settings.loadWithStatus).not.toHaveBeenCalled()
    expect(harness.history.loadWithStatus).not.toHaveBeenCalled()
    expect(harness.windows.loadWorkspaceWithStatus).not.toHaveBeenCalled()
    expect(harness.credentials.health).not.toHaveBeenCalled()
    expect(harness.hostKeys.health).not.toHaveBeenCalled()
  })

  it("rechecks the owner before returning a bootstrap retry", async () => {
    const harness = createHarness()
    let resolveHosts!: (result: unknown) => void
    harness.hosts.loadWithStatus.mockReturnValue(new Promise((resolve) => { resolveHosts = resolve }))
    harness.windows.currentOwnerForWebContents
      .mockReturnValueOnce(owner21)
      .mockReturnValue(owner21Generation2)
    registerIpcHandlers(harness.dependencies)

    const retrying = invokeFrom(21, ipcChannels.bootstrapRetry, ["hosts"])
    await flush()
    resolveHosts({ status: "ok", value: [] })

    await expect(retrying).rejects.toThrow("Renderer owner was replaced")
  })

  it.each([
    [[], "non-empty"],
    [["hosts", "hosts"], "duplicate"],
    [["unknown"], "known"],
    [["settings", "history", "workspace", "hosts", "credentials", "hostKeys", "settings"], "six"]
  ])("rejects retry resources that are not a %s subset", async (resources, reason) => {
    const harness = createHarness()
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(21, ipcChannels.bootstrapRetry, resources)).rejects.toThrow(reason)
  })
})

function invokeFrom(ownerWebContentsId: number, channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = electron.handlers.get(channel)
  if (!handler) throw new Error(`IPC handler was not registered: ${channel}`)
  return Promise.resolve().then(() => handler({ sender: { id: ownerWebContentsId } }, ...args))
}

function createHarness() {
  let sessionListener: ((event: unknown) => void) | undefined
  const owner = createWindow(21)
  const other = createWindow(22)
  const sessions = {
    onEvent: vi.fn((listener: (event: unknown) => void) => {
      sessionListener = listener
      return vi.fn()
    }),
    ownerForSession: vi.fn(),
    open: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    ackOutput: vi.fn(),
    reconnect: vi.fn(),
    cancelReconnect: vi.fn(),
    close: vi.fn(),
    exec: vi.fn(),
    releaseOwner: vi.fn(),
    beginRestore: vi.fn(),
    completeRestore: vi.fn()
  }
  const connections = {
    ownerForConnection: vi.fn(),
    releaseOwner: vi.fn(),
    updateRetryPolicy: vi.fn(),
    testConnection: vi.fn()
  }
  const settings = { get: vi.fn(), update: vi.fn(), loadWithStatus: vi.fn() }
  const history = { add: vi.fn(), list: vi.fn(), clear: vi.fn(), loadWithStatus: vi.fn() }
  const credentials = {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    health: vi.fn(),
    protectionStatus: vi.fn(),
    enableVault: vi.fn(),
    unlockVault: vi.fn(),
    lockVault: vi.fn(),
    disableVault: vi.fn()
  }
  const hostKeys = { health: vi.fn(), entries: vi.fn(), auditEntries: vi.fn(), remove: vi.fn() }
  const diagnostics = { snapshot: vi.fn(() => [{ at: "2026-08-28T12:00:00.000Z", category: "session", action: "connected" }]) }
  const mutations = { run: vi.fn(async <T>(operation: () => Promise<T> | T) => operation()) }
  const configuration = { preview: vi.fn(), import: vi.fn() }
  const createConfigurationExportSnapshot = vi.fn()
  const hosts = { list: vi.fn(), save: vi.fn(), saveRedacted: vi.fn(), duplicate: vi.fn(), setFavorite: vi.fn(), remove: vi.fn(), importOpenSSHConfig: vi.fn(), loadWithStatus: vi.fn() }
  const forwardingProfiles = {
    list: vi.fn(async (_hostId?: string) => [] as ForwardingProfile[]),
    get: vi.fn(async (_id: string) => undefined as ForwardingProfile | undefined),
    save: vi.fn(),
    remove: vi.fn(),
    replace: vi.fn(),
    flush: vi.fn()
  }
  const currentOwnerForWebContents = vi.fn((id: number) => id === owner21.webContentsId ? owner21 : id === owner22.webContentsId ? owner22 : undefined)
  const windowForWebContents = vi.fn((id: number) => id === 21 ? owner : id === 22 ? other : undefined)
  const sendToOwner = vi.fn((targetOwner: RuntimeOwner, channel: string, ...args: unknown[]): boolean => {
    const currentOwner = currentOwnerForWebContents(targetOwner.webContentsId)
    if (!currentOwner || !sameRuntimeOwner(currentOwner, targetOwner)) return false
    const target = windowForWebContents(targetOwner.webContentsId)
    if (!target || target.isDestroyed()) return false
    target.webContents.send(channel, ...args)
    return true
  })
  const windows = {
    currentOwnerForWebContents,
    windowForWebContents,
    sendToOwner,
    workspaceForWebContents: vi.fn(),
    saveWorkspace: vi.fn(),
    loadWorkspace: vi.fn(),
    loadWorkspaceWithStatus: vi.fn()
  }
  const forwarding = { start: vi.fn(), stop: vi.fn(), list: vi.fn(() => [] as ForwardingInfo[]), get: vi.fn(), resume: vi.fn(), ownerForForwarding: vi.fn(), releaseOwner: vi.fn(), onEvent: vi.fn(() => vi.fn()), startProfile: vi.fn() }
  const dependencies = {
    hosts,
    credentials,
    hostKeys,
    sessions,
    connections,
    ports: { scan: vi.fn() },
    forwarding,
    forwardingProfiles,
    history,
    settings,
    diagnostics,
    mutations,
    configuration,
    createConfigurationExportSnapshot,
    diagnosticsAppVersion: "0.3.1",
    diagnosticsBuildChannel: "release",
    diagnosticsRuntimeMode: "packaged",
    snapshots: { load: vi.fn(), saveWindow: vi.fn(), removeWindow: vi.fn(), flush: vi.fn() },
    windows,
    createDuplicateWindow: vi.fn()
  } as unknown as IpcDependencies
  return {
    dependencies,
    hosts,
    forwardingProfiles,
    forwarding,
    windows,
    owner,
    other,
    sessions,
    connections,
    settings,
    history,
    credentials,
    hostKeys,
    diagnostics,
    mutations,
    configuration,
    createConfigurationExportSnapshot,
    ports: dependencies.ports,
    emitSession(event: unknown): void {
      if (!sessionListener) throw new Error("Session listener was not registered")
      sessionListener(event)
    }
  }
}

function configurationSnapshot() {
  return {
    createdAt: "2026-09-08T00:00:00.000Z",
    hosts: [{
      id: "host-a",
      name: "Host A",
      host: "server.example",
      port: 22,
      username: "root",
      authMethod: "password",
      favorite: false,
      notes: ""
    }],
    settings: settingsSnapshot(),
    hostKeys: [],
    credentials: [{ hostId: "host-a", kind: "password", value: "password-value" }]
  }
}

function settingsSnapshot(): AppSettings {
  return {
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
}

function testForwardingProfile(): ForwardingProfile {
  return {
    id: "profile-1",
    hostId: "host-a",
    name: "Web console",
    description: "Console",
    localAddress: "127.0.0.1",
    localPort: 18080,
    remoteAddress: "127.0.0.1",
    remotePort: 8080,
    autoStart: false,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z"
  }
}

function createWindow(id: number) {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: { id, send: vi.fn() }
  }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
