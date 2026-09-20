import { randomUUID } from "node:crypto"
import { chmod, lstat, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { BrowserWindow, dialog, ipcMain, shell } from "electron"
import type { OpenDialogOptions } from "electron"
import type { DiagnosticLogger } from "../diagnostics/diagnostic-logger"
import type { DiagnosticRuntimeMetadata } from "../diagnostics/diagnostic-types"
import { sameRuntimeOwner, type RuntimeOwner } from "../runtime/owner"
import { diagnosticFileName, writeDiagnosticExport } from "../diagnostics/diagnostic-export"
import type { ForwardingManager } from "../ports/forwarding-manager"
import type { PortService } from "../ports/port-service"
import type { ForwardingProfileRequest, ForwardingProfileView, ForwardingSpec } from "../ports/types"
import type { CredentialVault } from "../storage/credentials"
import type { ForwardingProfileStore } from "../storage/forwarding-profile-store"
import type { SerializedOperationQueue } from "../storage/operation-queue"
import {
  ConfigBundleService,
  exportEncryptedBundle,
  exportTemplate,
  type ConflictResolution,
  type ExportSnapshot
} from "../storage/config-bundle"
import type { HistoryStore } from "../storage/history-store"
import type { HostStore } from "../storage/host-store"
import type { SettingsStore } from "../storage/settings-store"
import type {
  LoadResult,
  StorageFailureReason,
  StorageHealth,
  StorageKind
} from "../storage/storage-result"
import type {
  AppSettings,
  HostProfile,
  StoredTerminalLayout,
  StoredWorkspaceSession
} from "../storage/types"
import type { SshConnectionManager } from "../ssh/connection-manager"
import type { HostKeyAuditRecord, StoredHostKeyRecord } from "../ssh/host-keys"
import type { TerminalSessionManager } from "../ssh/terminal-session-manager"
import type { SftpManager } from "../sftp/sftp-manager"
import type { SftpDirectory, SftpRuntimeEvent } from "../sftp/types"
import type { WorkspaceWindowManager } from "../windows/workspace-window-manager"
import {
  type AppBootstrapSnapshot,
  type BootstrapResource,
  type BootstrapHostProfile,
  type BootstrapResourceName,
  ipcChannels,
  type HostSaveProfile,
  type HostKeyInventorySnapshot,
  type HostKeyRemovalRequest,
  type HostSaveRequest,
  type SessionLaunchRequest,
  type SessionOpenRequest,
  type WorkspaceSaveRequest
} from "./bridge-contract"
import { isValidSessionId, validateDimensions, validateTerminalData } from "./validation"

export interface IpcDependencies {
  hosts: HostStore
  credentials: CredentialVault
  hostKeys: HostKeyManagementStore
  sessions: TerminalSessionManager
  connections: SshConnectionManager
  ports: PortService
  forwarding: ForwardingManager
  sftp: SftpManager
  forwardingProfiles?: Pick<ForwardingProfileStore, "list" | "get" | "save" | "remove" | "replace" | "flush">
  history: HistoryStore
  settings: SettingsStore
  diagnostics: DiagnosticLogger
  mutations: SerializedOperationQueue
  configuration: Pick<ConfigBundleService, "preview" | "import">
  createConfigurationExportSnapshot(includeCredentials: boolean): Promise<ExportSnapshot>
  diagnosticsAppVersion?: string
  diagnosticsBuildChannel?: DiagnosticRuntimeMetadata["buildChannel"]
  diagnosticsRuntimeMode?: DiagnosticRuntimeMetadata["runtimeMode"]
  windows: WorkspaceWindowManager
  createDuplicateWindow?(request: SessionLaunchRequest): Promise<void>
}

interface BootstrapHealthStore {
  health(options?: { consumeHealth?: boolean }): Promise<StorageHealth>
}

interface HostKeyManagementStore extends BootstrapHealthStore {
  entries(): Promise<StoredHostKeyRecord[]>
  auditEntries(): Promise<HostKeyAuditRecord[]>
  remove(host: string, port: number, expectedFingerprint: string): Promise<void>
}

interface PendingConfigurationImport {
  owner: RuntimeOwner
  bytes: Uint8Array
  inFlight: boolean
}

const bootstrapResourceNames: BootstrapResourceName[] = [
  "settings",
  "history",
  "workspace",
  "hosts",
  "credentials",
  "hostKeys"
]
const maximumPendingConfigurationImports = 8
const maximumConfigurationImportBytes = 12 * 1024 * 1024

export function registerIpcHandlers(dependencies: IpcDependencies): () => void {
  let hostSaveQueue = Promise.resolve()
  const pendingConfigurationImports = new Map<string, PendingConfigurationImport>()
  ipcMain.handle(ipcChannels.hostsList, () => dependencies.hosts.list())
  ipcMain.handle(ipcChannels.hostsSave, async (_event, request: HostSaveRequest) => {
    assertHostProfile(request?.profile)
    const save = hostSaveQueue.then(() => dependencies.mutations.run(async () => {
      if (isRedactedHostProfile(request.profile)) await dependencies.hosts.saveRedacted(request.profile)
      else await dependencies.hosts.save(request.profile)
      if (request.credentials?.password) await dependencies.credentials.set(request.profile.id, "password", request.credentials.password)
      if (request.credentials?.passphrase) await dependencies.credentials.set(request.profile.id, "passphrase", request.credentials.passphrase)
    }))
    hostSaveQueue = save.then(() => undefined, () => undefined)
    await save
  })
  ipcMain.handle(ipcChannels.hostsDuplicate, async (_event, id: unknown) => {
    assertId(id, "host")
    return dependencies.mutations.run(() => dependencies.hosts.duplicate(id))
  })
  ipcMain.handle(ipcChannels.hostsSetFavorite, async (_event, id: unknown, favorite: unknown) => {
    assertId(id, "host")
    if (typeof favorite !== "boolean") throw new Error("Invalid favorite setting")
    return dependencies.mutations.run(() => dependencies.hosts.setFavorite(id, favorite))
  })
  ipcMain.handle(ipcChannels.hostsRemove, async (_event, id: unknown) => {
    assertId(id, "host")
    await dependencies.mutations.run(async () => {
      const profiles = dependencies.forwardingProfiles ? await dependencies.forwardingProfiles.list(id) : []
      const runtimes = dependencies.forwarding.list().filter((runtime) => runtime.hostId === id || profiles.some((profile) => profile.id === runtime.profileId))
      await Promise.all(runtimes.map((runtime) => dependencies.forwarding.stop(runtime.id)))
      if (dependencies.forwardingProfiles) {
        await Promise.all(profiles.map((profile) => dependencies.forwardingProfiles!.remove(profile.id)))
      }
      await dependencies.hosts.remove(id)
      await Promise.all([
        dependencies.credentials.clear(id, "password"),
        dependencies.credentials.clear(id, "passphrase")
      ])
    })
  })
  ipcMain.handle(ipcChannels.hostsImport, async (event) => {
    const options: OpenDialogOptions = {
      title: "Import SSH config",
      properties: ["openFile"],
      defaultPath: ".ssh/config"
    }
    const target = BrowserWindow.fromWebContents(event.sender)
    const result = target
      ? await dialog.showOpenDialog(target, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return []
    const source = await readFile(result.filePaths[0], "utf8")
    return dependencies.mutations.run(() => dependencies.hosts.importOpenSSHConfig(source))
  })
  ipcMain.handle(ipcChannels.hostsTestConnection, async (event, id: unknown) => {
    assertId(id, "host")
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    const host = (await dependencies.hosts.list()).find((candidate) => candidate.id === id)
    if (!host) throw new Error("Host profile not found")
    assertCurrentOwner(dependencies, owner)
    const result = await dependencies.connections.testConnection({ hostId: id, owner })
    assertCurrentOwner(dependencies, owner)
    return result
  })

  ipcMain.handle(ipcChannels.hostKeysList, async (event): Promise<HostKeyInventorySnapshot> => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertCurrentOwner(dependencies, owner)
    const [entries, history] = await Promise.all([
      dependencies.hostKeys.entries(),
      dependencies.hostKeys.auditEntries()
    ])
    assertCurrentOwner(dependencies, owner)
    return {
      entries: entries.map((entry) => ({ ...entry })),
      history: history.map((entry) => ({ ...entry }))
    }
  })
  ipcMain.handle(ipcChannels.hostKeysRemove, async (event, value: unknown): Promise<void> => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    const request = normalizeHostKeyRemovalRequest(value)
    await dependencies.mutations.run(async () => {
      assertCurrentOwner(dependencies, owner)
      await dependencies.hostKeys.remove(request.host, request.port, request.fingerprint)
    })
    assertCurrentOwner(dependencies, owner)
  })

  ipcMain.handle(ipcChannels.sessionOpen, async (event, value: unknown) => {
    const request = normalizeSessionOpenRequest(value)
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    const host = (await dependencies.hosts.list()).find((candidate) => candidate.id === request.hostId)
    if (!host) throw new Error("Host profile not found")
    if (!sameRuntimeOwner(currentOwnerForWebContents(dependencies, event.sender.id), owner)) {
      throw new Error("Renderer owner was replaced")
    }
    try {
      const session = await dependencies.sessions.open({ ...request, owner })
      await dependencies.history.add({ id: randomUUID(), hostId: host.id, connectedAt: new Date().toISOString(), durationMs: 0, outcome: "connected" })
      return session
    } catch (error) {
      await dependencies.history.add({ id: randomUUID(), hostId: host.id, connectedAt: new Date().toISOString(), durationMs: 0, outcome: "failed" })
      throw error
    }
  })
  ipcMain.handle(ipcChannels.sessionWrite, (event, sessionId: unknown, channelGeneration: unknown, data: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertOwnedSession(dependencies, owner, sessionId)
    if (!isValidGeneration(channelGeneration) || !validateTerminalData(data)) throw new Error("Invalid terminal input")
    dependencies.sessions.write(sessionId, channelGeneration, data)
  })
  ipcMain.handle(ipcChannels.sessionResize, (event, sessionId: unknown, channelGeneration: unknown, cols: unknown, rows: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertOwnedSession(dependencies, owner, sessionId)
    if (!isValidGeneration(channelGeneration)) throw new Error("Invalid resize request")
    dependencies.sessions.resize(sessionId, channelGeneration, normalizeDimensions(cols, rows))
  })
  ipcMain.handle(ipcChannels.sessionAckOutput, (event, sessionId: unknown, channelGeneration: unknown, sequence: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertOwnedSession(dependencies, owner, sessionId)
    if (!isValidGeneration(channelGeneration) || !isValidSequence(sequence)) throw new Error("Invalid terminal output acknowledgement")
    dependencies.sessions.ackOutput(sessionId, channelGeneration, sequence)
  })
  ipcMain.handle(ipcChannels.sessionReconnect, async (event, sessionId: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertOwnedSession(dependencies, owner, sessionId)
    await dependencies.sessions.reconnect(sessionId)
  })
  ipcMain.handle(ipcChannels.sessionCancelReconnect, (event, sessionId: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertOwnedSession(dependencies, owner, sessionId)
    dependencies.sessions.cancelReconnect(sessionId)
  })
  ipcMain.handle(ipcChannels.sessionClose, async (event, sessionId: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertOwnedSession(dependencies, owner, sessionId)
    await dependencies.sessions.close(sessionId)
  })
  ipcMain.handle(ipcChannels.sessionBeginRestore, (event, activeSessionId: unknown) => {
    if (!isValidSessionId(activeSessionId)) throw new Error("Invalid session identifier")
    dependencies.sessions.beginRestore(currentOwnerForWebContents(dependencies, event.sender.id), activeSessionId)
  })
  ipcMain.handle(ipcChannels.sessionCompleteRestore, (event) => dependencies.sessions.completeRestore(currentOwnerForWebContents(dependencies, event.sender.id)))
  ipcMain.handle(ipcChannels.sessionDuplicateWindow, (event, request: unknown) => {
    currentOwnerForWebContents(dependencies, event.sender.id)
    if (!dependencies.createDuplicateWindow) throw new Error("Window duplication is unavailable")
    return dependencies.createDuplicateWindow(normalizeSessionLaunchRequest(request))
  })

  ipcMain.handle(ipcChannels.sftpListLocal, async (event, path: unknown) => {
    currentOwnerForWebContents(dependencies, event.sender.id)
    if (path !== undefined && typeof path !== "string") throw new Error("Invalid local path")
    return listLocalDirectory(path)
  })
  ipcMain.handle(ipcChannels.sftpOpen, async (event, workspaceId: unknown, hostId: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(workspaceId, "SFTP workspace")
    assertId(hostId, "host")
    await requireHost(dependencies, hostId)
    assertCurrentOwner(dependencies, owner)
    return dependencies.sftp.open(workspaceId, hostId, owner)
  })
  ipcMain.handle(ipcChannels.sftpClose, async (event, workspaceId: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(workspaceId, "SFTP workspace")
    await dependencies.sftp.close(workspaceId, owner)
  })
  ipcMain.handle(ipcChannels.sftpList, async (event, workspaceId: unknown, path: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(workspaceId, "SFTP workspace")
    if (typeof path !== "string") throw new Error("Invalid remote path")
    return dependencies.sftp.list(workspaceId, path, owner)
  })
  ipcMain.handle(ipcChannels.sftpMkdir, async (event, workspaceId: unknown, path: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(workspaceId, "SFTP workspace")
    if (typeof path !== "string") throw new Error("Invalid remote path")
    await dependencies.sftp.mkdir(workspaceId, path, owner)
  })
  ipcMain.handle(ipcChannels.sftpRename, async (event, workspaceId: unknown, path: unknown, nextPath: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(workspaceId, "SFTP workspace")
    if (typeof path !== "string" || typeof nextPath !== "string") throw new Error("Invalid SFTP rename request")
    await dependencies.sftp.rename(workspaceId, path, nextPath, owner)
  })
  ipcMain.handle(ipcChannels.sftpRemove, async (event, workspaceId: unknown, path: unknown, kind: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(workspaceId, "SFTP workspace")
    if (typeof path !== "string" || (kind !== "file" && kind !== "directory")) throw new Error("Invalid SFTP removal request")
    await dependencies.sftp.remove(workspaceId, path, kind, owner)
  })
  ipcMain.handle(ipcChannels.sftpChooseUpload, async (event, workspaceId: unknown, remoteDirectory: unknown, localPath: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(workspaceId, "SFTP workspace")
    if (typeof remoteDirectory !== "string") throw new Error("Invalid remote path")
    if (localPath !== undefined && typeof localPath !== "string") throw new Error("Invalid local path")
    if (typeof localPath === "string") {
      assertCurrentOwner(dependencies, owner)
      return dependencies.sftp.selectUpload(workspaceId, remoteDirectory, localPath, owner)
    }
    const target = BrowserWindow.fromWebContents(event.sender)
    const result = target
      ? await dialog.showOpenDialog(target, { title: "Upload file", properties: ["openFile"] })
      : await dialog.showOpenDialog({ title: "Upload file", properties: ["openFile"] })
    if (result.canceled || !result.filePaths[0]) return undefined
    assertCurrentOwner(dependencies, owner)
    return dependencies.sftp.selectUpload(workspaceId, remoteDirectory, result.filePaths[0], owner)
  })
  ipcMain.handle(ipcChannels.sftpChooseDownload, async (event, workspaceId: unknown, remotePath: unknown, suggestedName: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(workspaceId, "SFTP workspace")
    if (typeof remotePath !== "string" || typeof suggestedName !== "string") throw new Error("Invalid SFTP download request")
    const target = BrowserWindow.fromWebContents(event.sender)
    const result = target
      ? await dialog.showSaveDialog(target, { title: "Download file", defaultPath: suggestedName })
      : await dialog.showSaveDialog({ title: "Download file", defaultPath: suggestedName })
    if (result.canceled || !result.filePath) return undefined
    assertCurrentOwner(dependencies, owner)
    return dependencies.sftp.selectDownload(workspaceId, remotePath, result.filePath, owner)
  })
  ipcMain.handle(ipcChannels.sftpUpload, async (event, selectionId: unknown, overwrite: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(selectionId, "SFTP selection")
    if (overwrite !== undefined && typeof overwrite !== "boolean") throw new Error("Invalid overwrite setting")
    return dependencies.sftp.upload(selectionId, overwrite === true, owner)
  })
  ipcMain.handle(ipcChannels.sftpDownload, async (event, selectionId: unknown, overwrite: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(selectionId, "SFTP selection")
    if (overwrite !== undefined && typeof overwrite !== "boolean") throw new Error("Invalid overwrite setting")
    return dependencies.sftp.download(selectionId, overwrite === true, owner)
  })
  ipcMain.handle(ipcChannels.sftpListTransfers, async (event, workspaceId: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    if (workspaceId !== undefined) assertId(workspaceId, "SFTP workspace")
    return dependencies.sftp.listTransfers(owner, typeof workspaceId === "string" ? workspaceId : undefined)
  })
  ipcMain.handle(ipcChannels.sftpCancelTransfer, async (event, taskId: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(taskId, "SFTP transfer")
    await dependencies.sftp.cancelTransfer(taskId, owner)
  })
  ipcMain.handle(ipcChannels.sftpRetryTransfer, async (event, taskId: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(taskId, "SFTP transfer")
    return dependencies.sftp.retryTransfer(taskId, owner)
  })

  ipcMain.handle(ipcChannels.portsScan, (event, connectionId: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertOwnedConnection(dependencies, owner, connectionId)
    return dependencies.ports.scan(connectionId)
  })
  ipcMain.handle(ipcChannels.portsStart, (event, connectionId: unknown, spec: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertOwnedConnection(dependencies, owner, connectionId)
    if (!isValidForwardingSpec(spec)) throw new Error("Invalid forwarding request")
    return dependencies.forwarding.start(connectionId, spec, owner)
  })
  ipcMain.handle(ipcChannels.portsResume, async (event, forwardingId: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertOwnedForwarding(dependencies, owner, forwardingId)
    return dependencies.forwarding.resume(forwardingId)
  })
  ipcMain.handle(ipcChannels.portsStop, async (event, forwardingId: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertOwnedForwarding(dependencies, owner, forwardingId)
    await dependencies.forwarding.stop(forwardingId)
  })
  ipcMain.handle(ipcChannels.portsList, (event) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    return dependencies.forwarding
      .list()
      .filter((forwarding) => {
        const forwardingOwner = dependencies.forwarding.ownerForForwarding(forwarding.id)
        return forwardingOwner !== undefined && sameRuntimeOwner(forwardingOwner, owner)
      })
  })
  ipcMain.handle(ipcChannels.portsListOverview, async (event): Promise<ForwardingProfileView[]> => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertCurrentOwner(dependencies, owner)
    return listForwardingViews(dependencies, owner)
  })
  ipcMain.handle(ipcChannels.portsListForHost, async (event, hostId: unknown): Promise<ForwardingProfileView[]> => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(hostId, "host")
    await requireHost(dependencies, hostId)
    assertCurrentOwner(dependencies, owner)
    return listForwardingViews(dependencies, owner, hostId)
  })
  ipcMain.handle(ipcChannels.portsCreateProfile, async (event, hostId: unknown, value: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(hostId, "host")
    await requireHost(dependencies, hostId)
    const request = normalizeForwardingProfileRequest(value)
    const store = requireForwardingProfileStore(dependencies)
    const now = new Date().toISOString()
    const profile = {
      id: randomUUID(),
      hostId,
      ...request,
      createdAt: now,
      updatedAt: now
    }
    assertCurrentOwner(dependencies, owner)
    await dependencies.mutations.run(() => store.save(profile))
    return profile
  })
  ipcMain.handle(ipcChannels.portsUpdateProfile, async (event, profileId: unknown, value: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(profileId, "forwarding profile")
    const request = normalizeForwardingProfileRequest(value)
    const store = requireForwardingProfileStore(dependencies)
    const existing = await store.get(profileId)
    if (!existing) throw new Error("Forwarding profile was not found")
    await requireHost(dependencies, existing.hostId)
    const profile = { ...existing, ...request, updatedAt: new Date().toISOString() }
    assertCurrentOwner(dependencies, owner)
    await dependencies.mutations.run(() => store.save(profile))
    return profile
  })
  ipcMain.handle(ipcChannels.portsRemoveProfile, async (event, profileId: unknown): Promise<void> => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(profileId, "forwarding profile")
    const store = requireForwardingProfileStore(dependencies)
    const existing = await store.get(profileId)
    if (!existing) return
    assertCurrentOwner(dependencies, owner)
    await dependencies.mutations.run(async () => {
      await Promise.all(dependencies.forwarding.list().filter((runtime) => runtime.profileId === profileId).map((runtime) => dependencies.forwarding.stop(runtime.id)))
      await store.remove(profileId)
    })
  })
  ipcMain.handle(ipcChannels.portsStartProfile, async (event, profileId: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(profileId, "forwarding profile")
    const store = requireForwardingProfileStore(dependencies)
    const profile = await store.get(profileId)
    if (!profile) throw new Error("Forwarding profile was not found")
    await requireHost(dependencies, profile.hostId)
    assertCurrentOwner(dependencies, owner)
    return dependencies.forwarding.startProfile(profile, owner)
  })
  ipcMain.handle(ipcChannels.portsOpenAddress, async (event, forwardingId: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertOwnedForwarding(dependencies, owner, forwardingId)
    const forwarding = dependencies.forwarding.get(forwardingId)
    if (!forwarding || forwarding.status !== "forwarding") throw new Error("Forwarding is not active")
    const host = forwarding.localAddress.includes(":") ? `[${forwarding.localAddress}]` : forwarding.localAddress
    await shell.openExternal(`http://${host}:${forwarding.localPort}`)
  })

  ipcMain.handle(ipcChannels.workspaceLoad, (event) => dependencies.windows.loadWorkspace(currentOwnerForWebContents(dependencies, event.sender.id)))
  ipcMain.handle(ipcChannels.workspaceSave, (event, value: unknown) => {
    dependencies.windows.saveWorkspace(currentOwnerForWebContents(dependencies, event.sender.id), normalizeWorkspaceSaveRequest(value))
  })
  ipcMain.handle(ipcChannels.bootstrapLoad, async (event): Promise<AppBootstrapSnapshot> => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    const snapshot = await loadBootstrapSnapshot(dependencies, owner)
    assertCurrentOwner(dependencies, owner)
    return snapshot
  })
  ipcMain.handle(ipcChannels.bootstrapRetry, async (event, value: unknown): Promise<Partial<AppBootstrapSnapshot>> => {
    const resources = normalizeBootstrapRetryResources(value)
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    const selected = await Promise.allSettled(resources.map((resource) => loadBootstrapResource(dependencies, owner, resource)))
    assertCurrentOwner(dependencies, owner)
    const result: Partial<AppBootstrapSnapshot> = {}
    for (let index = 0; index < resources.length; index += 1) {
      const resource = resources[index]
      const settled = selected[index]
      result[resource] = settled.status === "fulfilled"
        ? settled.value as never
        : blockedResource(resourceStore(resource), settled.reason) as never
    }
    return result
  })
  ipcMain.handle(ipcChannels.historyList, () => dependencies.history.list())
  ipcMain.handle(ipcChannels.historyClear, () => dependencies.history.clear())
  ipcMain.handle(ipcChannels.settingsGet, () => dependencies.settings.get())
  ipcMain.handle(ipcChannels.settingsUpdate, async (_event, update: unknown) => {
    return dependencies.mutations.run(async () => {
      const next = await dependencies.settings.update(normalizeSettingsUpdate(update))
      dependencies.connections.updateRetryPolicy(next)
      return next
    })
  })
  ipcMain.handle(ipcChannels.diagnosticsExport, async (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: "Export Rocker diagnostics",
      defaultPath: diagnosticFileName(),
      filters: [{ name: "JSON files", extensions: ["json"] }]
    }
    const result = target
      ? await dialog.showSaveDialog(target, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true }
    try {
      await writeDiagnosticExport(result.filePath, {
        logger: dependencies.diagnostics,
        settings: await dependencies.settings.get(),
        appVersion: dependencies.diagnosticsAppVersion,
        platform: process.platform,
        arch: process.arch,
        buildChannel: dependencies.diagnosticsBuildChannel,
        runtimeMode: dependencies.diagnosticsRuntimeMode
      })
      return { canceled: false, path: result.filePath }
    } catch {
      throw new Error("Diagnostics export failed")
    }
  })
  ipcMain.handle(ipcChannels.configExportTemplate, async (event) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    const target = BrowserWindow.fromWebContents(event.sender)
    const result = target
      ? await dialog.showSaveDialog(target, configurationSaveDialogOptions("template"))
      : await dialog.showSaveDialog(configurationSaveDialogOptions("template"))
    if (result.canceled || !result.filePath) return { canceled: true }
    assertCurrentOwner(dependencies, owner)
    try {
      const snapshot = await dependencies.createConfigurationExportSnapshot(false)
      assertCurrentOwner(dependencies, owner)
      const output = `${JSON.stringify(exportTemplate(snapshot), null, 2)}\n`
      await writeConfigurationExport(result.filePath, output)
      return { canceled: false, path: result.filePath }
    } catch {
      throw new Error("Configuration export failed")
    }
  })
  ipcMain.handle(ipcChannels.configExportBundle, async (event, password: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    const bundlePassword = normalizeConfigurationPassword(password)
    const target = BrowserWindow.fromWebContents(event.sender)
    const result = target
      ? await dialog.showSaveDialog(target, configurationSaveDialogOptions("bundle"))
      : await dialog.showSaveDialog(configurationSaveDialogOptions("bundle"))
    if (result.canceled || !result.filePath) return { canceled: true }
    assertCurrentOwner(dependencies, owner)
    try {
      const snapshot = await dependencies.createConfigurationExportSnapshot(true)
      assertCurrentOwner(dependencies, owner)
      const output = await exportEncryptedBundle(snapshot, bundlePassword)
      assertCurrentOwner(dependencies, owner)
      await writeConfigurationExport(result.filePath, output)
      return { canceled: false, path: result.filePath }
    } catch {
      throw new Error("Configuration export failed")
    }
  })
  ipcMain.handle(ipcChannels.configImportChoose, async (event) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    const target = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: "Import Rocker configuration",
      properties: ["openFile"],
      filters: [{ name: "Rocker configuration", extensions: ["json", "bundle"] }]
    }
    const result = target
      ? await dialog.showOpenDialog(target, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    assertCurrentOwner(dependencies, owner)
    let bytes: Uint8Array
    try {
      bytes = await readConfigurationImport(result.filePaths[0])
      const preview = await dependencies.configuration.preview(bytes, undefined)
      assertCurrentOwner(dependencies, owner)
      const importId = storePendingConfigurationImport(pendingConfigurationImports, owner, bytes)
      return { canceled: false, importId, preview }
    } catch {
      throw new Error("Configuration import could not be opened")
    }
  })
  ipcMain.handle(ipcChannels.configImportPreview, async (event, value: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    const request = normalizeConfigurationImportPreviewRequest(value)
    const pending = getPendingConfigurationImport(pendingConfigurationImports, owner, request.importId)
    if (pending.inFlight) throw new Error("Configuration import is already running")
    const preview = await dependencies.configuration.preview(pending.bytes, request.password)
    assertCurrentOwner(dependencies, owner)
    return preview
  })
  ipcMain.handle(ipcChannels.configImportApply, async (event, value: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    const request = normalizeConfigurationImportRequest(value)
    const pending = getPendingConfigurationImport(pendingConfigurationImports, owner, request.importId)
    if (pending.inFlight) throw new Error("Configuration import is already running")
    pending.inFlight = true
    try {
      const imported = await dependencies.mutations.run(() => dependencies.configuration.import(pending.bytes, request.password, request.resolution))
      assertCurrentOwner(dependencies, owner)
      pendingConfigurationImports.delete(request.importId)
      return imported
    } catch {
      pending.inFlight = false
      throw new Error("Configuration import could not be completed")
    }
  })
  ipcMain.handle(ipcChannels.credentialProtectionStatus, async (event) => {
    currentOwnerForWebContents(dependencies, event.sender.id)
    try {
      return await dependencies.credentials.protectionStatus()
    } catch {
      throw new Error("Credential protection status is unavailable")
    }
  })
  ipcMain.handle(ipcChannels.credentialVaultEnable, async (event, password: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    const vaultPassword = normalizeCredentialVaultPassword(password)
    assertCurrentOwner(dependencies, owner)
    try {
      await dependencies.mutations.run(() => dependencies.credentials.enableVault(vaultPassword))
      assertCurrentOwner(dependencies, owner)
      return await dependencies.credentials.protectionStatus()
    } catch {
      throw new Error("Credential Vault setup failed")
    }
  })
  ipcMain.handle(ipcChannels.credentialVaultUnlock, async (event, password: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    const vaultPassword = normalizeCredentialVaultPassword(password)
    assertCurrentOwner(dependencies, owner)
    try {
      await dependencies.mutations.run(() => dependencies.credentials.unlockVault(vaultPassword))
      assertCurrentOwner(dependencies, owner)
      return await dependencies.credentials.protectionStatus()
    } catch {
      throw new Error("Credential Vault unlock failed")
    }
  })
  ipcMain.handle(ipcChannels.credentialVaultLock, async (event) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    try {
      await dependencies.mutations.run(() => dependencies.credentials.lockVault())
      assertCurrentOwner(dependencies, owner)
      return await dependencies.credentials.protectionStatus()
    } catch {
      throw new Error("Credential Vault lock failed")
    }
  })
  ipcMain.handle(ipcChannels.credentialVaultDisable, async (event) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertCurrentOwner(dependencies, owner)
    try {
      await dependencies.mutations.run(() => dependencies.credentials.disableVault())
      assertCurrentOwner(dependencies, owner)
      return await dependencies.credentials.protectionStatus()
    } catch {
      throw new Error("Credential Vault could not be disabled")
    }
  })
  ipcMain.handle(ipcChannels.windowMinimize, (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.handle(ipcChannels.windowToggleMaximize, (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (target?.isMaximized()) target.unmaximize()
    else target?.maximize()
  })
  ipcMain.handle(ipcChannels.windowIsMaximized, (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)
  ipcMain.handle(ipcChannels.windowClose, (event) => BrowserWindow.fromWebContents(event.sender)?.close())

  const unsubscribe = dependencies.sessions.onEvent(({ owner, event }) => {
    dependencies.windows.sendToOwner(owner, ipcChannels.sessionEvent, event)
  })
  const unsubscribeForwarding = dependencies.forwarding.onEvent?.((event) => {
    const { owner, ...payload } = event
    dependencies.windows.sendToOwner(owner, ipcChannels.portsEvent, payload)
  })
  const unsubscribeSftp = dependencies.sftp?.onEvent((event) => {
    const { owner, event: payload } = event
    const safePayload: SftpRuntimeEvent = payload
    dependencies.windows.sendToOwner(owner, ipcChannels.sftpEvent, safePayload)
  }) ?? (() => undefined)
  return () => {
    unsubscribe()
    unsubscribeForwarding?.()
    unsubscribeSftp()
    pendingConfigurationImports.clear()
    for (const channel of Object.values(ipcChannels)) {
      if (channel !== ipcChannels.sessionEvent && channel !== ipcChannels.sessionLaunch) ipcMain.removeHandler(channel)
    }
  }
}

async function listLocalDirectory(requestedPath: string | undefined): Promise<SftpDirectory> {
  const directoryPath = resolve(requestedPath?.trim() || homedir())
  const directory = await lstat(directoryPath)
  if (!directory.isDirectory()) throw new Error("Local path is not a directory")
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const rows = await Promise.all(entries.map(async (entry) => {
    const path = join(directoryPath, entry.name)
    const metadata = await lstat(path)
    return {
      name: entry.name,
      path,
      type: entry.isDirectory() ? "directory" as const : entry.isFile() ? "file" as const : entry.isSymbolicLink() ? "symlink" as const : "other" as const,
      size: entry.isDirectory() ? undefined : metadata.size,
      modifiedAt: metadata.mtime.toISOString()
    }
  }))
  rows.sort((left, right) => {
    const leftDirectory = left.type === "directory"
    const rightDirectory = right.type === "directory"
    if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true })
  })
  return { path: directoryPath, entries: rows }
}

