import { contextBridge, ipcRenderer } from "electron"
import { ipcChannels, type RockerBridge } from "./ipc/bridge-contract"
import type { TerminalSessionEvent } from "./ssh/types"
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
    write: (sessionId, channelGeneration, data) => ipcRenderer.invoke(ipcChannels.sessionWrite, sessionId, channelGeneration, data),
    resize: (sessionId, channelGeneration, cols, rows) => ipcRenderer.invoke(ipcChannels.sessionResize, sessionId, channelGeneration, cols, rows),
    ackOutput: (sessionId, channelGeneration, sequence) => ipcRenderer.invoke(ipcChannels.sessionAckOutput, sessionId, channelGeneration, sequence),
    close: (sessionId) => ipcRenderer.invoke(ipcChannels.sessionClose, sessionId),
    reconnect: (sessionId) => ipcRenderer.invoke(ipcChannels.sessionReconnect, sessionId),
    cancelReconnect: (sessionId) => ipcRenderer.invoke(ipcChannels.sessionCancelReconnect, sessionId),
    beginRestore: (activeSessionId) => ipcRenderer.invoke(ipcChannels.sessionBeginRestore, activeSessionId),
    completeRestore: () => ipcRenderer.invoke(ipcChannels.sessionCompleteRestore),
    duplicateInNewWindow: (hostId) => ipcRenderer.invoke(ipcChannels.sessionDuplicateWindow, hostId)
  },
  ports: {
    scan: (connectionId) => ipcRenderer.invoke(ipcChannels.portsScan, connectionId),
    start: (connectionId, spec) => ipcRenderer.invoke(ipcChannels.portsStart, connectionId, spec),
    resume: (forwardingId) => ipcRenderer.invoke(ipcChannels.portsResume, forwardingId),
    stop: (forwardingId) => ipcRenderer.invoke(ipcChannels.portsStop, forwardingId),
    list: () => ipcRenderer.invoke(ipcChannels.portsList),
    openAddress: (forwardingId) => ipcRenderer.invoke(ipcChannels.portsOpenAddress, forwardingId)
  },
  workspace: {
    load: () => ipcRenderer.invoke(ipcChannels.workspaceLoad),
    save: (snapshot) => ipcRenderer.invoke(ipcChannels.workspaceSave, snapshot)
  },
  bootstrap: {
    load: () => ipcRenderer.invoke(ipcChannels.bootstrapLoad),
    retry: (resources) => ipcRenderer.invoke(ipcChannels.bootstrapRetry, resources)
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
  diagnostics: {
    export: () => ipcRenderer.invoke(ipcChannels.diagnosticsExport)
  },
  events: {
    onSessionEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TerminalSessionEvent): void => listener(payload)
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
