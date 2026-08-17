import type { RockerBridge } from "../../electron/ipc/bridge-contract"
import type { HostProfile } from "./types"

const demoHosts: HostProfile[] = [
  { id: "demo-g11", name: "G11", host: "47.97.162.53", port: 22, username: "root", authMethod: "agent", group: "Personal", favorite: true, notes: "" },
  { id: "demo-adcp", name: "WH-ADCP", host: "10.24.18.21", port: 22, username: "deploy", authMethod: "privateKey", group: "Production", favorite: false, notes: "" },
  { id: "demo-db", name: "Database", host: "db.internal", port: 2222, username: "ops", authMethod: "password", group: "Production", favorite: false, notes: "" }
]

const mockListeners = new Set<(event: Parameters<RockerBridge["events"]["onSessionEvent"]>[0] extends (event: infer Event) => void ? Event : never) => void>()
let mockHosts = [...demoHosts]

export function getRockerBridge(): RockerBridge {
  if (window.rocker) return window.rocker
  return createBrowserPreviewBridge()
}

function createBrowserPreviewBridge(): RockerBridge {
  return {
    app: { platform: "browser" as NodeJS.Platform },
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
      open: async ({ hostId }) => {
        const sessionId = crypto.randomUUID()
        window.setTimeout(() => emitMock({ kind: "state", sessionId, state: "connected" }), 100)
        window.setTimeout(() => emitMock({ kind: "data", sessionId, data: `Rocker preview session for ${hostId}\\r\\n$ ` }), 160)
        return { sessionId, hostId, state: "connected" }
      },
      write: async (sessionId, data) => emitMock({ kind: "data", sessionId, data: `preview:${data}` }),
      resize: async () => undefined,
      close: async (sessionId) => emitMock({ kind: "state", sessionId, state: "closed" }),
      reconnect: async (sessionId) => ({ sessionId, hostId: sessionId, state: "connected" })
    },
    ports: {
      scan: async () => [],
      start: async (_sessionId, spec) => ({ ...spec, id: crypto.randomUUID(), sessionId: "preview", status: "forwarding" }),
      stop: async () => undefined,
      list: async () => [],
      openAddress: async () => undefined
    },
    monitor: {
      sample: async (sessionId) => ({ sessionId, latencyMs: 18, cpuPercent: 12, memoryPercent: 41, diskPercent: 58, receiveBytesPerSecond: 0, transmitBytesPerSecond: 0, sampledAt: new Date().toISOString() })
    },
    history: {
      list: async () => [
        { id: "preview-history", hostId: "demo-g11", connectedAt: new Date(Date.now() - 36 * 60_000).toISOString(), durationMs: 742_000, outcome: "connected" }
      ],
      clear: async () => undefined
    },
    events: {
      onSessionEvent: (listener) => {
        mockListeners.add(listener)
        return () => mockListeners.delete(listener)
      }
    }
  }
}

function emitMock(event: Parameters<RockerBridge["events"]["onSessionEvent"]>[0] extends (event: infer Event) => void ? Event : never): void {
  for (const listener of mockListeners) listener(event)
}
