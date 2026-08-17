import { dialog, ipcMain, type BrowserWindow } from "electron"
import { readFile } from "node:fs/promises"
import type { CredentialVault } from "../storage/credentials"
import type { HostStore } from "../storage/host-store"
import type { HostProfile } from "../storage/types"
import type { SshManager } from "../ssh/ssh-manager"
import { ipcChannels, type HostSaveRequest, type SessionOpenRequest } from "./bridge-contract"
import { isValidSessionId, validateDimensions, validateTerminalData } from "./validation"

export interface IpcDependencies {
  hosts: HostStore
  credentials: CredentialVault
  sessions: SshManager
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
  ipcMain.handle(ipcChannels.sessionOpen, async (_event, request: SessionOpenRequest) => {
    if (!request || typeof request.hostId !== "string" || !validateDimensions(request.cols, request.rows)) {
      throw new Error("Invalid session request")
    }
    const host = (await dependencies.hosts.list()).find((candidate) => candidate.id === request.hostId)
    if (!host) throw new Error("Host profile not found")
    return dependencies.sessions.open({
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
    })
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

  const unsubscribe = dependencies.sessions.onEvent((event) => {
    if (!window.isDestroyed()) window.webContents.send(ipcChannels.sessionEvent, event)
  })
  return () => {
    unsubscribe()
    for (const channel of Object.values(ipcChannels)) {
      if (channel !== ipcChannels.sessionEvent) ipcMain.removeHandler(channel)
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
