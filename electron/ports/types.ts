export type PortSource = "ss" | "netstat" | "manual"
export type PortStatus = "discovered" | "starting" | "forwarding" | "stopping" | "stopped" | "error"

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

export interface ForwardingInfo extends ForwardingSpec {
  id: string
  connectionId: string
  sessionId?: string
  status: PortStatus
  error?: string
}
