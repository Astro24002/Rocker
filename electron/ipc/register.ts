import { BrowserWindow, dialog, ipcMain, shell } from "electron"
import { readFile } from "node:fs/promises"
import type { CredentialVault } from "../storage/credentials"
import type { HostStore } from "../storage/host-store"
import type { HostProfile } from "../storage/types"
import type { SshManager } from "../ssh/ssh-manager"
import type { ForwardingManager } from "../ports/forwarding-manager"
import type { PortService } from "../ports/port-service"
import type { ForwardingSpec } from "../ports/types"
import type { LinuxMetricsSampler } from "../monitoring/linux-metrics"
import type { HistoryStore } from "../storage/history-store"
import type { SettingsStore } from "../storage/settings-store"
import type { AppSettings } from "../storage/types"
import { randomUUID } from "node:crypto"
import { ipcChannels, type HostSaveRequest, type SessionOpenRequest } from "./bridge-contract"
import { isValidSessionId, validateDimensions, validateTerminalData } from "./validation"

export interface IpcDependencies {
  hosts: HostStore
  credentials: CredentialVault
  sessions: SshManager
  ports: PortService
  forwarding: ForwardingManager
  monitoring: LinuxMetricsSampler
  history: HistoryStore
  settings: SettingsStore
  createDuplicateWindow?(hostId: string): Promise<void>
  getWindows?(): BrowserWindow[]
}

