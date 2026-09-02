import type { AppBootstrapSnapshot, BootstrapResourceName } from "../../electron/ipc/bridge-contract"

export const bootstrapResourceNames: BootstrapResourceName[] = [
  "settings",
  "history",
  "workspace",
  "hosts",
  "credentials",
  "hostKeys"
]

export type BootstrapPhase = "loading" | "ready" | "degraded/recoverable" | "degraded/blocked" | "error"

export interface BootstrapState {
  phase: BootstrapPhase
  resources: Partial<AppBootstrapSnapshot>
  retrying: BootstrapResourceName[]
  failedResources: BootstrapResourceName[]
  error?: boolean
}

export type BootstrapResources = Partial<AppBootstrapSnapshot>

export type BootstrapAction =
  | { type: "load-start" }
  | { type: "load-success"; snapshot: AppBootstrapSnapshot }
  | { type: "load-error" }
  | { type: "retry-start"; resources: BootstrapResourceName[] }
  | { type: "retry-success"; resources: Partial<AppBootstrapSnapshot> }
  | { type: "retry-error"; resources: BootstrapResourceName[] }

export interface BootstrapCapabilities {
  workspaceWritable: boolean
  sshAvailable: boolean
  hostMutationsAvailable: boolean
  settingsWritable: boolean
  historyWritable: boolean
  blocked: BootstrapResourceName[]
  notices: BootstrapResourceName[]
}

export function createBootstrapState(): BootstrapState {
  return { phase: "loading", resources: {}, retrying: [], failedResources: [] }
}

export function bootstrapReducer(state: BootstrapState, action: BootstrapAction): BootstrapState {
  switch (action.type) {
    case "load-start":
      return createBootstrapState()
    case "load-success":
      return {
        phase: phaseForResources(action.snapshot),
        resources: action.snapshot,
        retrying: [],
        failedResources: []
      }
    case "load-error":
      return { phase: "error", resources: {}, retrying: [], failedResources: [...bootstrapResourceNames], error: true }
    case "retry-start":
      return { ...state, retrying: [...action.resources], failedResources: [], error: false }
    case "retry-success": {
      const resources = { ...state.resources, ...action.resources }
      return { phase: phaseForResources(resources), resources, retrying: [], failedResources: [], error: false }
    }
    case "retry-error":
      return { ...state, retrying: [], failedResources: [...action.resources], error: true }
  }
}

export function deriveBootstrapCapabilities(input: AppBootstrapSnapshot | BootstrapResources | BootstrapState): BootstrapCapabilities {
  const resources = isBootstrapState(input) ? input.resources : input
  const blocked = bootstrapResourceNames.filter((name) => resources[name]?.health?.status === "blocked")
  const notices = bootstrapResourceNames.filter((name) => {
    const status = resources[name]?.health
    return status?.status === "recovered" || (status?.status === "defaulted" && status.reason === "corrupt")
  })
  const hasError = isBootstrapState(input) && (input.phase === "error" || input.error === true)
  const workspaceHealth = resources.workspace?.health?.status
  const workspaceWritable = !hasError && (workspaceHealth === "ok" || workspaceHealth === "recovered" || workspaceHealth === "defaulted")
  const settingsWritable = !hasError && resources.settings?.health?.status !== undefined && resources.settings.health.status !== "blocked"
  const historyWritable = !hasError && resources.history?.health?.status !== undefined && resources.history.health.status !== "blocked"
  const securityResources: BootstrapResourceName[] = ["hosts", "credentials", "hostKeys"]
  const securityReady = !hasError && securityResources.every((name) => resources[name]?.health?.status !== undefined && resources[name]?.health?.status !== "blocked")

  return {
    workspaceWritable,
    sshAvailable: securityReady,
    hostMutationsAvailable: securityReady,
    settingsWritable,
    historyWritable,
    blocked,
    notices
  }
}

export function retryableBootstrapResources(input: AppBootstrapSnapshot | BootstrapResources | BootstrapState): BootstrapResourceName[] {
  if (isBootstrapState(input) && input.error) return input.failedResources.length > 0 ? [...input.failedResources] : [...bootstrapResourceNames]
  const resources = isBootstrapState(input) ? input.resources : input
  return bootstrapResourceNames.filter((name) => {
    const health = resources[name]?.health
    return health?.status === "blocked" || health?.status === "recovered" || (health?.status === "defaulted" && health.reason === "corrupt")
  })
}

export function phaseForResources(resources: Partial<AppBootstrapSnapshot>): BootstrapPhase {
  if (bootstrapResourceNames.some((name) => resources[name]?.health?.status === "blocked")) return "degraded/blocked"
  if (bootstrapResourceNames.some((name) => {
    const health = resources[name]?.health
    return health?.status === "recovered" || (health?.status === "defaulted" && health.reason === "corrupt")
  })) return "degraded/recoverable"
  return "ready"
}

function isBootstrapState(input: AppBootstrapSnapshot | BootstrapResources | BootstrapState): input is BootstrapState {
  return "phase" in input && "resources" in input
}
