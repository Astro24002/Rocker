import type {
  AppSettings,
  ConnectionHistoryItem,
  HostProfile,
  StoredTerminalLayout,
  StoredWorkspaceSession,
  StoredWorkspaceWindow,
  ForwardingProfile
} from "../storage/types"
import type { DiscoveredPort, ForwardingInfo, ForwardingProfileRequest, ForwardingProfileView, ForwardingSpec } from "../ports/types"
import type { ConnectionTestResult, TerminalSessionEvent, TerminalSessionInfo } from "../ssh/types"
import type { StorageHealth } from "../storage/storage-result"
import type { ConflictResolution, ImportPreview, ImportResult } from "../storage/config-bundle"
import type { CredentialProtectionStatus } from "../storage/credentials"
import type { HostKeyAuditRecord as StoredHostKeyAuditRecord, StoredHostKeyRecord } from "../ssh/host-keys"
import type {
  OwnedSftpRuntimeEvent,
  SftpDirectory,
  SftpDownloadSelection,
  SftpTransferStartResult,
  SftpTransferTask,
  SftpUploadSelection,
  SftpWorkspaceInfo
} from "../sftp/types"

export type HostKeyInventoryEntry = StoredHostKeyRecord
export type HostKeyAuditRecord = StoredHostKeyAuditRecord

export interface HostKeyInventorySnapshot {
  entries: HostKeyInventoryEntry[]
  history: HostKeyAuditRecord[]
}

export interface HostKeyRemovalRequest {
  host: string
  port: number
  fingerprint: string
}

export interface DiagnosticsExportResult {
  canceled: boolean
  path?: string
}

export interface ConfigurationExportResult {
  canceled: boolean
  path?: string
}

export interface ConfigurationImportChooseResult {
  canceled: boolean
  importId?: string
  preview?: ImportPreview
}

export interface ConfigurationImportRequest {
  importId: string
  password?: string
  resolution: ConflictResolution
}

export type BootstrapHostProfile = Omit<HostProfile, "identityFile"> & {
  hasIdentityFile: boolean
}

export type HostSaveProfile = HostProfile | BootstrapHostProfile

export interface HostSaveRequest {
  profile: HostSaveProfile
  credentials?: {
    password?: string
    passphrase?: string
  }
}

export interface SessionOpenRequest {
  sessionId: string
  hostId: string
  cols: number
  rows: number
  forceNewConnection?: boolean
  restorePriority?: "active" | "background"
}

export interface WorkspaceSaveRequest {
  activeSessionId?: string
  sessions: StoredWorkspaceSession[]
  layout?: StoredTerminalLayout
}

export type { ForwardingProfileRequest }

export interface ForwardingRuntimeEvent {
  kind: "started" | "resumed" | "suspended" | "stopped" | "error"
  forwardingId?: string
  hostId?: string
  profileId?: string
  status?: ForwardingInfo["status"]
  reason?: string
}

export type SftpRuntimeEvent = OwnedSftpRuntimeEvent["event"]

export interface SessionLaunchRequest {
  hostId: string
  kind?: "ssh" | "sftp" | "pf"
  label?: string
  path?: string
  profileId?: string
  applicationProtocol?: "http" | "https"
}

export type BootstrapResourceName =
  | "settings"
  | "history"
  | "workspace"
  | "hosts"
  | "credentials"
  | "hostKeys"

export interface BootstrapResource<T> {
  health: StorageHealth
  value?: T
}

export interface AppBootstrapSnapshot {
  settings: BootstrapResource<AppSettings>
  history: BootstrapResource<ConnectionHistoryItem[]>
  workspace: BootstrapResource<StoredWorkspaceWindow | undefined>
  hosts: BootstrapResource<BootstrapHostProfile[]>
  credentials: BootstrapResource<never>
  hostKeys: BootstrapResource<never>
}

