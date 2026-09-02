import { app, BrowserWindow, dialog, powerMonitor } from "electron"
import { join } from "node:path"
import { DiagnosticLogger } from "./diagnostics/diagnostic-logger"
import { bootstrapPrimaryInstance } from "./application/single-instance"
import { registerIpcHandlers, type IpcDependencies } from "./ipc/register"
import { ipcChannels } from "./ipc/bridge-contract"
import { LinuxMetricsSampler, type MonitoringEvent } from "./monitoring/linux-metrics"
import { ForwardingManager, type ForwardingEvent } from "./ports/forwarding-manager"
import { PortService } from "./ports/port-service"
import { CredentialVault } from "./storage/credentials"
import { JsonCredentialValueStore } from "./storage/credential-store"
import { HistoryStore } from "./storage/history-store"
import { createHostStore } from "./storage/host-store"
import { createSafeStorageCipher } from "./storage/safe-storage"
import { defaultSettings, SettingsStore } from "./storage/settings-store"
import type { AppSettings } from "./storage/types"
import { WorkspaceSnapshotStore } from "./storage/workspace-store"
import { SshConnectionManager, type ConnectionEvent, type HostKeyPromptRequest } from "./ssh/connection-manager"
import { createConnectionResolver } from "./ssh/connection-resolver"
import { JsonHostKeyStore } from "./ssh/host-key-store"
import { TerminalSessionManager } from "./ssh/terminal-session-manager"
import type { OwnedTerminalSessionEvent } from "./ssh/types"
import {
  WorkspaceWindowManager,
  type WindowLifecycleEvent,
  type WorkspaceWindowOptions
} from "./windows/workspace-window-manager"

interface ApplicationRuntime {
  connections: SshConnectionManager
  sessions: TerminalSessionManager
  forwarding: ForwardingManager
  snapshots: WorkspaceSnapshotStore
  windows: WorkspaceWindowManager
  diagnostics: DiagnosticLogger
}

let runtime: ApplicationRuntime | undefined
let shutdown: Promise<void> | undefined
let pendingFocus = false

function createNativeWindow(options: WorkspaceWindowOptions = {}): BrowserWindow {
  const window = new BrowserWindow({
    minWidth: 1040,
    minHeight: 680,
    width: options.width ?? 1440,
    height: options.height ?? 900,
    ...(options.x === undefined ? {} : { x: options.x }),
    ...(options.y === undefined ? {} : { y: options.y }),
    backgroundColor: "#0f1118",
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "../preload/index.cjs")
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"))
  }
  return window
}