function normalizeSessionOpenRequest(value: unknown): SessionOpenRequest {
  if (!isRecord(value) || !isValidSessionId(value.sessionId) || !isBoundedString(value.hostId, 128)) {
    throw new Error("Invalid session request")
  }
  if (value.forceNewConnection !== undefined && typeof value.forceNewConnection !== "boolean") throw new Error("Invalid session request")
  if (value.restorePriority !== undefined && value.restorePriority !== "active" && value.restorePriority !== "background") {
    throw new Error("Invalid session request")
  }
  const dimensions = normalizeDimensions(value.cols, value.rows)
  return {
    sessionId: value.sessionId,
    hostId: value.hostId,
    ...dimensions,
    ...(value.forceNewConnection === true ? { forceNewConnection: true } : {}),
    ...(value.restorePriority ? { restorePriority: value.restorePriority } : {})
  }
}

function normalizeHostKeyRemovalRequest(value: unknown): HostKeyRemovalRequest {
  if (!isPlainRecord(value) || !isBoundedString(value.host, 512) || !isValidRemotePort(value.port) || !isBoundedString(value.fingerprint, 512)) {
    throw new Error("Invalid Host Key removal request")
  }
  return { host: value.host, port: value.port, fingerprint: value.fingerprint }
}

function normalizeWorkspaceSaveRequest(value: unknown): WorkspaceSaveRequest {
  if (!isRecord(value) || !Array.isArray(value.sessions)) throw new Error("Invalid workspace snapshot")
  const sessions = value.sessions.map(normalizeWorkspaceSession)
  const sessionIds = new Set<string>()
  for (const session of sessions) {
    if (sessionIds.has(session.sessionId)) throw new Error("Invalid workspace snapshot")
    sessionIds.add(session.sessionId)
  }
  if (value.activeSessionId !== undefined && (!isValidSessionId(value.activeSessionId) || !sessionIds.has(value.activeSessionId))) {
    throw new Error("Invalid workspace snapshot")
  }
  const layout = value.layout === undefined ? undefined : normalizeWorkspaceLayout(value.layout, sessionIds)
  return {
    sessions,
    ...(typeof value.activeSessionId === "string" ? { activeSessionId: value.activeSessionId } : {}),
    ...(layout ? { layout } : {})
  }
}