export interface RockerBridge {
  app: {
    platform: NodeJS.Platform
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    isMaximized(): Promise<boolean>
    close(): Promise<void>
  }
  hosts: {
    list(): Promise<HostProfile[]>
    save(request: HostSaveRequest): Promise<void>
    duplicate(id: string): Promise<HostProfile>
    setFavorite(id: string, favorite: boolean): Promise<HostProfile>
    remove(id: string): Promise<void>
    importSshConfig(): Promise<HostProfile[]>
    testConnection(id: string): Promise<ConnectionTestResult>
  }
  sessions: {
    open(request: SessionOpenRequest): Promise<TerminalSessionInfo>
    write(sessionId: string, channelGeneration: number, data: string): Promise<void>
    resize(sessionId: string, channelGeneration: number, cols: number, rows: number): Promise<void>
    ackOutput(sessionId: string, channelGeneration: number, sequence: number): Promise<void>
    reconnect(sessionId: string): Promise<void>
    cancelReconnect(sessionId: string): Promise<void>
    close(sessionId: string): Promise<void>
    beginRestore(activeSessionId: string): Promise<void>
    completeRestore(): Promise<void>
    duplicateInNewWindow(request: SessionLaunchRequest): Promise<void>
  }
  ports: {
    scan(connectionId: string): Promise<DiscoveredPort[]>
    start(connectionId: string, spec: ForwardingSpec): Promise<ForwardingInfo>
    resume(forwardingId: string): Promise<ForwardingInfo>
    stop(forwardingId: string): Promise<void>
    list(): Promise<ForwardingInfo[]>
    listOverview(): Promise<ForwardingProfileView[]>
    listForHost(hostId: string): Promise<ForwardingProfileView[]>
    createProfile(hostId: string, request: ForwardingProfileRequest): Promise<ForwardingProfile>
    updateProfile(profileId: string, request: ForwardingProfileRequest): Promise<ForwardingProfile>
    removeProfile(profileId: string): Promise<void>
    startProfile(profileId: string): Promise<ForwardingInfo>
    openAddress(forwardingId: string): Promise<void>
  }
  sftp: {
    listLocal(path?: string): Promise<SftpDirectory>
    open(workspaceId: string, hostId: string): Promise<SftpWorkspaceInfo>
    close(workspaceId: string): Promise<void>
    list(workspaceId: string, path: string): Promise<SftpDirectory>
    mkdir(workspaceId: string, path: string): Promise<void>
    rename(workspaceId: string, path: string, nextPath: string): Promise<void>
    move(workspaceId: string, path: string, nextPath: string, kind: "file" | "directory"): Promise<SftpTransferStartResult>
    remove(workspaceId: string, path: string, kind: "file" | "directory"): Promise<void>
    chooseUpload(workspaceId: string, remoteDirectory: string, localPath?: string): Promise<SftpUploadSelection | undefined>
    chooseDownload(workspaceId: string, remotePath: string, suggestedName: string): Promise<SftpDownloadSelection | undefined>
    upload(selectionId: string, overwrite?: boolean): Promise<SftpTransferStartResult>
    download(selectionId: string, overwrite?: boolean): Promise<SftpTransferStartResult>
    listTransfers(workspaceId?: string): Promise<SftpTransferTask[]>
    cancelTransfer(taskId: string): Promise<void>
    retryTransfer(taskId: string): Promise<SftpTransferStartResult>
  }
  workspace: {
    load(): Promise<StoredWorkspaceWindow | undefined>
    save(snapshot: WorkspaceSaveRequest): Promise<void>
  }
  history: {
    list(): Promise<ConnectionHistoryItem[]>
    clear(): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    update(update: Partial<AppSettings>): Promise<AppSettings>
  }
  bootstrap: {
    load(): Promise<AppBootstrapSnapshot>
    retry(resources: BootstrapResourceName[]): Promise<Partial<AppBootstrapSnapshot>>
  }
  diagnostics: {
    export(): Promise<DiagnosticsExportResult>
  }
  configuration: {
    exportTemplate(): Promise<ConfigurationExportResult>
    exportBundle(password: string): Promise<ConfigurationExportResult>
    chooseImport(): Promise<ConfigurationImportChooseResult>
    previewImport(importId: string, password?: string): Promise<ImportPreview>
    applyImport(request: ConfigurationImportRequest): Promise<ImportResult>
  }
  credentials: {
    protectionStatus(): Promise<CredentialProtectionStatus>
    enableVault(password: string): Promise<CredentialProtectionStatus>
    unlockVault(password: string): Promise<CredentialProtectionStatus>
    lockVault(): Promise<CredentialProtectionStatus>
    disableVault(): Promise<CredentialProtectionStatus>
  }
  hostKeys: {
    list(): Promise<HostKeyInventorySnapshot>
    remove(request: HostKeyRemovalRequest): Promise<void>
  }
  events: {
    onSessionEvent(listener: (event: TerminalSessionEvent) => void): () => void
    onSessionLaunch(listener: (request: SessionLaunchRequest) => void): () => void
    onForwardingEvent(listener: (event: ForwardingRuntimeEvent) => void): () => void
    onSftpEvent(listener: (event: SftpRuntimeEvent) => void): () => void
  }
}

