import type { HostProfile } from "../storage/types"
import type { SessionEvent, SessionInfo } from "../ssh/ssh-manager"

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
  sessionEvent: "rocker:sessions:event"
} as const
