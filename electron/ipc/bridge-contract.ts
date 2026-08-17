import type { ConnectionHistoryItem, HostProfile } from "../storage/types"
import type { SessionEvent, SessionInfo } from "../ssh/ssh-manager"
import type { HostMetrics } from "../monitoring/linux-metrics"
import type { DiscoveredPort, ForwardingInfo, ForwardingSpec } from "../ports/types"

export interface HostSaveRequest {
  profile: HostProfile
  credentials?: {
    password?: string
    passphrase?: string
  }
}

export interface SessionOpenRequest {
  hostId: string
  cols: number
  rows: number
}

export interface RockerBridge {
  app: {
    platform: NodeJS.Platform
  }
  hosts: {
    list(): Promise<HostProfile[]>
    save(request: HostSaveRequest): Promise<void>
    remove(id: string): Promise<void>
    importSshConfig(): Promise<HostProfile[]>
  }
  sessions: {
    open(request: SessionOpenRequest): Promise<SessionInfo>
    write(sessionId: string, data: string): Promise<void>
    resize(sessionId: string, cols: number, rows: number): Promise<void>
    close(sessionId: string): Promise<void>
    reconnect(sessionId: string): Promise<SessionInfo>
  }
  ports: {
    scan(sessionId: string): Promise<DiscoveredPort[]>
    start(sessionId: string, spec: ForwardingSpec): Promise<ForwardingInfo>
    stop(forwardingId: string): Promise<void>
    list(): Promise<ForwardingInfo[]>
    openAddress(forwardingId: string): Promise<void>
  }
  monitor: {
    sample(sessionId: string): Promise<HostMetrics>
  }
  history: {
    list(): Promise<ConnectionHistoryItem[]>
    clear(): Promise<void>
  }
  events: {
    onSessionEvent(listener: (event: SessionEvent) => void): () => void
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
  sessionClose: "rocker:sessions:close",
  sessionReconnect: "rocker:sessions:reconnect",
  sessionEvent: "rocker:sessions:event",
  portsScan: "rocker:ports:scan",
  portsStart: "rocker:ports:start",
  portsStop: "rocker:ports:stop",
  portsList: "rocker:ports:list",
  portsOpenAddress: "rocker:ports:open-address",
  monitorSample: "rocker:monitor:sample",
  historyList: "rocker:history:list",
  historyClear: "rocker:history:clear"
} as const
