import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AppBootstrapSnapshot, BootstrapHostProfile, RockerBridge } from "../../electron/ipc/bridge-contract"
import type { StorageHealth } from "../../electron/storage/storage-result"
import type { TerminalSessionEvent } from "../../electron/ssh/types"
import { clampSidebarWidth } from "../components/Sidebar"
import type { TerminalWorkspaceState } from "../features/terminal/session-state"
import App from "./App"
import type { HostProfile, StoredWorkspaceWindow } from "./types"

const terminalHarness = vi.hoisted(() => ({
  controller: {
    acceptOutput: vi.fn(),
    writeLocalNotice: vi.fn(),
    setChannelGeneration: vi.fn(),
    setConnected: vi.fn(),
    applyPreferences: vi.fn()
  },
  controllers: new Map<string, { applyPreferences: ReturnType<typeof vi.fn> }>(),
  registeredSessions: new Set<string>(),
  latestWorkspace: undefined as unknown
}))

vi.mock("../features/terminal/TerminalWorkspace", async () => {
  const React = await import("react")
  return {
    TerminalWorkspace: (props: {
      workspace: TerminalWorkspaceState
      overlay?: ReactNode
      onController(sessionId: string, controller: typeof terminalHarness.controller | undefined): void
      onResize(sessionId: string, channelGeneration: number, dimensions: { cols: number; rows: number }): void
    }) => {
      terminalHarness.latestWorkspace = props.workspace
      React.useEffect(() => {
        for (const session of props.workspace.sessions) {
          if (terminalHarness.registeredSessions.has(session.id)) continue
          terminalHarness.registeredSessions.add(session.id)
          props.onController(session.id, (terminalHarness.controllers.get(session.id) ?? terminalHarness.controller) as typeof terminalHarness.controller)
          props.onResize(session.id, session.channelGeneration, session.dimensions ?? { cols: 120, rows: 40 })
        }
      }, [props.workspace, props.onController, props.onResize])
      return <><div data-testid="terminal-workspace-mock">{props.workspace.sessions.map((session) => <span key={session.id}>{session.label}</span>)}</div>{props.overlay}</>
    }
  }
})

let bridge: ReturnType<typeof createBridge>
let sessionListener: ((event: TerminalSessionEvent) => void) | undefined

beforeEach(() => {
  localStorage.clear()
  terminalHarness.controller.acceptOutput.mockReset()
  terminalHarness.controller.writeLocalNotice.mockReset()
  terminalHarness.controller.setChannelGeneration.mockReset()
  terminalHarness.controller.setConnected.mockReset()
  terminalHarness.controller.applyPreferences.mockReset()
  terminalHarness.controllers.clear()
  terminalHarness.registeredSessions.clear()
  terminalHarness.latestWorkspace = undefined
  sessionListener = undefined
  bridge = createBridge()
  window.rocker = bridge as unknown as RockerBridge
})