async function startApplication(): Promise<void> {
  const userDataPath = app.getPath("userData")
  const diagnostics = new DiagnosticLogger(userDataPath)
  const hosts = createHostStore(userDataPath)
  const credentials = new CredentialVault(
    new JsonCredentialValueStore(join(userDataPath, "credentials.json")),
    createSafeStorageCipher()
  )
  const settings = new SettingsStore(join(userDataPath, "settings.json"))
  const initialSettingsResult = await loadInitialSettings(settings)
  const initialSettings = initialSettingsResult.status === "blocked" ? defaultSettings : initialSettingsResult.value
  const hostKeys = new JsonHostKeyStore(join(userDataPath, "host-keys.json"))
  const snapshots = new WorkspaceSnapshotStore(join(userDataPath, "workspace.json"))
  const initialWorkspaceResult = await loadInitialWorkspace(snapshots)
  let windows: WorkspaceWindowManager
  const connections = new SshConnectionManager({
    resolve: createConnectionResolver({ hosts, credentials, settings, hostKeys }),
    hostKeys,
    maxRetryAttempts: retryLimit(initialSettings),
    promptForHostKey: async (request) => promptForHostKey(windows, request),
    onEvent: (event) => recordConnectionDiagnostic(diagnostics, event)
  })
  const sessions = new TerminalSessionManager({
    connections,
    onEvent: (event) => recordSessionDiagnostic(diagnostics, event)
  })
  const forwarding = new ForwardingManager(connections, {
    onEvent: (event) => recordForwardingDiagnostic(diagnostics, event)
  })
  windows = new WorkspaceWindowManager({
    snapshots,
    createWindow: createNativeWindow,
    preserveLastWindowWorkspace: process.platform !== "darwin",
    workspacePersistenceBlocked: initialWorkspaceResult.status === "blocked",
    onWindowClosed: async (ownerWebContentsId) => {
      await forwarding.releaseWebContents(ownerWebContentsId)
      await sessions.releaseWebContents(ownerWebContentsId)
      await connections.releaseWebContents(ownerWebContentsId)
    },
    onRendererReleased: async (owner) => {
      await forwarding.releaseOwner(owner)
      await sessions.releaseOwner(owner)
      await connections.releaseOwner(owner)
    },
    onLifecycle: (event) => recordWindowDiagnostic(diagnostics, event)
  })
  const dependencies: IpcDependencies = {
    hosts,
    credentials,
    hostKeys,
    sessions,
    connections,
    ports: new PortService(connections),
    forwarding,
    monitoring: new LinuxMetricsSampler(sessions, {
      onEvent: (event) => recordMonitoringDiagnostic(diagnostics, event)
    }),
    history: new HistoryStore(join(userDataPath, "history.json")),
    settings,
    diagnostics,
    diagnosticsAppVersion: app.getVersion(),
    diagnosticsBuildChannel: app.isPackaged ? "release" : "development",
    diagnosticsRuntimeMode: app.isPackaged ? "packaged" : "development",
    windows
  }
  dependencies.createDuplicateWindow = async (hostId) => {
    const target = windows.createNew()
    target.webContents.once("did-finish-load", () => {
      const owner = windows.currentOwnerForWebContents(target.webContents.id)
      if (owner) windows.sendToOwner(owner, ipcChannels.sessionLaunch, { hostId })
    })
  }
  registerIpcHandlers(dependencies)

  const restored = initialSettings.restorePreviousWorkspace && initialWorkspaceResult.status !== "blocked"
    ? await windows.restoreWindows()
    : []
  if (restored.length === 0) windows.createNew()
  powerMonitor.on("resume", () => sessions.retryAfterResume())
  app.on("activate", () => {
    if (windows.ownerWebContentsIds().length === 0) windows.createNew()
  })
  runtime = { connections, sessions, forwarding, snapshots, windows, diagnostics }
  if (pendingFocus) {
    pendingFocus = false
    windows.focusMostRecentOrCreate()
  }
}

async function loadInitialSettings(settings: SettingsStore): Promise<Awaited<ReturnType<SettingsStore["loadWithStatus"]>>> {
  try {
    return await settings.loadWithStatus()
  } catch {
    return {
      status: "blocked",
      issue: {
        store: "settings",
        reason: "unavailable",
        message: "Stored data is unavailable."
      }
    }
  }
}

async function loadInitialWorkspace(
  snapshots: WorkspaceSnapshotStore
): Promise<Awaited<ReturnType<WorkspaceSnapshotStore["loadWithStatus"]>>> {
  try {
    return await snapshots.loadWithStatus()
  } catch {
    return {
      status: "blocked",
      issue: {
        store: "workspace",
        reason: "unavailable",
        message: "Stored data is unavailable."
      }
    }
  }
}

function retryLimit(settings: AppSettings): number {
  if (!settings.autoReconnect) return 0
  return settings.reconnectMode === "continuous" ? Number.POSITIVE_INFINITY : 8
}

