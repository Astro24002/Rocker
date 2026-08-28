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

const sessionId = "11111111-1111-4111-8111-111111111111"
const connectionId = "22222222-2222-4222-8222-222222222222"

describe("registerIpcHandlers", () => {
  afterEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it("routes output only to the session owner", () => {
    const harness = createHarness()
    registerIpcHandlers(harness.dependencies)

    harness.emitSession({
      ownerWebContentsId: 21,
      event: {
        kind: "output",
        packet: { sessionId, channelGeneration: 1, sequence: 1, bytes: Uint8Array.of(0x61) }
      }
    })

    expect(harness.owner.webContents.send).toHaveBeenCalledWith(ipcChannels.sessionEvent, expect.objectContaining({ kind: "output" }))
    expect(harness.other.webContents.send).not.toHaveBeenCalled()
  })

  it("rejects a renderer request for a session owned by another window", async () => {
    const harness = createHarness()
    harness.sessions.ownerForSession.mockReturnValue(21)
    registerIpcHandlers(harness.dependencies)

    await expect(invokeFrom(22, ipcChannels.sessionClose, sessionId)).rejects.toThrow("Session is owned by another window")
    expect(harness.sessions.close).not.toHaveBeenCalled()
  })

  it("rejects a port scan for a connection owned by another window", async () => {
    const harness = createHarness()
    harness.connections.ownerForConnection.mockReturnValue(21)
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
      const payload = JSON.parse(await readFile(target, "utf8")) as { schemaVersion: number; events: unknown[] }
      expect(payload.schemaVersion).toBe(1)
      expect(payload.events).toHaveLength(1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
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
  const settings = { get: vi.fn(), update: vi.fn() }
  const diagnostics = { snapshot: vi.fn(() => [{ at: "2026-08-28T12:00:00.000Z", category: "session", action: "connected" }]) }
  const dependencies = {
    hosts: { list: vi.fn(), save: vi.fn(), remove: vi.fn(), importOpenSSHConfig: vi.fn() },
    credentials: { get: vi.fn(), set: vi.fn(), clear: vi.fn() },
    sessions,
    connections,
    ports: { scan: vi.fn() },
    forwarding: { start: vi.fn(), stop: vi.fn(), list: vi.fn(), get: vi.fn(), resume: vi.fn(), ownerForForwarding: vi.fn(), releaseOwner: vi.fn() },
    monitoring: { sample: vi.fn(), clear: vi.fn() },
    history: { add: vi.fn(), list: vi.fn(), clear: vi.fn() },
    settings,
    diagnostics,
    diagnosticsAppVersion: "0.3.1",
    snapshots: { load: vi.fn(), saveWindow: vi.fn(), removeWindow: vi.fn(), flush: vi.fn() },
    windows: {
      windowForWebContents: vi.fn((id: number) => id === 21 ? owner : id === 22 ? other : undefined),
      workspaceForWebContents: vi.fn(),
      saveWorkspace: vi.fn(),
      loadWorkspace: vi.fn()
    },
    createDuplicateWindow: vi.fn()
  } as unknown as IpcDependencies
  return {
    dependencies,
    owner,
    other,
    sessions,
    connections,
    settings,
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
