import { app, BrowserWindow, dialog } from "electron"
import { join } from "node:path"
import { registerIpcHandlers, type IpcDependencies } from "./ipc/register"
import { ipcChannels } from "./ipc/bridge-contract"
import { CredentialVault } from "./storage/credentials"
import { JsonCredentialValueStore } from "./storage/credential-store"
import { createHostStore } from "./storage/host-store"
import { createSafeStorageCipher } from "./storage/safe-storage"
import { JsonHostKeyStore } from "./ssh/host-key-store"
import { SshManager } from "./ssh/ssh-manager"
import { ForwardingManager } from "./ports/forwarding-manager"
import { PortService } from "./ports/port-service"
import { LinuxMetricsSampler } from "./monitoring/linux-metrics"
import { HistoryStore } from "./storage/history-store"
import { SettingsStore } from "./storage/settings-store"

const windows = new Set<BrowserWindow>()

function createWindow(onReady?: (window: BrowserWindow) => void): BrowserWindow {
  const window = new BrowserWindow({
    minWidth: 1040,
    minHeight: 680,
    width: 1440,
    height: 900,
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
  windows.add(window)
  window.once("closed", () => windows.delete(window))
  window.webContents.once("did-finish-load", () => onReady?.(window))

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"))
  }
  return window
}

app.whenReady().then(() => {
  const userDataPath = app.getPath("userData")
  const window = createWindow()
  const sessions = new SshManager({
    hostKeys: new JsonHostKeyStore(join(userDataPath, "host-keys.json")),
    onUnknownHostKey: async ({ host, port, fingerprint }) => {
      const result = await dialog.showMessageBox(window, {
        type: "warning",
        title: "Unknown host fingerprint",
        message: `Trust ${host}:${port}?`,
        detail: `SHA256:${fingerprint}`,
        buttons: ["Cancel", "Trust"],
        defaultId: 0,
        cancelId: 0
      })
      return result.response === 1
    }
  })
  const forwarding = new ForwardingManager(sessions)
  const dependencies: IpcDependencies = {
    hosts: createHostStore(userDataPath),
    credentials: new CredentialVault(
      new JsonCredentialValueStore(join(userDataPath, "credentials.json")),
      createSafeStorageCipher()
    ),
    sessions,
    ports: new PortService(sessions),
    forwarding,
    monitoring: new LinuxMetricsSampler(sessions),
    history: new HistoryStore(join(userDataPath, "history.json")),
    settings: new SettingsStore(join(userDataPath, "settings.json")),
    getWindows: () => [...windows]
  }
  dependencies.createDuplicateWindow = async (hostId) => {
    createWindow((target) => {
      setTimeout(() => {
        if (!target.isDestroyed()) target.webContents.send(ipcChannels.sessionLaunch, { hostId })
      }, 100)
    })
  }
  registerIpcHandlers(window, dependencies)
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