function normalizeWorkspaceSession(value: unknown): StoredWorkspaceSession {
  if (!isRecord(value) || !isValidSessionId(value.sessionId) || !isBoundedString(value.hostId, 128) || !isBoundedString(value.label, 128)) {
    throw new Error("Invalid workspace snapshot")
  }
  const kind = value.kind === "sftp" || value.kind === "pf" ? value.kind : "ssh"
  if (kind === "ssh") return { sessionId: value.sessionId, hostId: value.hostId, label: value.label, ...normalizeDimensions(value.cols, value.rows) }
  if (kind === "sftp") {
    if (value.path !== undefined && !isBoundedString(value.path, 4_096)) throw new Error("Invalid workspace snapshot")
    return { sessionId: value.sessionId, hostId: value.hostId, label: value.label, kind, path: typeof value.path === "string" ? value.path : "/" }
  }
  if (value.profileId !== undefined && !isBoundedString(value.profileId, 128)) throw new Error("Invalid workspace snapshot")
  if (value.applicationProtocol !== undefined && value.applicationProtocol !== "http" && value.applicationProtocol !== "https") throw new Error("Invalid workspace snapshot")
  return {
    sessionId: value.sessionId,
    hostId: value.hostId,
    label: value.label,
    kind,
    ...(typeof value.profileId === "string" ? { profileId: value.profileId } : {}),
    ...(value.applicationProtocol ? { applicationProtocol: value.applicationProtocol } : {})
  }
}