async function promptForHostKey(windows: WorkspaceWindowManager, request: HostKeyPromptRequest): Promise<boolean> {
  const target = windows.windowForOwner(request.owner)
  if (!target || target.isDestroyed()) return false
  const changed = request.inspection.status === "changed"
  const detail = request.inspection.status === "changed"
    ? `Expected SHA256:${request.inspection.storedFingerprint}\nReceived SHA256:${request.inspection.receivedFingerprint}`
    : `SHA256:${request.inspection.fingerprint}`
  const result = await dialog.showMessageBox(target as unknown as BrowserWindow, {
    type: "warning",
    title: changed ? "Host Key Changed" : "Unknown Host Key",
    message: changed
      ? `The host key for ${request.host}:${request.port} changed.`
      : `Trust the host key for ${request.host}:${request.port}?`,
    detail,
    buttons: ["Cancel", changed ? "Replace and Trust" : "Trust"],
    defaultId: 0,
    cancelId: 0
  })
  return result.response === 1
}

async function shutdownApplication(applicationRuntime: ApplicationRuntime): Promise<void> {
  applicationRuntime.windows.beginQuit()
  applicationRuntime.windows.flushWindowBounds()
  try {
    await applicationRuntime.snapshots.flush()
  } catch {
    // Shutdown should still release active transports when a snapshot write fails.
  }
  await Promise.all(applicationRuntime.windows.ownerWebContentsIds().map(async (ownerWebContentsId) => {
    await applicationRuntime.forwarding.releaseWebContents(ownerWebContentsId)
    await applicationRuntime.sessions.releaseWebContents(ownerWebContentsId)
    await applicationRuntime.connections.releaseWebContents(ownerWebContentsId)
  }))
  try {
    await applicationRuntime.diagnostics.close()
  } catch {
    // Diagnostics are best effort and must not prevent resource cleanup or quit.
  }
}

function recordConnectionDiagnostic(logger: DiagnosticLogger, event: ConnectionEvent): void {
  logger.record({
    category: "connection",
    action: event.kind,
    connectionId: event.connectionId,
    reason: "reason" in event ? event.reason : undefined,
    attempt: "attempt" in event ? event.attempt : undefined,
    details: "transportGeneration" in event
      ? { transportGeneration: event.transportGeneration }
      : "nextRetryAt" in event
        ? { nextRetryAt: event.nextRetryAt }
        : undefined
  })
}

function recordSessionDiagnostic(logger: DiagnosticLogger, ownedEvent: OwnedTerminalSessionEvent): void {
  const event = ownedEvent.event
  if (event.kind !== "state") return
  logger.record({
    category: "session",
    action: "state",
    state: event.state,
    sessionId: event.sessionId,
    connectionId: event.connectionId,
    reason: event.reason,
    attempt: event.attempt,
    details: event.notice
      ? { notice: event.notice }
      : event.nextRetryAt
        ? { nextRetryAt: event.nextRetryAt }
        : undefined
  })
}

function recordForwardingDiagnostic(logger: DiagnosticLogger, event: ForwardingEvent): void {
  logger.record({
    category: "forwarding",
    action: event.kind,
    connectionId: event.connectionId,
    reason: event.reason
  })
}

function recordWindowDiagnostic(logger: DiagnosticLogger, event: WindowLifecycleEvent): void {
  if (event.kind === "window-closed") {
    logger.record({ category: "window", action: event.kind, details: { webContentsId: event.webContentsId } })
    return
  }
  logger.record({
    category: "window",
    action: event.kind,
    details: {
      webContentsId: event.owner.webContentsId,
      rendererGeneration: event.owner.rendererGeneration
    }
  })
}

function recordMonitoringDiagnostic(logger: DiagnosticLogger, event: MonitoringEvent): void {
  logger.record({ category: "monitoring", action: event.kind, sessionId: event.sessionId, reason: event.reason })
}

bootstrapPrimaryInstance(app, {
  start: startApplication,
  focusExisting: () => {
    if (!runtime) {
      pendingFocus = true
      return
    }
    runtime.windows.focusMostRecentOrCreate()
  },
  onStartError: () => app.quit()
})

app.on("before-quit", (event) => {
  if (shutdown || !runtime) return
  event.preventDefault()
  shutdown = shutdownApplication(runtime)
  void shutdown.finally(() => app.quit())
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
