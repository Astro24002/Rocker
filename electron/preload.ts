import { contextBridge, ipcRenderer } from "electron"
import { ipcChannels, type RockerBridge } from "./ipc/bridge-contract"
import type { SessionEvent } from "./ssh/ssh-manager"
import type { SessionLaunchRequest } from "./ipc/bridge-contract"

const bridge: RockerBridge = {
  app: {
    platform: process.platform,
    minimize: () => ipcRenderer.invoke(ipcChannels.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(ipcChannels.windowToggleMaximize),
    close: () => ipcRenderer.invoke(ipcChannels.windowClose)
  },
  hosts: {
    list: () => ipcRenderer.invoke(ipcChannels.hostsList),
    save: (request) => ipcRenderer.invoke(ipcChannels.hostsSave, request),
    remove: (id) => ipcRenderer.invoke(ipcChannels.hostsRemove, id),
    importSshConfig: () => ipcRenderer.invoke(ipcChannels.hostsImport)
  },
  sessions: {
    open: (request) => ipcRenderer.invoke(ipcChannels.sessionOpen, request),
    write: (sessionId, data) => ipcRenderer.invoke(ipcChannels.sessionWrite, sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.invoke(ipcChannels.sessionResize, sessionId, cols, rows),
    close: (sessionId) => ipcRenderer.invoke(ipcChannels.sessionClose, sessionId),
    reconnect: (sessionId) => ipcRenderer.invoke(ipcChannels.sessionReconnect, sessionId),
    duplicateInNewWindow: (hostId) => ipcRenderer.invoke(ipcChannels.sessionDuplicateWindow, hostId)
  },
  ports: {
    scan: (sessionId) => ipcRenderer.invoke(ipcChannels.portsScan, sessionId),
    start: (sessionId, spec) => ipcRenderer.invoke(ipcChannels.portsStart, sessionId, spec),
    stop: (forwardingId) => ipcRenderer.invoke(ipcChannels.portsStop, forwardingId),
    list: () => ipcRenderer.invoke(ipcChannels.portsList),
    openAddress: (forwardingId) => ipcRenderer.invoke(ipcChannels.portsOpenAddress, forwardingId)
  },
  monitor: {
    sample: (sessionId) => ipcRenderer.invoke(ipcChannels.monitorSample, sessionId)
  },
  history: {
    list: () => ipcRenderer.invoke(ipcChannels.historyList),
    clear: () => ipcRenderer.invoke(ipcChannels.historyClear)
  },
  settings: {
    get: () => ipcRenderer.invoke(ipcChannels.settingsGet),
    update: (update) => ipcRenderer.invoke(ipcChannels.settingsUpdate, update)
  },
  events: {
    onSessionEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SessionEvent): void => listener(payload)
      ipcRenderer.on(ipcChannels.sessionEvent, handler)
      return () => ipcRenderer.removeListener(ipcChannels.sessionEvent, handler)
    },
    onSessionLaunch: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SessionLaunchRequest): void => listener(payload)
      ipcRenderer.on(ipcChannels.sessionLaunch, handler)
      return () => ipcRenderer.removeListener(ipcChannels.sessionLaunch, handler)
    }
  }
}

contextBridge.exposeInMainWorld("rocker", bridge)