function normalizeDimensions(cols: unknown, rows: unknown): { cols: number; rows: number } {
  if (!validateDimensions(cols, rows)) throw new Error("Invalid terminal dimensions")
  return { cols: cols as number, rows: rows as number }
}

function normalizeWorkspaceLayout(value: unknown, sessionIds: Set<string>): StoredTerminalLayout {
  if (!isRecord(value)) throw new Error("Invalid workspace snapshot")
  if (value.kind === "leaf") {
    if (!isValidSessionId(value.sessionId) || !sessionIds.has(value.sessionId)) throw new Error("Invalid workspace snapshot")
    return { kind: "leaf", sessionId: value.sessionId }
  }
  if (value.kind !== "split" || value.direction !== "horizontal") throw new Error("Invalid workspace snapshot")
  if (typeof value.ratio !== "number" || !Number.isFinite(value.ratio)) throw new Error("Invalid workspace snapshot")
  return {
    kind: "split",
    direction: "horizontal",
    ratio: Math.max(0.2, Math.min(0.8, value.ratio)),
    first: normalizeWorkspaceLayout(value.first, sessionIds),
    second: normalizeWorkspaceLayout(value.second, sessionIds)
  }
}

function normalizeSettingsUpdate(value: unknown): Partial<AppSettings> {
  if (!isRecord(value)) throw new Error("Invalid settings update")
  const update: Partial<AppSettings> = {}
  if (value.locale === "en" || value.locale === "zh-CN") update.locale = value.locale
  if (typeof value.sidebarWidth === "number") update.sidebarWidth = value.sidebarWidth
  if (typeof value.terminalFont === "string") update.terminalFont = value.terminalFont
  if (typeof value.terminalFontSize === "number") update.terminalFontSize = value.terminalFontSize
  if (isScrollback(value.scrollback)) update.scrollback = value.scrollback
  if (isCursorStyle(value.cursorStyle)) update.cursorStyle = value.cursorStyle
  if (typeof value.cursorBlink === "boolean") update.cursorBlink = value.cursorBlink
  if (typeof value.terminalBell === "boolean") update.terminalBell = value.terminalBell
  if (typeof value.connectionTimeout === "number") update.connectionTimeout = value.connectionTimeout
  if (typeof value.autoReconnect === "boolean") update.autoReconnect = value.autoReconnect
  if (value.reconnectMode === "limited" || value.reconnectMode === "continuous") update.reconnectMode = value.reconnectMode
  if (typeof value.restorePreviousWorkspace === "boolean") update.restorePreviousWorkspace = value.restorePreviousWorkspace
  if (typeof value.confirmMultilinePaste === "boolean") update.confirmMultilinePaste = value.confirmMultilinePaste
  if (value.bindAddress === "127.0.0.1" || value.bindAddress === "::1" || value.bindAddress === "0.0.0.0") update.bindAddress = value.bindAddress
  return update
}