export const ipcChannels = {
  hostsList: "rocker:hosts:list",
  hostsSave: "rocker:hosts:save",
  hostsDuplicate: "rocker:hosts:duplicate",
  hostsSetFavorite: "rocker:hosts:set-favorite",
  hostsRemove: "rocker:hosts:remove",
  hostsImport: "rocker:hosts:import",
  hostsTestConnection: "rocker:hosts:test-connection",
  sessionOpen: "rocker:sessions:open",
  sessionWrite: "rocker:sessions:write",
  sessionResize: "rocker:sessions:resize",
  sessionAckOutput: "rocker:sessions:ack-output",
  sessionReconnect: "rocker:sessions:reconnect",
  sessionCancelReconnect: "rocker:sessions:cancel-reconnect",
  sessionClose: "rocker:sessions:close",
  sessionBeginRestore: "rocker:sessions:begin-restore",
  sessionCompleteRestore: "rocker:sessions:complete-restore",
  sessionDuplicateWindow: "rocker:sessions:duplicate-window",
  sessionEvent: "rocker:sessions:event",
  portsScan: "rocker:ports:scan",
  portsStart: "rocker:ports:start",
  portsResume: "rocker:ports:resume",
  portsStop: "rocker:ports:stop",
  portsList: "rocker:ports:list",
  portsOpenAddress: "rocker:ports:open-address",
  portsListOverview: "rocker:ports:list-overview",
  portsListForHost: "rocker:ports:list-for-host",
  portsCreateProfile: "rocker:ports:create-profile",
  portsUpdateProfile: "rocker:ports:update-profile",
  portsRemoveProfile: "rocker:ports:remove-profile",
  portsStartProfile: "rocker:ports:start-profile",
  portsEvent: "rocker:ports:event",
  sftpOpen: "rocker:sftp:open",
  sftpListLocal: "rocker:sftp:list-local",
  sftpClose: "rocker:sftp:close",
  sftpList: "rocker:sftp:list",
  sftpMkdir: "rocker:sftp:mkdir",
  sftpRename: "rocker:sftp:rename",
  sftpMove: "rocker:sftp:move",
  sftpRemove: "rocker:sftp:remove",
  sftpChooseUpload: "rocker:sftp:choose-upload",
  sftpChooseDownload: "rocker:sftp:choose-download",
  sftpUpload: "rocker:sftp:upload",
  sftpDownload: "rocker:sftp:download",
  sftpListTransfers: "rocker:sftp:list-transfers",
  sftpCancelTransfer: "rocker:sftp:cancel-transfer",
  sftpRetryTransfer: "rocker:sftp:retry-transfer",
  sftpEvent: "rocker:sftp:event",
  workspaceLoad: "rocker:workspace:load",
  workspaceSave: "rocker:workspace:save",
  bootstrapLoad: "rocker:bootstrap:load",
  bootstrapRetry: "rocker:bootstrap:retry",
  historyList: "rocker:history:list",
  historyClear: "rocker:history:clear",
  settingsGet: "rocker:settings:get",
  settingsUpdate: "rocker:settings:update",
  diagnosticsExport: "rocker:diagnostics:export",
  configExportTemplate: "rocker:config:export-template",
  configExportBundle: "rocker:config:export-bundle",
  configImportChoose: "rocker:config:import-choose",
  configImportPreview: "rocker:config:import-preview",
  configImportApply: "rocker:config:import-apply",
  credentialProtectionStatus: "rocker:credentials:protection-status",
  credentialVaultEnable: "rocker:credentials:vault-enable",
  credentialVaultUnlock: "rocker:credentials:vault-unlock",
  credentialVaultLock: "rocker:credentials:vault-lock",
  credentialVaultDisable: "rocker:credentials:vault-disable",
  hostKeysList: "rocker:host-keys:list",
  hostKeysRemove: "rocker:host-keys:remove",
  windowMinimize: "rocker:window:minimize",
  windowToggleMaximize: "rocker:window:toggle-maximize",
  windowIsMaximized: "rocker:window:is-maximized",
  windowClose: "rocker:window:close",
  sessionLaunch: "rocker:window:session-launch"
} as const
