import type { HostMetrics } from "../../app/types"

export interface MonitorState {
  expanded: boolean
  metrics?: HostMetrics
  error?: string
}

export function createMonitorState(): MonitorState {
  return { expanded: false }
}

export function toggleMonitor(state: MonitorState): MonitorState {
  return { ...state, expanded: !state.expanded }
}

export function applyMetrics(state: MonitorState, metrics: HostMetrics): MonitorState {
  return { ...state, metrics, error: undefined }
}

export function formatMetric(value: number | null | undefined, suffix = ""): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${Math.round(value)}${suffix}`
}
