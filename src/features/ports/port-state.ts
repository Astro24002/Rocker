import type { DiscoveredPort, ForwardingInfo } from "../../app/types"

export interface PortViewState {
  ports: DiscoveredPort[]
  forwardings: ForwardingInfo[]
  loading: boolean
  error?: string
}

export function createPortState(): PortViewState {
  return { ports: [], forwardings: [], loading: false }
}

export function applyDiscoveredPorts(state: PortViewState, ports: DiscoveredPort[]): PortViewState {
  return { ...state, ports, loading: false, error: undefined }
}

export function applyForwarding(state: PortViewState, forwarding: ForwardingInfo): PortViewState {
  const exists = state.forwardings.some((item) => item.id === forwarding.id)
  return {
    ...state,
    forwardings: exists
      ? state.forwardings.map((item) => item.id === forwarding.id ? forwarding : item)
      : [...state.forwardings, forwarding],
    error: undefined
  }
}

export function setPortLoading(state: PortViewState, loading: boolean): PortViewState {
  return { ...state, loading }
}

export function setPortError(state: PortViewState, error: string): PortViewState {
  return { ...state, loading: false, error }
}
