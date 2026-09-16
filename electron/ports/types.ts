import type { ForwardingLocalAddress, ForwardingProfile } from "../storage/types"

export type PortSource = "ss" | "netstat" | "manual"
export type PortStatus = "discovered" | "starting" | "forwarding" | "suspended" | "stopping" | "stopped" | "error"

export interface DiscoveredPort {
  id: string
  connectionId?: string
  sessionId?: string
  remoteAddress: string
  remotePort: number
  process?: string
  pid?: number
  user?: string
  source: PortSource
  status: PortStatus
}

export interface ForwardingSpec {
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
}

export interface ForwardingProfileRequest {
  name: string
  description?: string
  localAddress: ForwardingLocalAddress
  localPort: number
  remoteAddress: string
  remotePort: number
  autoStart: boolean
}

export interface ForwardingInfo extends ForwardingSpec {
  id: string
  connectionId?: string
  hostId?: string
  profileId?: string
  status: PortStatus
  error?: string
}

export interface ForwardingProfileView {
  profile: ForwardingProfile
  runtime?: ForwardingInfo
}