describe("desktop workspace shell", () => {
  it("loads renderer data through one bootstrap request", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], undefined))
    render(<App />)

    await waitFor(() => expect(bridge.bootstrap.load).toHaveBeenCalledTimes(1))
    expect(bridge.hosts.list).not.toHaveBeenCalled()
    expect(bridge.history.list).not.toHaveBeenCalled()
    expect(bridge.settings.get).not.toHaveBeenCalled()
    expect(bridge.workspace.load).not.toHaveBeenCalled()
  })

  it("never saves workspace after bootstrap rejection", async () => {
    bridge.bootstrap.load.mockRejectedValue(new Error("bootstrap unavailable"))
    render(<App />)

    await waitFor(() => expect(bridge.bootstrap.load).toHaveBeenCalledTimes(1))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(bridge.workspace.save).not.toHaveBeenCalled()
  })

  it("offers a full bootstrap retry after a rejected load", async () => {
    bridge.bootstrap.load.mockRejectedValue(new Error("bootstrap unavailable"))
    bridge.bootstrap.retry.mockResolvedValue(bootstrapSnapshot([], undefined))
    render(<App />)

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }))
    await waitFor(() => expect(bridge.bootstrap.retry).toHaveBeenCalledWith(["settings", "history", "workspace", "hosts", "credentials", "hostKeys"]))
  })

  it("retries only failed bootstrap resources", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([], undefined, { hosts: { health: blockedHealth("hosts"), value: [] } }))
    bridge.bootstrap.retry.mockResolvedValue({ hosts: { health: okHealth("hosts"), value: [bootstrapHost(host)] } })
    render(<App />)

    const retry = await screen.findByRole("button", { name: "Retry" })
    fireEvent.click(retry)
    await waitFor(() => expect(bridge.bootstrap.retry).toHaveBeenCalledWith(["hosts"]))
    expect(bridge.bootstrap.load).toHaveBeenCalledTimes(1)
  })

  it("keeps the workspace save gate closed while a retry is rejected", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([], undefined, { hosts: { health: blockedHealth("hosts"), value: [] } }))
    bridge.bootstrap.retry.mockRejectedValue(new Error("retry unavailable"))
    render(<App />)

    await waitFor(() => expect(bridge.workspace.save).toHaveBeenCalled())
    bridge.workspace.save.mockClear()
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }))
    await waitFor(() => expect(bridge.bootstrap.retry).toHaveBeenCalledWith(["hosts"]))
    expect(bridge.workspace.save).not.toHaveBeenCalled()
  })

  it("disables security actions while keeping local navigation and settings available", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], undefined, {
      hosts: { health: blockedHealth("hosts"), value: [bootstrapHost(host)] }, credentials: { health: blockedHealth("credentials") }, hostKeys: { health: blockedHealth("hostKeys") }
    }))
    render(<App />)

    const addButtons = await screen.findAllByRole("button", { name: "Add host" })
    expect(addButtons.length).toBeGreaterThan(0)
    addButtons.forEach((button) => expect(button).toBeDisabled())
    expect(screen.getByRole("button", { name: "Import SSH config" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Export diagnostics" }).some((button) => !button.hasAttribute("disabled"))).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Local Terminal" }))
    expect(screen.getByText("No active sessions")).toBeInTheDocument()
  })

  it("resumes a queued workspace session after security resources recover", async () => {
    const storedWorkspace = workspaceSnapshot(host.id)
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], storedWorkspace, {
      hosts: { health: blockedHealth("hosts"), value: [] },
      credentials: { health: blockedHealth("credentials") },
      hostKeys: { health: blockedHealth("hostKeys") }
    }))
    bridge.bootstrap.retry.mockResolvedValue({
      hosts: { health: okHealth("hosts"), value: [bootstrapHost(host)] },
      credentials: { health: okHealth("credentials") },
      hostKeys: { health: okHealth("hostKeys") }
    })
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    expect(bridge.sessions.open).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }))

    await waitFor(() => expect(bridge.sessions.beginRestore).toHaveBeenCalledWith(storedWorkspace.activeSessionId))
    await waitFor(() => expect(bridge.sessions.open).toHaveBeenCalledWith(expect.objectContaining({ hostId: host.id })))
  })

  it("uses the modern professional tool shell", () => {
    render(<App />)

    expect(document.querySelector(".app-shell")).toHaveAttribute("data-ui-style", "modern-professional")
  })

  it("renders peer navigation entries from the reference layout", () => {
    render(<App />)

    expect(screen.getByRole("button", { name: "Hosts" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "SFTP" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Port Forwarding" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Snippets" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument()
  })

  it("switches locale without reloading", async () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "简体中文" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "简体中文" }))

    expect(screen.getByRole("button", { name: "主机" })).toBeInTheDocument()
  })

  it("keeps the terminal event subscription stable while switching locale", async () => {
    render(<App />)
    await waitFor(() => expect(bridge.events.onSessionEvent).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "简体中文" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "简体中文" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "主机" })).toBeInTheDocument())
    expect(bridge.events.onSessionEvent).toHaveBeenCalledTimes(1)
  })

  it("clamps the resizable sidebar", () => {
    expect(clampSidebarWidth(120)).toBe(180)
    expect(clampSidebarWidth(240)).toBe(240)
    expect(clampSidebarWidth(520)).toBe(360)
  })

  it("routes output packets to a controller without putting bytes in workspace state", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    await waitFor(() => expect(sessionListener).toBeTypeOf("function"))
    const packet = {
      sessionId: workspace().sessions[0].id,
      channelGeneration: 1,
      sequence: 1,
      bytes: Uint8Array.of(0xe4, 0xb8, 0xad)
    }
    sessionListener!({ kind: "output", packet })

    expect(terminalHarness.controller.acceptOutput).toHaveBeenCalledWith(packet)
    expect(workspace().sessions[0]).not.toHaveProperty("output")
  })

  it("keeps a missing restored host closable without opening a network session", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([], {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      maximized: false,
      sessions: [{ sessionId: "22222222-2222-4222-8222-222222222222", hostId: "missing", label: "Old host", cols: 120, rows: 40 }]
    }))
    render(<App />)

    await waitFor(() => expect(workspace().sessions[0]).toMatchObject({ state: "error", reason: "configuration" }))
    expect(screen.getAllByText("Old host")).not.toHaveLength(0)
    expect(bridge.sessions.open).not.toHaveBeenCalled()
  })

  it("keeps terminal recovery independent from a failed monitor sample", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    bridge.monitor.sample.mockRejectedValue(new Error("monitor unavailable"))
    render(<App />)

    await waitFor(() => expect(sessionListener).toBeTypeOf("function"))
    sessionListener!({
      kind: "state",
      sessionId: "22222222-2222-4222-8222-222222222222",
      connectionId: "connection-1",
      channelGeneration: 1,
      state: "connected"
    })
    await waitFor(() => expect(bridge.monitor.sample).toHaveBeenCalled())

    expect(bridge.sessions.close).not.toHaveBeenCalled()
    expect(bridge.sessions.reconnect).not.toHaveBeenCalled()
    expect(bridge.sessions.cancelReconnect).not.toHaveBeenCalled()
  })

  it("routes terminal recovery actions through the bridge and closes only explicitly", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    await waitFor(() => expect(sessionListener).toBeTypeOf("function"))
    const sessionId = workspace().sessions[0].id
    act(() => sessionListener!({ kind: "state", sessionId, connectionId: "connection-1", channelGeneration: 1, state: "reconnecting", attempt: 2 }))

    await waitFor(() => expect(screen.getByRole("button", { name: "Reconnect now" })).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Reconnect now" }))
    expect(bridge.sessions.reconnect).toHaveBeenCalledWith(sessionId)

    fireEvent.click(screen.getByRole("button", { name: "Cancel reconnect" }))
    expect(bridge.sessions.cancelReconnect).toHaveBeenCalledWith(sessionId)

    act(() => sessionListener!({ kind: "state", sessionId, connectionId: "connection-1", channelGeneration: 1, state: "disconnected", reason: "cancelled" }))
    expect(screen.getByTestId("terminal-workspace-mock")).toBeInTheDocument()

    act(() => sessionListener!({ kind: "state", sessionId, connectionId: "connection-1", channelGeneration: 1, state: "error", reason: "authentication" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Close session" })).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Close session" }))
    expect(bridge.sessions.close).toHaveBeenCalledWith(sessionId)
    expect(screen.queryByTestId("terminal-workspace-mock")).not.toBeInTheDocument()
  })

  it("submits hydrated workspace metadata without a renderer-side debounce", async () => {
    vi.useFakeTimers()
    try {
      bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
      render(<App />)

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(bridge.workspace.save).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("applies one debounced appearance update to every live terminal controller", async () => {
    vi.useFakeTimers()
    try {
      const firstController = { applyPreferences: vi.fn() }
      const secondController = { applyPreferences: vi.fn() }
      terminalHarness.controllers.set("22222222-2222-4222-8222-222222222222", firstController)
      terminalHarness.controllers.set("33333333-3333-4333-8333-333333333333", secondController)
      bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshotWithTwoSessions(host.id)))
      render(<App />)

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      fireEvent.click(screen.getByRole("button", { name: "Settings" }))
      fireEvent.change(screen.getByRole("combobox", { name: "Scrollback lines" }), { target: { value: "50000" } })

      expect(firstController.applyPreferences).toHaveBeenCalledWith(expect.objectContaining({ scrollback: 50000 }))
      expect(secondController.applyPreferences).toHaveBeenCalledWith(expect.objectContaining({ scrollback: 50000 }))
      expect(bridge.settings.update).not.toHaveBeenCalled()

      await act(async () => { vi.advanceTimersByTime(299) })
      expect(bridge.settings.update).not.toHaveBeenCalled()
      await act(async () => { vi.advanceTimersByTime(1) })
      expect(bridge.settings.update).toHaveBeenCalledTimes(1)
      expect(bridge.settings.update).toHaveBeenCalledWith({ scrollback: 50000 })
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps terminal appearance changes temporary when Settings persistence is blocked", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id), {
      settings: { health: blockedHealth("settings"), value: undefined }
    }))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    expect(screen.getByRole("status")).toHaveTextContent("settings storage is unavailable")
    fireEvent.change(screen.getByRole("combobox", { name: "Scrollback lines" }), { target: { value: "50000" } })

    expect(terminalHarness.controller.applyPreferences).toHaveBeenCalledWith(expect.objectContaining({ scrollback: 50000 }))
    expect(bridge.settings.update).not.toHaveBeenCalled()
  })
})

