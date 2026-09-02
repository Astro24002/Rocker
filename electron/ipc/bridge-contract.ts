import type {
  AppSettings,
  ConnectionHistoryItem,
  HostProfile,
  StoredTerminalLayout,
  StoredWorkspaceSession,
  StoredWorkspaceWindow
} from "../storage/types"
import type { HostMetrics } from "../monitoring/linux-metrics"
import type { DiscoveredPort, ForwardingInfo, ForwardingSpec } from "../ports/types"
import type { TerminalSessionEvent, TerminalSessionInfo } from "../ssh/types"
import type { StorageHealth } from "../storage/storage-result"

export interface DiagnosticsExportResult {
  canceled: boolean
  path?: string
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

export interface SessionLaunchRequest {
  hostId: string
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
    close(): Promise<void>
  }
  hosts: {
    list(): Promise<HostProfile[]>
    save(request: HostSaveRequest): Promise<void>
    remove(id: string): Promise<void>
    importSshConfig(): Promise<HostProfile[]>
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
    duplicateInNewWindow(hostId: string): Promise<void>
  }
  ports: {
    scan(connectionId: string): Promise<DiscoveredPort[]>
    start(connectionId: string, spec: ForwardingSpec): Promise<ForwardingInfo>
    resume(forwardingId: string): Promise<ForwardingInfo>
    stop(forwardingId: string): Promise<void>
    list(): Promise<ForwardingInfo[]>
    openAddress(forwardingId: string): Promise<void>
  }
  workspace: {
    load(): Promise<StoredWorkspaceWindow | undefined>
    save(snapshot: WorkspaceSaveRequest): Promise<void>
  }
  monitor: {
    sample(sessionId: string): Promise<HostMetrics>
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
  events: {
    onSessionEvent(listener: (event: TerminalSessionEvent) => void): () => void
    onSessionLaunch(listener: (request: SessionLaunchRequest) => void): () => void
  }
}

export const ipcChannels = {
  hostsList: "rocker:hosts:list",
  hostsSave: "rocker:hosts:save",
  hostsRemove: "rocker:hosts:remove",
  hostsImport: "rocker:hosts:import",
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
  workspaceLoad: "rocker:workspace:load",
  workspaceSave: "rocker:workspace:save",
  bootstrapLoad: "rocker:bootstrap:load",
  bootstrapRetry: "rocker:bootstrap:retry",
  monitorSample: "rocker:monitor:sample",
  historyList: "rocker:history:list",
  historyClear: "rocker:history:clear",
  settingsGet: "rocker:settings:get",
  settingsUpdate: "rocker:settings:update",
  diagnosticsExport: "rocker:diagnostics:export",
  windowMinimize: "rocker:window:minimize",
  windowToggleMaximize: "rocker:window:toggle-maximize",
  windowClose: "rocker:window:close",
  sessionLaunch: "rocker:window:session-launch"
} as const