function isScrollback(value: unknown): value is AppSettings["scrollback"] {
  return value === 1000 || value === 5000 || value === 10000 || value === 25000 || value === 50000
}

function isCursorStyle(value: unknown): value is AppSettings["cursorStyle"] {
  return value === "block" || value === "underline" || value === "bar"
}

async function loadBootstrapSnapshot(
  dependencies: IpcDependencies,
  owner: RuntimeOwner
): Promise<AppBootstrapSnapshot> {
  const settled = await Promise.allSettled([
    loadBootstrapResource(dependencies, owner, "settings"),
    loadBootstrapResource(dependencies, owner, "history"),
    loadBootstrapResource(dependencies, owner, "workspace"),
    loadBootstrapResource(dependencies, owner, "hosts"),
    loadBootstrapResource(dependencies, owner, "credentials"),
    loadBootstrapResource(dependencies, owner, "hostKeys")
  ])
  return {
    settings: settledResource(settled[0], "settings") as BootstrapResource<AppSettings>,
    history: settledResource(settled[1], "history") as BootstrapResource<import("../storage/types").ConnectionHistoryItem[]>,
    workspace: settledResource(settled[2], "workspace") as BootstrapResource<import("../storage/types").StoredWorkspaceWindow | undefined>,
    hosts: settledResource(settled[3], "hosts") as BootstrapResource<BootstrapHostProfile[]>,
    credentials: settledResource(settled[4], "credentials") as BootstrapResource<never>,
    hostKeys: settledResource(settled[5], "hostKeys") as BootstrapResource<never>
  }
}

