import { describe, expect, it } from "vitest"
import type { AppBootstrapSnapshot, BootstrapResourceName } from "../../electron/ipc/bridge-contract"
import type { StorageHealth } from "../../electron/storage/storage-result"
import {
  bootstrapReducer,
  createBootstrapState,
  deriveBootstrapCapabilities,
  retryableBootstrapResources,
  type BootstrapState
} from "./bootstrap-state"

describe("bootstrap state", () => {
  it("keeps the workspace write gate closed when Workspace is blocked", () => {
    const snapshot = createSnapshot({ workspace: { health: health("workspace", "blocked") } })

    expect(deriveBootstrapCapabilities(snapshot)).toMatchObject({
      workspaceWritable: false,
      sshAvailable: true,
      blocked: ["workspace"]
    })
  })

  it("disables SSH operations when Host Keys are blocked without blocking Workspace writes", () => {
    const snapshot = createSnapshot({ hostKeys: { health: health("hostKeys", "blocked") } })

    expect(deriveBootstrapCapabilities(snapshot)).toMatchObject({
      workspaceWritable: true,
      sshAvailable: false,
      hostMutationsAvailable: false,
      blocked: ["hostKeys"]
    })
  })

  it("transitions to a recoverable degraded state for a corrupt default", () => {
    const snapshot = createSnapshot({ settings: { health: health("settings", "defaulted", { reason: "corrupt" }), value: undefined } })
    const state = bootstrapReducer(createBootstrapState(), { type: "load-success", snapshot })

    expect(state.phase).toBe("degraded/recoverable")
    expect(deriveBootstrapCapabilities(state).notices).toEqual(["settings"])
    expect(deriveBootstrapCapabilities(state).blocked).toEqual([])
  })

  it("does not treat a missing first-run default as a recovery notice", () => {
    const snapshot = createSnapshot({ history: { health: health("history", "defaulted", { reason: "missing" }), value: [] } })
    const state = bootstrapReducer(createBootstrapState(), { type: "load-success", snapshot })

    expect(state.phase).toBe("ready")
    expect(deriveBootstrapCapabilities(state).notices).toEqual([])
  })

  it("merges only selected retry resources and preserves successful values", () => {
    const initial = createSnapshot({
      hosts: { health: health("hosts", "blocked"), value: [] },
      history: { health: health("history", "ok"), value: [] }
    })
    const loaded = bootstrapReducer(createBootstrapState(), { type: "load-success", snapshot: initial })
    const retriedHosts = createResource("hosts", "ok", [{
      id: "host-2",
      name: "Recovered",
      host: "example.test",
      port: 22,
      username: "root",
      authMethod: "agent",
      hasIdentityFile: false,
      favorite: false,
      notes: ""
    }])
    const retried = bootstrapReducer(loaded, { type: "retry-success", resources: { hosts: retriedHosts } })

    expect(retried.resources.hosts).toEqual(retriedHosts)
    expect(retried.resources.history).toEqual(initial.history)
    expect(retriedBootstrapResources(retried)).toEqual([])
  })

  it("selects only non-ok resources with a meaningful recovery outcome for retry", () => {
    const snapshot = createSnapshot({
      settings: { health: health("settings", "defaulted", { reason: "missing" }), value: undefined },
      history: { health: health("history", "recovered", { source: "backup" }), value: [] },
      workspace: { health: health("workspace", "defaulted", { reason: "corrupt" }), value: undefined },
      hosts: { health: health("hosts", "blocked"), value: [] },
      credentials: { health: health("credentials", "ok") },
      hostKeys: { health: health("hostKeys", "ok") }
    })

    expect(retryableBootstrapResources(snapshot)).toEqual(["history", "workspace", "hosts"])
  })

  it("keeps a rejected initial bootstrap in an error phase and the write gate closed", () => {
    const state = bootstrapReducer(createBootstrapState(), { type: "load-error" })

    expect(state.phase).toBe("error")
    expect(deriveBootstrapCapabilities(state)).toMatchObject({
      workspaceWritable: false,
      sshAvailable: false,
      settingsWritable: false,
      historyWritable: false
    })
  })

  it("keeps rejected retry resources blocked and retries only that selection", () => {
    const loaded = bootstrapReducer(createBootstrapState(), { type: "load-success", snapshot: createSnapshot({ hosts: { health: health("hosts", "blocked"), value: [] } }) })
    const state = bootstrapReducer(loaded, { type: "retry-error", resources: ["hosts"] })

    expect(deriveBootstrapCapabilities(state)).toMatchObject({ workspaceWritable: false, sshAvailable: false })
    expect(retryableBootstrapResources(state)).toEqual(["hosts"])
  })
})

function retriedBootstrapResources(state: BootstrapState): BootstrapResourceName[] {
  return retryableBootstrapResources(state)
}

function createSnapshot(overrides: Partial<AppBootstrapSnapshot> = {}): AppBootstrapSnapshot {
  return {
    settings: createResource("settings", "ok", {
      locale: "en",
      sidebarWidth: 220,
      terminalFont: "JetBrains Mono",
      terminalFontSize: 13,
      scrollback: 10000,
      cursorStyle: "bar",
      cursorBlink: true,
      terminalBell: true,
      connectionTimeout: 15,
      autoReconnect: true,
      reconnectMode: "limited",
      restorePreviousWorkspace: true,
      confirmMultilinePaste: true,
      bindAddress: "127.0.0.1"
    }),
    history: createResource("history", "ok", []),
    workspace: createResource("workspace", "ok", undefined),
    hosts: createResource("hosts", "ok", []),
    credentials: { health: health("credentials", "ok") },
    hostKeys: { health: health("hostKeys", "ok") },
    ...overrides
  }
}

function createResource<K extends BootstrapResourceName, T>(store: K, status: StorageHealth["status"], value: T, details: Record<string, unknown> = {}) {
  return { health: health(store, status, details), value } as AppBootstrapSnapshot[K]
}

function health(store: BootstrapResourceName, status: StorageHealth["status"], details: Record<string, unknown> = {}): StorageHealth {
  return { store, status, ...details } as StorageHealth
}
