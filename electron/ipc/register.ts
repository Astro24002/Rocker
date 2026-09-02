import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { BrowserWindow, dialog, ipcMain, shell } from "electron"
import type { OpenDialogOptions } from "electron"
import type { DiagnosticLogger } from "../diagnostics/diagnostic-logger"
import type { DiagnosticRuntimeMetadata } from "../diagnostics/diagnostic-types"
import { sameRuntimeOwner, type RuntimeOwner } from "../runtime/owner"
import { diagnosticFileName, writeDiagnosticExport } from "../diagnostics/diagnostic-export"
import type { ForwardingManager } from "../ports/forwarding-manager"
import type { PortService } from "../ports/port-service"
import type { ForwardingSpec } from "../ports/types"
import type { LinuxMetricsSampler } from "../monitoring/linux-metrics"
import type { CredentialVault } from "../storage/credentials"
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
import type { TerminalSessionManager } from "../ssh/terminal-session-manager"
import type { WorkspaceWindowManager } from "../windows/workspace-window-manager"
import {
  type AppBootstrapSnapshot,
  type BootstrapResource,
  type BootstrapResourceName,
  ipcChannels,
  type HostSaveRequest,
  type SessionOpenRequest,
  type WorkspaceSaveRequest
} from "./bridge-contract"
import { isValidSessionId, validateDimensions, validateTerminalData } from "./validation"

export interface IpcDependencies {
  hosts: HostStore
  credentials: CredentialVault
  hostKeys: BootstrapHealthStore
  sessions: TerminalSessionManager
  connections: SshConnectionManager
  ports: PortService
  forwarding: ForwardingManager
  monitoring: LinuxMetricsSampler
  history: HistoryStore
  settings: SettingsStore
  diagnostics: DiagnosticLogger
  diagnosticsAppVersion?: string
  diagnosticsBuildChannel?: DiagnosticRuntimeMetadata["buildChannel"]
  diagnosticsRuntimeMode?: DiagnosticRuntimeMetadata["runtimeMode"]
  windows: WorkspaceWindowManager
  createDuplicateWindow?(hostId: string): Promise<void>
}

interface BootstrapHealthStore {
  health(options?: { consumeHealth?: boolean }): Promise<StorageHealth>
}

const bootstrapResourceNames: BootstrapResourceName[] = [
  "settings",
  "history",
  "workspace",
  "hosts",
  "credentials",
  "hostKeys"
]

export function registerIpcHandlers(dependencies: IpcDependencies): () => void {
  ipcMain.handle(ipcChannels.hostsList, () => dependencies.hosts.list())
  ipcMain.handle(ipcChannels.hostsSave, async (_event, request: HostSaveRequest) => {
    assertHostProfile(request?.profile)
    await dependencies.hosts.save(request.profile)
    if (request.credentials?.password) await dependencies.credentials.set(request.profile.id, "password", request.credentials.password)
    if (request.credentials?.passphrase) await dependencies.credentials.set(request.profile.id, "passphrase", request.credentials.passphrase)
  })
  ipcMain.handle(ipcChannels.hostsRemove, async (_event, id: unknown) => {
    assertId(id, "host")
    await dependencies.hosts.remove(id)
    await Promise.all([
      dependencies.credentials.clear(id, "password"),
      dependencies.credentials.clear(id, "passphrase")
    ])
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
    return dependencies.hosts.importOpenSSHConfig(await readFile(result.filePaths[0], "utf8"))
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
  ipcMain.handle(ipcChannels.sessionDuplicateWindow, (event, hostId: unknown) => {
    currentOwnerForWebContents(dependencies, event.sender.id)
    assertId(hostId, "host")
    if (!dependencies.createDuplicateWindow) throw new Error("Window duplication is unavailable")
    return dependencies.createDuplicateWindow(hostId)
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
  ipcMain.handle(ipcChannels.monitorSample, (event, sessionId: unknown) => {
    const owner = currentOwnerForWebContents(dependencies, event.sender.id)
    assertOwnedSession(dependencies, owner, sessionId)
    return dependencies.monitoring.sample(sessionId)
  })
  ipcMain.handle(ipcChannels.historyList, () => dependencies.history.list())
  ipcMain.handle(ipcChannels.historyClear, () => dependencies.history.clear())
  ipcMain.handle(ipcChannels.settingsGet, () => dependencies.settings.get())
  ipcMain.handle(ipcChannels.settingsUpdate, async (_event, update: unknown) => {
    const next = await dependencies.settings.update(normalizeSettingsUpdate(update))
    dependencies.connections.updateRetryPolicy(next)
    return next
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
  ipcMain.handle(ipcChannels.windowMinimize, (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.handle(ipcChannels.windowToggleMaximize, (event) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (target?.isMaximized()) target.unmaximize()
    else target?.maximize()
  })
  ipcMain.handle(ipcChannels.windowClose, (event) => BrowserWindow.fromWebContents(event.sender)?.close())

  const unsubscribe = dependencies.sessions.onEvent(({ owner, event }) => {
    dependencies.windows.sendToOwner(owner, ipcChannels.sessionEvent, event)
    if (event.kind === "state" && event.state === "closing") dependencies.monitoring.clear(event.sessionId)
  })
  return () => {
    unsubscribe()
    for (const channel of Object.values(ipcChannels)) {
      if (channel !== ipcChannels.sessionEvent && channel !== ipcChannels.sessionLaunch) ipcMain.removeHandler(channel)
    }
  }
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
  const dimensions = normalizeDimensions(value.cols, value.rows)
  return { sessionId: value.sessionId, hostId: value.hostId, label: value.label, ...dimensions }
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
  if (typeof value.connectionTimeout === "number") update.connectionTimeout = value.connectionTimeout
  if (typeof value.autoReconnect === "boolean") update.autoReconnect = value.autoReconnect
  if (value.reconnectMode === "limited" || value.reconnectMode === "continuous") update.reconnectMode = value.reconnectMode
  if (typeof value.restorePreviousWorkspace === "boolean") update.restorePreviousWorkspace = value.restorePreviousWorkspace
  if (typeof value.confirmMultilinePaste === "boolean") update.confirmMultilinePaste = value.confirmMultilinePaste
  if (value.bindAddress === "127.0.0.1" || value.bindAddress === "::1" || value.bindAddress === "0.0.0.0") update.bindAddress = value.bindAddress
  return update
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
    hosts: settledResource(settled[3], "hosts") as BootstrapResource<HostProfile[]>,
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
      return loadValueResource("hosts", () => dependencies.hosts.loadWithStatus({ consumeHealth: true }))
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

async function loadValueResource<T>(
  store: StorageKind,
  load: () => Promise<LoadResult<T>>
): Promise<BootstrapResource<T>> {
  try {
    return resourceFromLoadResult(store, await load())
  } catch (error) {
    return blockedResource(store, error)
  }
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

function resourceFromLoadResult<T>(store: StorageKind, result: LoadResult<T>): BootstrapResource<T> {
  if (result.status === "blocked") return blockedResource(store, result.issue)
  if (result.status === "recovered") return { health: { store, status: "recovered", source: "backup" }, value: result.value }
  if (result.status === "defaulted") return { health: { store, status: "defaulted", reason: result.reason }, value: result.value }
  return { health: { store, status: "ok" }, value: result.value }
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

function assertId(value: unknown, kind: string): asserts value is string {
  if (!isBoundedString(value, 128)) throw new Error(`Invalid ${kind} identifier`)
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

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
}