function loadBootstrapResource(
  dependencies: IpcDependencies,
  owner: RuntimeOwner,
  resource: BootstrapResourceName
): Promise<BootstrapResource<unknown>> {
  switch (resource) {
    case "settings":
      return loadValueResource("settings", () => dependencies.settings.loadWithStatus({ consumeHealth: true }))
    case "history":
      return loadValueResource("history", () => dependencies.history.loadWithStatus({ consumeHealth: true }))
    case "workspace":
      return loadWorkspaceResource(dependencies, owner)
    case "hosts":
      return loadValueResource<HostProfile[], BootstrapHostProfile[]>(
        "hosts",
        () => dependencies.hosts.loadWithStatus({ consumeHealth: true }),
        (profiles) => profiles.map(toBootstrapHostProfile)
      )
    case "credentials":
      return loadHealthResource("credentials", () => dependencies.credentials.health({ consumeHealth: true }))
    case "hostKeys":
      return loadHealthResource("hostKeys", () => dependencies.hostKeys.health({ consumeHealth: true }))
  }
}

async function loadWorkspaceResource(
  dependencies: IpcDependencies,
  owner: RuntimeOwner
): Promise<BootstrapResource<unknown>> {
  try {
    const resource = await dependencies.windows.loadWorkspaceWithStatus(owner, { consumeHealth: true })
    const health = sanitizeHealth("workspace", resource.health)
    if (health.status === "blocked") return { health }
    return { health, value: resource.value }
  } catch (error) {
    return blockedResource("workspace", error)
  }
}

async function loadValueResource<T, U = T>(
  store: StorageKind,
  load: () => Promise<LoadResult<T>>,
  map: (value: T) => U = (value) => value as unknown as U
): Promise<BootstrapResource<U>> {
  try {
    return resourceFromLoadResult(store, await load(), map)
  } catch (error) {
    return blockedResource(store, error)
  }
}

function toBootstrapHostProfile(profile: HostProfile): BootstrapHostProfile {
  const { identityFile: _identityFile, ...safeProfile } = profile
  return { ...safeProfile, hasIdentityFile: Boolean(profile.identityFile) }
}

async function loadHealthResource(
  store: StorageKind,
  load: () => Promise<StorageHealth>
): Promise<BootstrapResource<never>> {
  try {
    return { health: sanitizeHealth(store, await load()) }
  } catch (error) {
    return blockedResource(store, error)
  }
}

function settledResource(
  settled: PromiseSettledResult<BootstrapResource<unknown>>,
  resource: BootstrapResourceName
): BootstrapResource<unknown> {
  return settled.status === "fulfilled"
    ? settled.value
    : blockedResource(resourceStore(resource), settled.reason)
}

function resourceFromLoadResult<T, U = T>(
  store: StorageKind,
  result: LoadResult<T>,
  map: (value: T) => U = (value) => value as unknown as U
): BootstrapResource<U> {
  if (result.status === "blocked") return blockedResource(store, result.issue)
  if (result.status === "recovered") return { health: { store, status: "recovered", source: "backup" }, value: map(result.value) }
  if (result.status === "defaulted") return { health: { store, status: "defaulted", reason: result.reason }, value: map(result.value) }
  return { health: { store, status: "ok" }, value: map(result.value) }
}

function blockedResource(store: StorageKind, error: unknown): BootstrapResource<never> {
  const reason = storageFailureReason(error)
  return {
    health: {
      store,
      status: "blocked",
      reason,
      message: storageFailureMessage(reason)
    }
  }
}

function sanitizeHealth(store: StorageKind, health: StorageHealth): StorageHealth {
  if (!health || typeof health !== "object") return blockedResource(store, undefined).health
  if (health.status === "ok") return { store, status: "ok" }
  if (health.status === "recovered") return { store, status: "recovered", source: "backup" }
  if (health.status === "defaulted") {
    return health.reason === "missing" || health.reason === "corrupt"
      ? { store, status: "defaulted", reason: health.reason }
      : blockedResource(store, undefined).health
  }
  if (health.status === "blocked") {
    const reason = isStorageFailureReason(health.reason) ? health.reason : "unavailable"
    return { store, status: "blocked", reason, message: storageFailureMessage(reason) }
  }
  return blockedResource(store, undefined).health
}

function storageFailureReason(error: unknown): StorageFailureReason {
  if (isStorageIssue(error) && isStorageFailureReason(error.reason)) return error.reason
  if (isRecord(error) && "issue" in error && isStorageIssue(error.issue) && isStorageFailureReason(error.issue.reason)) {
    return error.issue.reason
  }
  return "unavailable"
}

function storageFailureMessage(reason: StorageFailureReason): string {
  if (reason === "corrupt") return "Stored data is corrupt."
  if (reason === "permission") return "Stored data cannot be accessed due to permissions."
  if (reason === "recovery-failed") return "Stored data recovery failed."
  return "Stored data is unavailable."
}

function isStorageIssue(value: unknown): value is { reason: string } {
  return isRecord(value) && typeof value.reason === "string"
}

function isStorageFailureReason(value: unknown): value is StorageFailureReason {
  return value === "corrupt" || value === "permission" || value === "unavailable" || value === "recovery-failed"
}

function resourceStore(resource: BootstrapResourceName): StorageKind {
  return resource
}

function normalizeBootstrapRetryResources(value: unknown): BootstrapResourceName[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("Retry resources must be non-empty")
  if (value.length > bootstrapResourceNames.length) throw new Error("Retry resources must include at most six resources")
  const resources: BootstrapResourceName[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (typeof candidate !== "string" || !bootstrapResourceNames.includes(candidate as BootstrapResourceName)) {
      throw new Error("Retry resources must use known resource names")
    }
    if (seen.has(candidate)) throw new Error("Retry resources must not contain duplicates")
    seen.add(candidate)
    resources.push(candidate as BootstrapResourceName)
  }
  return resources
}

function assertCurrentOwner(dependencies: IpcDependencies, owner: RuntimeOwner): void {
  const currentOwner = dependencies.windows.currentOwnerForWebContents(owner.webContentsId)
  if (!currentOwner || !sameRuntimeOwner(currentOwner, owner)) {
    throw new Error("Renderer owner was replaced")
  }
}

function currentOwnerForWebContents(dependencies: IpcDependencies, webContentsId: number): RuntimeOwner {
  const owner = dependencies.windows.currentOwnerForWebContents(webContentsId)
  if (!owner) throw new Error("Renderer generation is not active")
  return owner
}

function assertOwnedSession(dependencies: IpcDependencies, owner: RuntimeOwner, sessionId: unknown): asserts sessionId is string {
  if (!isValidSessionId(sessionId)) throw new Error("Invalid session identifier")
  const sessionOwner = dependencies.sessions.ownerForSession(sessionId)
  if (sessionOwner === undefined) throw new Error("Terminal session was not found")
  if (!sameRuntimeOwner(sessionOwner, owner)) {
    throw new Error(sessionOwner.webContentsId === owner.webContentsId
      ? "Session is owned by another renderer generation"
      : "Session is owned by another window")
  }
}

