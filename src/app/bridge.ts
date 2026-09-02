import type { RockerBridge } from "../../electron/ipc/bridge-contract"
import type { AppBootstrapSnapshot, BootstrapHostProfile, BootstrapResourceName } from "../../electron/ipc/bridge-contract"
import type { StorageHealth, StorageKind } from "../../electron/storage/storage-result"
import type { AppSettings, ForwardingInfo, HostProfile, StoredWorkspaceWindow } from "./types"

const demoHosts: HostProfile[] = [
  { id: "demo-g11", name: "G11", host: "47.97.162.53", port: 22, username: "root", authMethod: "agent", group: "Personal", favorite: true, notes: "" },
  { id: "demo-adcp", name: "WH-ADCP", host: "10.24.18.21", port: 22, username: "deploy", authMethod: "privateKey", group: "Production", favorite: false, notes: "" },
  { id: "demo-db", name: "Database", host: "db.internal", port: 2222, username: "ops", authMethod: "password", group: "Production", favorite: false, notes: "" }
]

type PreviewSession = {
  hostId: string
  connectionId: string
  channelGeneration: number
  nextSequence: number
}

type TerminalEvent = Parameters<RockerBridge["events"]["onSessionEvent"]>[0] extends (event: infer Event) => void ? Event : never

const mockListeners = new Set<(event: TerminalEvent) => void>()
const mockSessions = new Map<string, PreviewSession>()
const mockForwards = new Map<string, ForwardingInfo>()
let mockHosts = [...demoHosts]
let mockWorkspace: StoredWorkspaceWindow | undefined
let mockSettings: AppSettings = {
  locale: "en",
  sidebarWidth: 220,
  terminalFont: "JetBrains Mono",
  terminalFontSize: 13,
  connectionTimeout: 15,
  autoReconnect: true,
  reconnectMode: "limited",
  restorePreviousWorkspace: true,
  confirmMultilinePaste: true,
  bindAddress: "127.0.0.1"
}

export function getRockerBridge(): RockerBridge {
  if (window.rocker) return window.rocker
  return createBrowserPreviewBridge()
}

function createBrowserPreviewBridge(): RockerBridge {
  return {
    app: { platform: "browser" as NodeJS.Platform, minimize: async () => undefined, toggleMaximize: async () => undefined, close: async () => undefined },
    hosts: {
      list: async () => mockHosts,
      save: async ({ profile }) => {
        mockHosts = mockHosts.some((host) => host.id === profile.id)
          ? mockHosts.map((host) => host.id === profile.id ? profile : host)
          : [...mockHosts, profile]
      },
      remove: async (id) => { mockHosts = mockHosts.filter((host) => host.id !== id) },
      importSshConfig: async () => []
    },
    sessions: {
      open: async ({ sessionId, hostId }) => {
        const connectionId = `preview-${hostId}`
        const channelGeneration = 1
        mockSessions.set(sessionId, { hostId, connectionId, channelGeneration, nextSequence: 1 })
        window.setTimeout(() => emitMock({ kind: "state", sessionId, connectionId, channelGeneration, state: "connected" }), 100)
        window.setTimeout(() => emitPreviewOutput(sessionId, channelGeneration, `Rocker preview session for ${hostId}\r\n$ `), 160)
        return { sessionId, hostId, channelGeneration, state: "connected" }
      },
      write: async (sessionId, channelGeneration, data) => emitPreviewOutput(sessionId, channelGeneration, `preview:${data}`),
      resize: async () => undefined,
      ackOutput: async () => undefined,
      reconnect: async (sessionId) => {
        const session = mockSessions.get(sessionId)
        if (!session) return
        session.channelGeneration += 1
        session.nextSequence = 1
        emitMock({
          kind: "state",
          sessionId,
          connectionId: session.connectionId,
          channelGeneration: session.channelGeneration,
          state: "connected",
          notice: "reconnected"
        })
      },
      cancelReconnect: async (sessionId) => {
        const session = mockSessions.get(sessionId)
        if (!session) return
        emitMock({
          kind: "state",
          sessionId,
          connectionId: session.connectionId,
          channelGeneration: session.channelGeneration,
          state: "disconnected",
          reason: "cancelled"
        })
      },
      close: async (sessionId) => {
        const session = mockSessions.get(sessionId)
        if (!session) return
        mockSessions.delete(sessionId)
        emitMock({
          kind: "state",
          sessionId,
          connectionId: session.connectionId,
          channelGeneration: session.channelGeneration,
          state: "closing"
        })
      },
      beginRestore: async () => undefined,
      completeRestore: async () => undefined,
      duplicateInNewWindow: async () => undefined
    },
    ports: {
      scan: async () => [],
      start: async (connectionId, spec) => {
        const forwarding: ForwardingInfo = { ...spec, id: crypto.randomUUID(), connectionId, status: "forwarding" }
        mockForwards.set(forwarding.id, forwarding)
        return forwarding
      },
      resume: async (forwardingId) => {
        const forwarding = mockForwards.get(forwardingId)
        if (!forwarding) throw new Error("Port forwarding was not found")
        const resumed: ForwardingInfo = { ...forwarding, status: "forwarding" }
        mockForwards.set(forwardingId, resumed)
        return resumed
      },
      stop: async (forwardingId) => { mockForwards.delete(forwardingId) },
      list: async () => [...mockForwards.values()],
      openAddress: async () => undefined
    },
    workspace: {
      load: async () => mockWorkspace,
      save: async (snapshot) => {
        mockWorkspace = {
          workspaceId: mockWorkspace?.workspaceId ?? crypto.randomUUID(),
          bounds: mockWorkspace?.bounds,
          maximized: mockWorkspace?.maximized ?? false,
          ...snapshot
        }
      }
    },
    bootstrap: {
      load: async () => createPreviewBootstrapSnapshot(),
      retry: async (resources) => {
        validatePreviewBootstrapResources(resources)
        const snapshot = await createPreviewBootstrapSnapshot()
        const result: Partial<AppBootstrapSnapshot> = {}
        for (const resource of resources) result[resource] = snapshot[resource] as never
        return result
      }
    },
    monitor: {
      sample: async (sessionId) => ({ sessionId, latencyMs: 18, cpuPercent: 12, memoryPercent: 41, diskPercent: 58, loadAverage: 0.42, receiveBytesPerSecond: 0, transmitBytesPerSecond: 0, sampledAt: new Date().toISOString() })
    },
    history: {
      list: async () => [
        { id: "preview-history", hostId: "demo-g11", connectedAt: new Date(Date.now() - 36 * 60_000).toISOString(), durationMs: 742_000, outcome: "connected" }
      ],
      clear: async () => undefined
    },
    settings: {
      get: async () => ({ ...mockSettings }),
      update: async (update) => {
        mockSettings = { ...mockSettings, ...update }
        return { ...mockSettings }
      }
    },
    diagnostics: {
      export: async () => ({ canceled: true })
    },
    events: {
      onSessionEvent: (listener) => {
        mockListeners.add(listener)
        return () => mockListeners.delete(listener)
      },
      onSessionLaunch: () => () => undefined
    }
  }
}

