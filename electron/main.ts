import { app, BrowserWindow, dialog, powerMonitor } from "electron"
import { join } from "node:path"
import { registerIpcHandlers, type IpcDependencies } from "./ipc/register"
import { ipcChannels } from "./ipc/bridge-contract"
import { LinuxMetricsSampler } from "./monitoring/linux-metrics"
import { ForwardingManager } from "./ports/forwarding-manager"
import { PortService } from "./ports/port-service"
import { CredentialVault } from "./storage/credentials"
import { JsonCredentialValueStore } from "./storage/credential-store"
import { HistoryStore } from "./storage/history-store"
import { createHostStore } from "./storage/host-store"
import { createSafeStorageCipher } from "./storage/safe-storage"
import { SettingsStore } from "./storage/settings-store"
import type { AppSettings } from "./storage/types"
import { WorkspaceSnapshotStore } from "./storage/workspace-store"
import { SshConnectionManager, type HostKeyPromptRequest } from "./ssh/connection-manager"
import { createConnectionResolver } from "./ssh/connection-resolver"
import { JsonHostKeyStore } from "./ssh/host-key-store"
import { TerminalSessionManager } from "./ssh/terminal-session-manager"
import {
  WorkspaceWindowManager,
  type WorkspaceWindowOptions
} from "./windows/workspace-window-manager"

interface ApplicationRuntime {
  connections: SshConnectionManager
  sessions: TerminalSessionManager
  forwarding: ForwardingManager
  snapshots: WorkspaceSnapshotStore
  windows: WorkspaceWindowManager
}

let runtime: ApplicationRuntime | undefined
let shutdown: Promise<void> | undefined

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
  const hosts = createHostStore(userDataPath)
  const credentials = new CredentialVault(
    new JsonCredentialValueStore(join(userDataPath, "credentials.json")),
    createSafeStorageCipher()
  )
  const settings = new SettingsStore(join(userDataPath, "settings.json"))
  const initialSettings = await settings.get()
  const hostKeys = new JsonHostKeyStore(join(userDataPath, "host-keys.json"))
  const snapshots = new WorkspaceSnapshotStore(join(userDataPath, "workspace.json"))
  let windows: WorkspaceWindowManager
  const connections = new SshConnectionManager({
    resolve: createConnectionResolver({ hosts, credentials, settings, hostKeys }),
    hostKeys,
    maxRetryAttempts: retryLimit(initialSettings),
    promptForHostKey: async (request) => promptForHostKey(windows, request)
  })
  const sessions = new TerminalSessionManager({ connections })
  const forwarding = new ForwardingManager(connections)
  windows = new WorkspaceWindowManager({
    snapshots,
    createWindow: createNativeWindow,
    onWindowClosed: async (ownerWebContentsId) => {
      await forwarding.releaseOwner(ownerWebContentsId)
      await sessions.releaseOwner(ownerWebContentsId)
      await connections.releaseOwner(ownerWebContentsId)
    }
  })
  const dependencies: IpcDependencies = {
    hosts,
    credentials,
    sessions,
    connections,
    ports: new PortService(connections),
    forwarding,
    monitoring: new LinuxMetricsSampler(sessions),
    history: new HistoryStore(join(userDataPath, "history.json")),
    settings,
    windows
  }
  dependencies.createDuplicateWindow = async (hostId) => {
    const target = windows.createNew()
    target.webContents.once("did-finish-load", () => {
      if (!target.isDestroyed()) target.webContents.send(ipcChannels.sessionLaunch, { hostId })
    })
  }
  registerIpcHandlers(dependencies)

  const restored = initialSettings.restorePreviousWorkspace ? await windows.restoreWindows() : []
  if (restored.length === 0) windows.createNew()
  powerMonitor.on("resume", () => sessions.retryAfterResume())
  app.on("activate", () => {
    if (windows.ownerWebContentsIds().length === 0) windows.createNew()
  })
  runtime = { connections, sessions, forwarding, snapshots, windows }
}

function retryLimit(settings: AppSettings): number {
  if (!settings.autoReconnect) return 0
  return settings.reconnectMode === "continuous" ? Number.POSITIVE_INFINITY : 8
}

async function promptForHostKey(windows: WorkspaceWindowManager, request: HostKeyPromptRequest): Promise<boolean> {
  const target = windows.windowForWebContents(request.ownerWebContentsId)
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
  try {
    await applicationRuntime.snapshots.flush()
  } catch {
    // Shutdown should still release active transports when a snapshot write fails.
  }
  await Promise.all(applicationRuntime.windows.ownerWebContentsIds().map(async (ownerWebContentsId) => {
    await applicationRuntime.forwarding.releaseOwner(ownerWebContentsId)
    await applicationRuntime.sessions.releaseOwner(ownerWebContentsId)
    await applicationRuntime.connections.releaseOwner(ownerWebContentsId)
  }))
}

void app.whenReady().then(startApplication).catch(() => {
  app.quit()
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