function assertOwnedConnection(dependencies: IpcDependencies, owner: RuntimeOwner, connectionId: unknown): asserts connectionId is string {
  if (!isValidSessionId(connectionId)) throw new Error("Invalid SSH connection identifier")
  const connectionOwner = dependencies.connections.ownerForConnection(connectionId)
  if (connectionOwner === undefined) throw new Error("SSH connection is owned by another window")
  if (!sameRuntimeOwner(connectionOwner, owner)) {
    throw new Error(connectionOwner.webContentsId === owner.webContentsId
      ? "SSH connection is owned by another renderer generation"
      : "SSH connection is owned by another window")
  }
}

function assertOwnedForwarding(dependencies: IpcDependencies, owner: RuntimeOwner, forwardingId: unknown): asserts forwardingId is string {
  if (!isValidSessionId(forwardingId)) throw new Error("Invalid forwarding identifier")
  const forwardingOwner = dependencies.forwarding.ownerForForwarding(forwardingId)
  if (forwardingOwner === undefined) throw new Error("Port forwarding is owned by another window")
  if (!sameRuntimeOwner(forwardingOwner, owner)) {
    throw new Error(forwardingOwner.webContentsId === owner.webContentsId
      ? "Port forwarding is owned by another renderer generation"
      : "Port forwarding is owned by another window")
  }
}

function configurationSaveDialogOptions(kind: "template" | "bundle"): Electron.SaveDialogOptions {
  return kind === "template"
    ? {
        title: "Export Rocker configuration",
        defaultPath: "rocker-config.json",
        filters: [{ name: "Rocker configuration", extensions: ["json"] }]
      }
    : {
        title: "Export encrypted Rocker migration bundle",
        defaultPath: "rocker-config.bundle",
        filters: [{ name: "Rocker migration bundle", extensions: ["bundle"] }]
      }
}

async function readConfigurationImport(filePath: string): Promise<Uint8Array> {
  const handle = await open(filePath, "r")
  try {
    const initial = await handle.stat()
    if (!initial.isFile() || initial.size < 1 || initial.size > maximumConfigurationImportBytes) {
      throw new Error("Configuration import is invalid")
    }
    const bytes = Buffer.allocUnsafe(initial.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (bytesRead === 0) throw new Error("Configuration import is invalid")
      offset += bytesRead
    }
    const completed = await handle.stat()
    if (completed.size !== initial.size) throw new Error("Configuration import is invalid")
    return bytes
  } finally {
    await handle.close().catch(() => undefined)
  }
}

async function writeConfigurationExport(filePath: string, output: string | Uint8Array): Promise<void> {
  const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporaryPath, output, { mode: 0o600 })
    if (process.platform !== "win32") await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, filePath)
    if (process.platform !== "win32") await chmod(filePath, 0o600)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function normalizeConfigurationPassword(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > 4_096) {
    throw new Error("Configuration password is invalid")
  }
  return value
}

function normalizeCredentialVaultPassword(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > 4_096) {
    throw new Error("Credential Vault password is invalid")
  }
  return value
}

function normalizeConfigurationImportPreviewRequest(value: unknown): { importId: string; password?: string } {
  if (!isPlainRecord(value) || !isValidSessionId(value.importId)) throw new Error("Invalid configuration import request")
  if (value.password !== undefined && (typeof value.password !== "string" || Buffer.byteLength(value.password, "utf8") > 4_096)) {
    throw new Error("Configuration password is invalid")
  }
  return value.password === undefined
    ? { importId: value.importId }
    : { importId: value.importId, password: value.password }
}

function normalizeConfigurationImportRequest(value: unknown): { importId: string; password?: string; resolution: ConflictResolution } {
  const preview = normalizeConfigurationImportPreviewRequest(value)
  if (!isPlainRecord(value) || !("resolution" in value)) throw new Error("Invalid configuration import request")
  return { ...preview, resolution: normalizeConflictResolution(value.resolution) }
}

function normalizeConflictResolution(value: unknown): ConflictResolution {
  if (!isPlainRecord(value)) throw new Error("Invalid configuration import resolution")
  const allowed = new Set(["hosts", "hostKeys", "forwardings", "importHostKeys", "applySettings", "importCredentials"])
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("Invalid configuration import resolution")
  const result: ConflictResolution = {}
  if (value.hosts !== undefined) result.hosts = normalizeResolutionMap(value.hosts, ["keep-local", "use-imported", "create-copy", "skip"], 128)
  if (value.hostKeys !== undefined) result.hostKeys = normalizeResolutionMap(value.hostKeys, ["keep-local", "replace-host-key", "skip"], 600)
  if (value.forwardings !== undefined) result.forwardings = normalizeResolutionMap(value.forwardings, ["keep-local", "use-imported", "create-copy", "skip"], 128)
  if (value.importHostKeys !== undefined) {
    if (typeof value.importHostKeys !== "boolean") throw new Error("Invalid configuration import resolution")
    result.importHostKeys = value.importHostKeys
  }
  if (value.applySettings !== undefined) {
    if (typeof value.applySettings !== "boolean") throw new Error("Invalid configuration import resolution")
    result.applySettings = value.applySettings
  }
  if (value.importCredentials !== undefined) {
    if (typeof value.importCredentials !== "boolean") throw new Error("Invalid configuration import resolution")
    result.importCredentials = value.importCredentials
  }
  return result
}

function normalizeResolutionMap<T extends string>(
  value: unknown,
  allowedActions: readonly T[],
  maximumKeyLength: number
): Record<string, T> {
  if (!isPlainRecord(value) || Object.keys(value).length > 10_000) {
    throw new Error("Invalid configuration import resolution")
  }
  const result: Record<string, T> = {}
  for (const [key, action] of Object.entries(value)) {
    if (!isBoundedString(key, maximumKeyLength) || typeof action !== "string" || !allowedActions.includes(action as T)) {
      throw new Error("Invalid configuration import resolution")
    }
    result[key] = action as T
  }
  return result
}

function storePendingConfigurationImport(
  pendingImports: Map<string, PendingConfigurationImport>,
  owner: RuntimeOwner,
  bytes: Uint8Array
): string {
  for (const [importId, pending] of pendingImports) {
    if (pending.owner.webContentsId === owner.webContentsId) pendingImports.delete(importId)
  }
  while (pendingImports.size >= maximumPendingConfigurationImports) {
    const oldest = pendingImports.keys().next().value
    if (oldest === undefined) break
    pendingImports.delete(oldest)
  }
  const importId = randomUUID()
  pendingImports.set(importId, { owner, bytes, inFlight: false })
  return importId
}

function getPendingConfigurationImport(
  pendingImports: Map<string, PendingConfigurationImport>,
  owner: RuntimeOwner,
  importId: unknown
): PendingConfigurationImport {
  if (!isValidSessionId(importId)) throw new Error("Invalid configuration import identifier")
  const pending = pendingImports.get(importId)
  if (!pending) throw new Error("Configuration import is unavailable")
  if (!sameRuntimeOwner(pending.owner, owner)) {
    throw new Error(pending.owner.webContentsId === owner.webContentsId
      ? "Import is owned by another renderer generation"
      : "Import is owned by another window")
  }
  return pending
}

function isRedactedHostProfile(profile: HostSaveProfile): profile is BootstrapHostProfile {
  return typeof (profile as { hasIdentityFile?: unknown }).hasIdentityFile === "boolean"
    && (profile as HostProfile).identityFile === undefined
}