async function createPreviewBootstrapSnapshot(): Promise<AppBootstrapSnapshot> {
  return {
    settings: { health: previewHealth("settings"), value: { ...mockSettings } },
    history: {
      health: previewHealth("history"),
      value: [
        { id: "preview-history", hostId: "demo-g11", connectedAt: "2026-01-01T00:00:00.000Z", durationMs: 742_000, outcome: "connected" }
      ]
    },
    workspace: { health: previewHealth("workspace"), value: mockWorkspace },
    hosts: { health: previewHealth("hosts"), value: mockHosts.map(toPreviewBootstrapHostProfile) },
    credentials: { health: previewHealth("credentials") },
    hostKeys: { health: previewHealth("hostKeys") }
  }
}

function toPreviewBootstrapHostProfile(profile: HostProfile): BootstrapHostProfile {
  const { identityFile: _identityFile, ...safeProfile } = profile
  return { ...safeProfile, hasIdentityFile: Boolean(profile.identityFile) }
}

function previewHealth(store: StorageKind): StorageHealth {
  return { store, status: "ok" }
}

function validatePreviewBootstrapResources(resources: BootstrapResourceName[]): void {
  const known: BootstrapResourceName[] = ["settings", "history", "workspace", "hosts", "credentials", "hostKeys"]
  if (!Array.isArray(resources) || resources.length === 0) throw new Error("Retry resources must be non-empty")
  if (resources.length > known.length) throw new Error("Retry resources must include at most six resources")
  const seen = new Set<string>()
  for (const resource of resources) {
    if (!known.includes(resource)) throw new Error("Retry resources must use known resource names")
    if (seen.has(resource)) throw new Error("Retry resources must not contain duplicates")
    seen.add(resource)
  }
}

function emitMock(event: TerminalEvent): void {
  for (const listener of mockListeners) listener(event)
}

function emitPreviewOutput(sessionId: string, channelGeneration: number, data: string): void {
  const session = mockSessions.get(sessionId)
  if (!session || session.channelGeneration !== channelGeneration) return
  emitMock({
    kind: "output",
    packet: {
      sessionId,
      channelGeneration,
      sequence: session.nextSequence++,
      bytes: new TextEncoder().encode(data)
    }
  })
}
