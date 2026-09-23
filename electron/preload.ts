import { contextBridge, ipcRenderer } from "electron"
import {
  ipcChannels,
  type AppBootstrapSnapshot,
  type BootstrapResourceName,
  type ConfigurationImportRequest,
  type RockerBridge
} from "./ipc/bridge-contract"
import type { TerminalSessionEvent } from "./ssh/types"
import type { ForwardingRuntimeEvent, SessionLaunchRequest, SftpRuntimeEvent } from "./ipc/bridge-contract"

const bridge: RockerBridge = {
  app: {
    platform: process.platform,
    minimize: () => ipcRenderer.invoke(ipcChannels.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(ipcChannels.windowToggleMaximize),
    isMaximized: () => ipcRenderer.invoke(ipcChannels.windowIsMaximized),
    close: () => ipcRenderer.invoke(ipcChannels.windowClose)
  },
  hosts: {
    list: () => ipcRenderer.invoke(ipcChannels.hostsList),
    save: (request) => ipcRenderer.invoke(ipcChannels.hostsSave, request),
    duplicate: (id) => ipcRenderer.invoke(ipcChannels.hostsDuplicate, id),
    setFavorite: (id, favorite) => ipcRenderer.invoke(ipcChannels.hostsSetFavorite, id, favorite),
    remove: (id) => ipcRenderer.invoke(ipcChannels.hostsRemove, id),
    importSshConfig: () => ipcRenderer.invoke(ipcChannels.hostsImport),
    testConnection: (id) => ipcRenderer.invoke(ipcChannels.hostsTestConnection, id)
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
    duplicateInNewWindow: (request) => ipcRenderer.invoke(ipcChannels.sessionDuplicateWindow, request)
  },
  ports: {
    scan: (connectionId) => ipcRenderer.invoke(ipcChannels.portsScan, connectionId),
    start: (connectionId, spec) => ipcRenderer.invoke(ipcChannels.portsStart, connectionId, spec),
    resume: (forwardingId) => ipcRenderer.invoke(ipcChannels.portsResume, forwardingId),
    stop: (forwardingId) => ipcRenderer.invoke(ipcChannels.portsStop, forwardingId),
    list: () => ipcRenderer.invoke(ipcChannels.portsList),
    listOverview: () => ipcRenderer.invoke(ipcChannels.portsListOverview),
    listForHost: (hostId) => ipcRenderer.invoke(ipcChannels.portsListForHost, hostId),
    createProfile: (hostId, request) => ipcRenderer.invoke(ipcChannels.portsCreateProfile, hostId, request),
    updateProfile: (profileId, request) => ipcRenderer.invoke(ipcChannels.portsUpdateProfile, profileId, request),
    removeProfile: (profileId) => ipcRenderer.invoke(ipcChannels.portsRemoveProfile, profileId),
    startProfile: (profileId) => ipcRenderer.invoke(ipcChannels.portsStartProfile, profileId),
    openAddress: (forwardingId) => ipcRenderer.invoke(ipcChannels.portsOpenAddress, forwardingId)
  },
  sftp: {
    listLocal: (path) => ipcRenderer.invoke(ipcChannels.sftpListLocal, path),
    open: (workspaceId, hostId) => ipcRenderer.invoke(ipcChannels.sftpOpen, workspaceId, hostId),
    close: (workspaceId) => ipcRenderer.invoke(ipcChannels.sftpClose, workspaceId),
    list: (workspaceId, path) => ipcRenderer.invoke(ipcChannels.sftpList, workspaceId, path),
    mkdir: (workspaceId, path) => ipcRenderer.invoke(ipcChannels.sftpMkdir, workspaceId, path),
    rename: (workspaceId, path, nextPath) => ipcRenderer.invoke(ipcChannels.sftpRename, workspaceId, path, nextPath),
    move: (workspaceId, path, nextPath, kind) => ipcRenderer.invoke(ipcChannels.sftpMove, workspaceId, path, nextPath, kind),
    remove: (workspaceId, path, kind) => ipcRenderer.invoke(ipcChannels.sftpRemove, workspaceId, path, kind),
    chooseUpload: (workspaceId, remoteDirectory, localPath) => ipcRenderer.invoke(ipcChannels.sftpChooseUpload, workspaceId, remoteDirectory, localPath),
    chooseDownload: (workspaceId, remotePath, suggestedName) => ipcRenderer.invoke(ipcChannels.sftpChooseDownload, workspaceId, remotePath, suggestedName),
    upload: (selectionId, overwrite) => ipcRenderer.invoke(ipcChannels.sftpUpload, selectionId, overwrite),
    download: (selectionId, overwrite) => ipcRenderer.invoke(ipcChannels.sftpDownload, selectionId, overwrite),
    listTransfers: (workspaceId) => ipcRenderer.invoke(ipcChannels.sftpListTransfers, workspaceId),
    cancelTransfer: (taskId) => ipcRenderer.invoke(ipcChannels.sftpCancelTransfer, taskId),
    retryTransfer: (taskId) => ipcRenderer.invoke(ipcChannels.sftpRetryTransfer, taskId)
  },
  workspace: {
    load: () => ipcRenderer.invoke(ipcChannels.workspaceLoad),
    save: (snapshot) => ipcRenderer.invoke(ipcChannels.workspaceSave, snapshot)
  },
  bootstrap: {
    load: (): Promise<AppBootstrapSnapshot> => ipcRenderer.invoke(ipcChannels.bootstrapLoad),
    retry: (resources: BootstrapResourceName[]): Promise<Partial<AppBootstrapSnapshot>> => ipcRenderer.invoke(ipcChannels.bootstrapRetry, resources)
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
  configuration: {
    exportTemplate: () => ipcRenderer.invoke(ipcChannels.configExportTemplate),
    exportBundle: (password) => ipcRenderer.invoke(ipcChannels.configExportBundle, password),
    chooseImport: () => ipcRenderer.invoke(ipcChannels.configImportChoose),
    previewImport: (importId, password) => ipcRenderer.invoke(ipcChannels.configImportPreview, { importId, password }),
    applyImport: (request: ConfigurationImportRequest) => ipcRenderer.invoke(ipcChannels.configImportApply, request)
  },
  credentials: {
    protectionStatus: () => ipcRenderer.invoke(ipcChannels.credentialProtectionStatus),
    enableVault: (password) => ipcRenderer.invoke(ipcChannels.credentialVaultEnable, password),
    unlockVault: (password) => ipcRenderer.invoke(ipcChannels.credentialVaultUnlock, password),
    lockVault: () => ipcRenderer.invoke(ipcChannels.credentialVaultLock),
    disableVault: () => ipcRenderer.invoke(ipcChannels.credentialVaultDisable)
  },
  hostKeys: {
    list: () => ipcRenderer.invoke(ipcChannels.hostKeysList),
    remove: (request) => ipcRenderer.invoke(ipcChannels.hostKeysRemove, request)
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
    },
    onForwardingEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: ForwardingRuntimeEvent): void => listener(payload)
      ipcRenderer.on(ipcChannels.portsEvent, handler)
      return () => ipcRenderer.removeListener(ipcChannels.portsEvent, handler)
    },
    onSftpEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SftpRuntimeEvent): void => listener(payload)
      ipcRenderer.on(ipcChannels.sftpEvent, handler)
      return () => ipcRenderer.removeListener(ipcChannels.sftpEvent, handler)
    }
  }
}

contextBridge.exposeInMainWorld("rocker", bridge)