function workspace(): TerminalWorkspaceState {
  return terminalHarness.latestWorkspace as TerminalWorkspaceState
}

const host = {
  id: "host-a",
  name: "G11",
  host: "example.test",
  port: 22,
  username: "root",
  authMethod: "agent" as const,
  favorite: false,
  notes: ""
}

function workspaceSnapshot(hostId: string) {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    maximized: false,
    activeSessionId: "22222222-2222-4222-8222-222222222222",
    sessions: [{ sessionId: "22222222-2222-4222-8222-222222222222", hostId, label: "G11", cols: 120, rows: 40 }]
  }
}

function workspaceSnapshotWithTwoSessions(hostId: string) {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    maximized: false,
    activeSessionId: "22222222-2222-4222-8222-222222222222",
    sessions: [
      { sessionId: "22222222-2222-4222-8222-222222222222", hostId, label: "G11", cols: 120, rows: 40 },
      { sessionId: "33333333-3333-4333-8333-333333333333", hostId, label: "G11 copy", cols: 120, rows: 40 }
    ]
  }
}

function createBridge() {
  return {
    app: { platform: "linux" as NodeJS.Platform, minimize: vi.fn(async () => undefined), toggleMaximize: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
    hosts: {
      list: vi.fn(async (): Promise<HostProfile[]> => []),
      save: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      importSshConfig: vi.fn(async () => [])
    },
    sessions: {
      open: vi.fn(async ({ sessionId, hostId }: { sessionId: string; hostId: string }) => ({ sessionId, hostId, channelGeneration: 1, state: "connected" as const })),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      ackOutput: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      cancelReconnect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      beginRestore: vi.fn(async () => undefined),
      completeRestore: vi.fn(async () => undefined),
      duplicateInNewWindow: vi.fn(async () => undefined)
    },
    ports: {
      scan: vi.fn(async () => []),
      start: vi.fn(async () => ({ id: "forward-1", connectionId: "connection-1", localAddress: "127.0.0.1", localPort: 3000, remoteAddress: "127.0.0.1", remotePort: 3000, status: "forwarding" as const })),
      resume: vi.fn(async () => ({ id: "forward-1", connectionId: "connection-1", localAddress: "127.0.0.1", localPort: 3000, remoteAddress: "127.0.0.1", remotePort: 3000, status: "forwarding" as const })),
      stop: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
      openAddress: vi.fn(async () => undefined)
    },
    workspace: {
      load: vi.fn(async (): Promise<StoredWorkspaceWindow | undefined> => undefined),
      save: vi.fn(async () => undefined)
    },
    bootstrap: {
      load: vi.fn(async () => bootstrapSnapshot([], undefined)),
      retry: vi.fn(async () => ({}))
    },
    monitor: { sample: vi.fn(async (sessionId: string) => ({ sessionId, latencyMs: 1, cpuPercent: null, memoryPercent: null, diskPercent: null, loadAverage: null, receiveBytesPerSecond: null, transmitBytesPerSecond: null, sampledAt: "2026-08-19T12:00:00.000Z" })) },
    history: { list: vi.fn(async () => []), clear: vi.fn(async () => undefined) },
    settings: {
      get: vi.fn(async () => ({ locale: "en" as const, sidebarWidth: 220, terminalFont: "JetBrains Mono", terminalFontSize: 13, scrollback: 10000 as const, cursorStyle: "bar" as const, cursorBlink: true, terminalBell: true, connectionTimeout: 15, autoReconnect: true, reconnectMode: "limited" as const, restorePreviousWorkspace: true, confirmMultilinePaste: true, bindAddress: "127.0.0.1" as const })),
      update: vi.fn(async (update: object) => ({ locale: "en" as const, sidebarWidth: 220, terminalFont: "JetBrains Mono", terminalFontSize: 13, scrollback: 10000 as const, cursorStyle: "bar" as const, cursorBlink: true, terminalBell: true, connectionTimeout: 15, autoReconnect: true, reconnectMode: "limited" as const, restorePreviousWorkspace: true, confirmMultilinePaste: true, bindAddress: "127.0.0.1" as const, ...update }))
    },
    diagnostics: { export: vi.fn(async () => ({ canceled: true })) },
    events: {
      onSessionEvent: vi.fn((listener: (event: TerminalSessionEvent) => void) => {
        sessionListener = listener
        return vi.fn()
      }),
      onSessionLaunch: vi.fn(() => vi.fn())
    }
  }
}

function bootstrapSnapshot(hosts: HostProfile[], workspace: StoredWorkspaceWindow | undefined, overrides: Partial<AppBootstrapSnapshot> = {}): AppBootstrapSnapshot {
  return {
    settings: { health: okHealth("settings"), value: {
      locale: "en", sidebarWidth: 220, terminalFont: "JetBrains Mono", terminalFontSize: 13,
      scrollback: 10000, cursorStyle: "bar", cursorBlink: true, terminalBell: true,
      connectionTimeout: 15, autoReconnect: true, reconnectMode: "limited", restorePreviousWorkspace: true,
      confirmMultilinePaste: true, bindAddress: "127.0.0.1"
    } },
    history: { health: okHealth("history"), value: [] },
    workspace: { health: okHealth("workspace"), value: workspace },
    hosts: { health: okHealth("hosts"), value: hosts.map(bootstrapHost) },
    credentials: { health: okHealth("credentials") },
    hostKeys: { health: okHealth("hostKeys") },
    ...overrides
  }
}

function bootstrapHost(profile: HostProfile): BootstrapHostProfile {
  const { identityFile: _identityFile, ...safeProfile } = profile
  return { ...safeProfile, hasIdentityFile: Boolean(profile.identityFile) }
}

function okHealth(store: StorageHealth["store"]): StorageHealth {
  return { store, status: "ok" }
}

function blockedHealth(store: StorageHealth["store"]): StorageHealth {
  return { store, status: "blocked", reason: "corrupt", message: "safe blocked" }
}