export function registerIpcHandlers(window: BrowserWindow, dependencies: IpcDependencies): () => void {
  ipcMain.handle(ipcChannels.hostsList, () => dependencies.hosts.list())
  ipcMain.handle(ipcChannels.hostsSave, async (_event, request: HostSaveRequest) => {
    assertHostProfile(request?.profile)
    await dependencies.hosts.save(request.profile)
    if (request.credentials?.password) {
      await dependencies.credentials.set(request.profile.id, "password", request.credentials.password)
    }
    if (request.credentials?.passphrase) {
      await dependencies.credentials.set(request.profile.id, "passphrase", request.credentials.passphrase)
    }
  })
  ipcMain.handle(ipcChannels.hostsRemove, async (_event, id: unknown) => {
    assertId(id)
    await dependencies.hosts.remove(id)
    await Promise.all([
      dependencies.credentials.clear(id, "password"),
      dependencies.credentials.clear(id, "passphrase")
    ])
  })
  ipcMain.handle(ipcChannels.hostsImport, async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "Import SSH config",
      properties: ["openFile"],
      defaultPath: ".ssh/config"
    })
    if (result.canceled || !result.filePaths[0]) return []
    return dependencies.hosts.importOpenSSHConfig(await readFile(result.filePaths[0], "utf8"))
  })
  ipcMain.handle(ipcChannels.sessionOpen, async (event, request: SessionOpenRequest) => {
    if (!request || typeof request.hostId !== "string" || !validateDimensions(request.cols, request.rows)) {
      throw new Error("Invalid session request")
    }
    const host = (await dependencies.hosts.list()).find((candidate) => candidate.id === request.hostId)
    if (!host) throw new Error("Host profile not found")
    try {
      const session = await dependencies.sessions.open({
        hostId: host.id,
        host: host.host,
        port: host.port,
        username: host.username,
        authMethod: host.authMethod,
        identityFile: host.identityFile,
        password: await dependencies.credentials.get(host.id, "password"),
        passphrase: await dependencies.credentials.get(host.id, "passphrase"),
        cols: request.cols,
        rows: request.rows
      }, { windowId: event.sender.id, forceNewConnection: request.forceNewConnection })
      await dependencies.history.add({ id: randomUUID(), hostId: host.id, connectedAt: new Date().toISOString(), durationMs: 0, outcome: "connected" })
      return session
    } catch (error) {
      await dependencies.history.add({ id: randomUUID(), hostId: host.id, connectedAt: new Date().toISOString(), durationMs: 0, outcome: "failed" })
      throw error
    }
  })
  ipcMain.handle(ipcChannels.sessionWrite, (_event, sessionId: unknown, data: unknown) => {
    if (!isValidSessionId(sessionId) || !validateTerminalData(data)) throw new Error("Invalid terminal input")
    dependencies.sessions.write(sessionId, data)
  })
  ipcMain.handle(ipcChannels.sessionResize, (_event, sessionId: unknown, cols: unknown, rows: unknown) => {
    if (!isValidSessionId(sessionId) || typeof cols !== "number" || typeof rows !== "number" || !validateDimensions(cols, rows)) {
      throw new Error("Invalid resize request")
    }
    dependencies.sessions.resize(sessionId, cols, rows)
  })
  ipcMain.handle(ipcChannels.sessionClose, (_event, sessionId: unknown) => {
    if (!isValidSessionId(sessionId)) throw new Error("Invalid session identifier")
    return dependencies.sessions.close(sessionId)
  })
  ipcMain.handle(ipcChannels.sessionReconnect, (_event, sessionId: unknown) => {
    if (!isValidSessionId(sessionId)) throw new Error("Invalid session identifier")
    return dependencies.sessions.reconnect(sessionId)
  })
  ipcMain.handle(ipcChannels.sessionDuplicateWindow, (_event, hostId: unknown) => {
    if (typeof hostId !== "string" || hostId.length < 1 || hostId.length > 128) throw new Error("Invalid host identifier")
    if (!dependencies.createDuplicateWindow) throw new Error("Window duplication is unavailable")
    return dependencies.createDuplicateWindow(hostId)
  })
  ipcMain.handle(ipcChannels.portsScan, (_event, sessionId: unknown) => {
    if (!isValidSessionId(sessionId)) throw new Error("Invalid session identifier")
    return dependencies.ports.scan(sessionId)
  })
  ipcMain.handle(ipcChannels.portsStart, (_event, sessionId: unknown, spec: ForwardingSpec) => {
    if (!isValidSessionId(sessionId) || !isValidForwardingSpec(spec)) throw new Error("Invalid forwarding request")
    return dependencies.forwarding.start(sessionId, spec)
  })
  ipcMain.handle(ipcChannels.portsStop, (_event, forwardingId: unknown) => {
    assertId(forwardingId)
    return dependencies.forwarding.stop(forwardingId)
  })
  ipcMain.handle(ipcChannels.portsList, () => dependencies.forwarding.list())
  ipcMain.handle(ipcChannels.portsOpenAddress, async (_event, forwardingId: unknown) => {
    assertId(forwardingId)
    const forwarding = dependencies.forwarding.get(forwardingId)
    if (!forwarding || forwarding.status !== "forwarding") throw new Error("Forwarding is not active")
    const host = forwarding.localAddress.includes(":") ? `[${forwarding.localAddress}]` : forwarding.localAddress
    await shell.openExternal(`http://${host}:${forwarding.localPort}`)
  })
  ipcMain.handle(ipcChannels.monitorSample, (_event, sessionId: unknown) => {
    if (!isValidSessionId(sessionId)) throw new Error("Invalid session identifier")
    return dependencies.monitoring.sample(sessionId)
  })
  ipcMain.handle(ipcChannels.historyList, () => dependencies.history.list())
  ipcMain.handle(ipcChannels.historyClear, () => dependencies.history.clear())
  ipcMain.handle(ipcChannels.settingsGet, () => dependencies.settings.get())
  ipcMain.handle(ipcChannels.settingsUpdate, (_event, update: Partial<AppSettings>) => dependencies.settings.update(update ?? {}))
  ipcMain.handle(ipcChannels.windowMinimize, (event) => { BrowserWindow.fromWebContents(event.sender)?.minimize() })
  ipcMain.handle(ipcChannels.windowToggleMaximize, (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (target?.isMaximized()) target.unmaximize()
    else target?.maximize()
  })
  ipcMain.handle(ipcChannels.windowClose, (event) => BrowserWindow.fromWebContents(event.sender)?.close())

  const unsubscribe = dependencies.sessions.onEvent((event) => {
    for (const target of dependencies.getWindows?.() ?? [window]) {
      if (!target.isDestroyed()) target.webContents.send(ipcChannels.sessionEvent, event)
    }
    if (event.kind === "state" && event.state === "closed") {
      if (!dependencies.sessions.hasSessionsForConnection(event.connectionId)) {
        void dependencies.forwarding.stopForConnection(event.connectionId)
      }
      dependencies.monitoring.clear(event.sessionId)
    }
  })
  return () => {
    unsubscribe()
    for (const channel of Object.values(ipcChannels)) {
      if (channel !== ipcChannels.sessionEvent && channel !== ipcChannels.sessionLaunch) ipcMain.removeHandler(channel)
    }
  }
}

function assertHostProfile(profile: HostProfile | undefined): asserts profile is HostProfile {
  if (!profile || !profile.id || !profile.name.trim() || !profile.host.trim() || !profile.username.trim()) {
    throw new Error("Host name, address, and username are required")
  }
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) {
    throw new Error("Host port must be between 1 and 65535")
  }
  if (!(["password", "privateKey", "agent"] as const).includes(profile.authMethod)) {
    throw new Error("Unsupported authentication method")
  }
}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length < 1 || id.length > 128) throw new Error("Invalid identifier")
}

function isValidForwardingSpec(spec: ForwardingSpec | undefined): spec is ForwardingSpec {
  return Boolean(spec) && typeof spec?.localAddress === "string" && spec.localAddress.length <= 64 &&
    typeof spec.remoteAddress === "string" && spec.remoteAddress.length <= 255 &&
    typeof spec.localPort === "number" && Number.isInteger(spec.localPort) && spec.localPort >= 0 && spec.localPort <= 65535 &&
    typeof spec.remotePort === "number" && Number.isInteger(spec.remotePort) && spec.remotePort >= 1 && spec.remotePort <= 65535
}
