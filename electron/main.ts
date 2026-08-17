import { app, BrowserWindow, dialog } from "electron"
import { join } from "node:path"
import { registerIpcHandlers } from "./ipc/register"
import { CredentialVault } from "./storage/credentials"
import { JsonCredentialValueStore } from "./storage/credential-store"
import { createHostStore } from "./storage/host-store"
import { createSafeStorageCipher } from "./storage/safe-storage"
import { JsonHostKeyStore } from "./ssh/host-key-store"
import { SshManager } from "./ssh/ssh-manager"
import { ForwardingManager } from "./ports/forwarding-manager"
import { PortService } from "./ports/port-service"
import { LinuxMetricsSampler } from "./monitoring/linux-metrics"

let mainWindow: BrowserWindow | undefined

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    minWidth: 1040,
    minHeight: 680,
    width: 1440,
    height: 900,
    backgroundColor: "#0f1118",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "../preload/index.cjs")
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }
  return mainWindow
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
  registerIpcHandlers(window, {
    hosts: createHostStore(userDataPath),
    credentials: new CredentialVault(
      new JsonCredentialValueStore(join(userDataPath, "credentials.json")),
      createSafeStorageCipher()
    ),
    sessions,
    ports: new PortService(sessions),
    forwarding,
    monitoring: new LinuxMetricsSampler(sessions)
  })
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