function assertHostProfile(profile: HostSaveProfile | undefined): asserts profile is HostSaveProfile {
  if (!profile || !isRecord(profile) || !isNonBlankBoundedString(profile.id, 128) || !isNonBlankBoundedString(profile.name, 256) || !isNonBlankBoundedString(profile.host, 512) || !isNonBlankBoundedString(profile.username, 256)) {
    throw new Error("Host name, address, and username are required")
  }
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) {
    throw new Error("Host port must be between 1 and 65535")
  }
  if (!(["password", "privateKey", "agent"] as const).includes(profile.authMethod)) {
    throw new Error("Unsupported authentication method")
  }
  if (profile.publicKeyEnabled !== undefined && typeof profile.publicKeyEnabled !== "boolean") {
    throw new Error("Invalid public key setting")
  }
  if (profile.snippetsEnabled !== undefined && typeof profile.snippetsEnabled !== "boolean") {
    throw new Error("Invalid snippets setting")
  }
  if (profile.snippetCollection !== undefined && (typeof profile.snippetCollection !== "string" || profile.snippetCollection.length > 256)) {
    throw new Error("Invalid snippet collection")
  }
  if (profile.group !== undefined && (typeof profile.group !== "string" || profile.group.length > 256)) {
    throw new Error("Invalid host group")
  }
  if ("identityFile" in profile && profile.identityFile !== undefined && (typeof profile.identityFile !== "string" || profile.identityFile.length > 4_096)) {
    throw new Error("Invalid private key path")
  }
  if (profile.charset !== undefined && !isHostCharsetValue(profile.charset)) {
    throw new Error("Invalid host charset")
  }
  if (profile.themeColor !== undefined && !isHostThemeColorValue(profile.themeColor)) {
    throw new Error("Invalid host theme color")
  }
  if (profile.environment !== undefined && !isHostEnvironmentValue(profile.environment)) {
    throw new Error("Invalid host environment")
  }
  if (profile.tags !== undefined && !isValidHostTags(profile.tags)) {
    throw new Error("Invalid host tags")
  }
  if ("hasIdentityFile" in profile && typeof profile.hasIdentityFile !== "boolean") {
    throw new Error("Invalid identity file state")
  }

  const publicKeyEnabled = profile.publicKeyEnabled ?? profile.authMethod === "privateKey"
  if (publicKeyEnabled) {
    if (profile.authMethod !== "privateKey") {
      throw new Error("Public key login requires private key authentication")
    }
    const identityFile = "identityFile" in profile ? profile.identityFile : undefined
    const hasPath = isNonBlankBoundedString(identityFile, 4_096)
    const hasRetainedPath = isRedactedHostProfile(profile) && profile.hasIdentityFile
    if (!hasPath && !hasRetainedPath) throw new Error("Private key path is required")
  } else if (profile.authMethod === "privateKey") {
    throw new Error("Public key login must be enabled for private key authentication")
  }
  if (profile.snippetsEnabled === true && !isNonBlankBoundedString(profile.snippetCollection, 256)) {
    throw new Error("Snippet collection is required")
  }
}

function isHostCharsetValue(value: unknown): value is "utf-8" | "gb18030" | "iso-8859-1" {
  return value === "utf-8" || value === "gb18030" || value === "iso-8859-1"
}

function isHostThemeColorValue(value: unknown): value is "rocker" | "amber" | "ocean" | "slate" {
  return value === "rocker" || value === "amber" || value === "ocean" || value === "slate"
}

function isHostEnvironmentValue(value: unknown): value is "production" | "staging" | "development" | "personal" {
  return value === "production" || value === "staging" || value === "development" || value === "personal"
}

function isValidHostTags(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 16
    && value.every((candidate) => typeof candidate === "string" && candidate.trim().length <= 64)
}

function isNonBlankBoundedString(value: unknown, maximumLength: number): value is string {
  return isBoundedString(value, maximumLength) && value.trim().length > 0
}

function assertId(value: unknown, kind: string): asserts value is string {
  if (!isBoundedString(value, 128)) throw new Error(`Invalid ${kind} identifier`)
}

function normalizeSessionLaunchRequest(value: unknown): SessionLaunchRequest {
  if (typeof value === "string") {
    assertId(value, "host")
    return { hostId: value }
  }
  if (!isPlainRecord(value)) throw new Error("Invalid session launch request")
  assertId(value.hostId, "host")
  if (value.kind !== undefined && value.kind !== "ssh" && value.kind !== "sftp" && value.kind !== "pf") {
    throw new Error("Invalid session kind")
  }
  if (value.label !== undefined && !isNonBlankBoundedString(value.label, 256)) throw new Error("Invalid session label")
  if (value.path !== undefined && !isNonBlankBoundedString(value.path, 4_096)) throw new Error("Invalid SFTP path")
  if (value.profileId !== undefined) assertId(value.profileId, "forwarding profile")
  if (value.applicationProtocol !== undefined && value.applicationProtocol !== "http" && value.applicationProtocol !== "https") {
    throw new Error("Invalid application protocol")
  }
  return {
    hostId: value.hostId,
    ...(value.kind ? { kind: value.kind } : {}),
    ...(value.label ? { label: value.label } : {}),
    ...(value.path ? { path: value.path } : {}),
    ...(value.profileId ? { profileId: value.profileId } : {}),
    ...(value.applicationProtocol ? { applicationProtocol: value.applicationProtocol } : {})
  }
}

function requireForwardingProfileStore(dependencies: IpcDependencies): NonNullable<IpcDependencies["forwardingProfiles"]> {
  if (!dependencies.forwardingProfiles) throw new Error("Forwarding profile storage is unavailable")
  return dependencies.forwardingProfiles
}

async function requireHost(dependencies: IpcDependencies, hostId: string): Promise<HostProfile> {
  const host = (await dependencies.hosts.list()).find((candidate) => candidate.id === hostId)
  if (!host) throw new Error("Host profile not found")
  return host
}

async function listForwardingViews(
  dependencies: IpcDependencies,
  owner: RuntimeOwner,
  hostId?: string
): Promise<ForwardingProfileView[]> {
  const store = requireForwardingProfileStore(dependencies)
  const profiles = await store.list(hostId)
  const runtimes = dependencies.forwarding.list()
    .filter((runtime) => runtime.profileId !== undefined)
    .filter((runtime) => hostId === undefined || runtime.hostId === hostId)
    .filter((runtime) => runtime.status === "stopped" || (() => {
      const runtimeOwner = dependencies.forwarding.ownerForForwarding(runtime.id)
      return runtimeOwner !== undefined && sameRuntimeOwner(runtimeOwner, owner)
    })())
  const runtimeByProfile = new Map<string, typeof runtimes[number]>()
  for (const runtime of runtimes) {
    if (runtime.profileId) runtimeByProfile.set(runtime.profileId, runtime)
  }
  return profiles.map((profile) => ({
    profile,
    runtime: runtimeByProfile.get(profile.id)
  }))
}

function normalizeForwardingProfileRequest(value: unknown): ForwardingProfileRequest {
  if (!isPlainRecord(value)) throw new Error("Invalid forwarding profile request")
  if (!isNonBlankBoundedString(value.name, 256)) throw new Error("Forwarding profile name is required")
  if (value.description !== undefined && (typeof value.description !== "string" || value.description.length > 10_000)) {
    throw new Error("Invalid forwarding profile description")
  }
  if (!isForwardingLocalAddress(value.localAddress)) throw new Error("Invalid local bind address")
  if (!isValidRemotePort(value.localPort)) throw new Error("Local port must be between 1 and 65535")
  if (!isNonBlankBoundedString(value.remoteAddress, 512)) throw new Error("Remote address is required")
  if (!isValidRemotePort(value.remotePort)) throw new Error("Remote port must be between 1 and 65535")
  if (typeof value.autoStart !== "boolean") throw new Error("Invalid auto-start setting")
  return {
    name: value.name.trim(),
    ...(typeof value.description === "string" && value.description.trim() ? { description: value.description.trim() } : {}),
    localAddress: value.localAddress,
    localPort: value.localPort,
    remoteAddress: value.remoteAddress.trim(),
    remotePort: value.remotePort,
    autoStart: value.autoStart
  }
}

function isForwardingLocalAddress(value: unknown): value is "127.0.0.1" | "::1" | "0.0.0.0" {
  return value === "127.0.0.1" || value === "::1" || value === "0.0.0.0"
}

function isValidForwardingSpec(value: unknown): value is ForwardingSpec {
  if (!isRecord(value) || !isBoundedString(value.localAddress, 64) || !isBoundedString(value.remoteAddress, 255)) return false
  return isValidLocalPort(value.localPort) && isValidRemotePort(value.remotePort)
}

function isValidLocalPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65_535
}

function isValidRemotePort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535
}

function isValidGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isValidSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value)
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
}
