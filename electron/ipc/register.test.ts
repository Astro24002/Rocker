import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile, rm } from "node:fs/promises"
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
import type { HostProfile } from "../storage/types"

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
    const identityFile = "/private/user-data/.ssh/id_ed25519"
    harness.hosts.list.mockResolvedValue([{
      id: "host-a",
      name: "Host A",
      host: "127.0.0.1",
      port: 22,
      username: "rock",
      authMethod: "privateKey",
      identityFile,
      favorite: false,
      notes: ""
    }])
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

    expect(harness.hosts.save).toHaveBeenCalledWith(expect.objectContaining({
      id: "host-a",
      identityFile,
      favorite: true
    }))
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
    updateRetryPolicy: vi.fn()
  }
  const settings = { get: vi.fn(), update: vi.fn(), loadWithStatus: vi.fn() }
  const history = { add: vi.fn(), list: vi.fn(), clear: vi.fn(), loadWithStatus: vi.fn() }
  const credentials = { get: vi.fn(), set: vi.fn(), clear: vi.fn(), health: vi.fn() }
  const hostKeys = { health: vi.fn() }
  const diagnostics = { snapshot: vi.fn(() => [{ at: "2026-08-28T12:00:00.000Z", category: "session", action: "connected" }]) }
  const hosts = { list: vi.fn(), save: vi.fn(), remove: vi.fn(), importOpenSSHConfig: vi.fn(), loadWithStatus: vi.fn() }
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
  const dependencies = {
    hosts,
    credentials,
    hostKeys,
    sessions,
    connections,
    ports: { scan: vi.fn() },
    forwarding: { start: vi.fn(), stop: vi.fn(), list: vi.fn(), get: vi.fn(), resume: vi.fn(), ownerForForwarding: vi.fn(), releaseOwner: vi.fn() },
    monitoring: { sample: vi.fn(), clear: vi.fn() },
    history,
    settings,
    diagnostics,
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
    ports: dependencies.ports,
    emitSession(event: unknown): void {
      if (!sessionListener) throw new Error("Session listener was not registered")
      sessionListener(event)
    }
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
