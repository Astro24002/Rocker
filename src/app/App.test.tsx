import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { RockerBridge } from "../../electron/ipc/bridge-contract"
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
    setConnected: vi.fn()
  },
  registeredSessions: new Set<string>(),
  latestWorkspace: undefined as unknown
}))

vi.mock("../features/terminal/TerminalWorkspace", async () => {
  const React = await import("react")
  return {
    TerminalWorkspace: (props: {
      workspace: TerminalWorkspaceState
      onController(sessionId: string, controller: typeof terminalHarness.controller | undefined): void
      onResize(sessionId: string, channelGeneration: number, dimensions: { cols: number; rows: number }): void
    }) => {
      terminalHarness.latestWorkspace = props.workspace
      React.useEffect(() => {
        for (const session of props.workspace.sessions) {
          if (terminalHarness.registeredSessions.has(session.id)) continue
          terminalHarness.registeredSessions.add(session.id)
          props.onController(session.id, terminalHarness.controller)
          props.onResize(session.id, session.channelGeneration, session.dimensions ?? { cols: 120, rows: 40 })
        }
      }, [props.workspace, props.onController, props.onResize])
      return <div data-testid="terminal-workspace-mock">{props.workspace.sessions.map((session) => <span key={session.id}>{session.label}</span>)}</div>
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
  terminalHarness.registeredSessions.clear()
  terminalHarness.latestWorkspace = undefined
  sessionListener = undefined
  bridge = createBridge()
  window.rocker = bridge as unknown as RockerBridge
})

describe("desktop workspace shell", () => {
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

  it("switches locale without reloading", () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    fireEvent.click(screen.getByRole("button", { name: "简体中文" }))

    expect(screen.getByRole("button", { name: "主机" })).toBeInTheDocument()
  })

  it("keeps the terminal event subscription stable while switching locale", async () => {
    render(<App />)
    await waitFor(() => expect(bridge.events.onSessionEvent).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
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
    bridge.hosts.list.mockResolvedValue([host])
    bridge.workspace.load.mockResolvedValue(workspaceSnapshot(host.id))
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
    bridge.workspace.load.mockResolvedValue({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      maximized: false,
      sessions: [{ sessionId: "22222222-2222-4222-8222-222222222222", hostId: "missing", label: "Old host", cols: 120, rows: 40 }]
    })
    bridge.hosts.list.mockResolvedValue([])
    render(<App />)

    await waitFor(() => expect(workspace().sessions[0]).toMatchObject({ state: "error", reason: "configuration" }))
    expect(screen.getAllByText("Old host")).not.toHaveLength(0)
    expect(bridge.sessions.open).not.toHaveBeenCalled()
  })

  it("keeps terminal recovery independent from a failed monitor sample", async () => {
    bridge.hosts.list.mockResolvedValue([host])
    bridge.workspace.load.mockResolvedValue(workspaceSnapshot(host.id))
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
    monitor: { sample: vi.fn(async (sessionId: string) => ({ sessionId, latencyMs: 1, cpuPercent: null, memoryPercent: null, diskPercent: null, loadAverage: null, receiveBytesPerSecond: null, transmitBytesPerSecond: null, sampledAt: "2026-08-19T12:00:00.000Z" })) },
    history: { list: vi.fn(async () => []), clear: vi.fn(async () => undefined) },
    settings: {
      get: vi.fn(async () => ({ locale: "en" as const, sidebarWidth: 220, terminalFont: "JetBrains Mono", terminalFontSize: 13, connectionTimeout: 15, autoReconnect: true, reconnectMode: "limited" as const, restorePreviousWorkspace: true, confirmMultilinePaste: true, bindAddress: "127.0.0.1" as const })),
      update: vi.fn(async (update: object) => ({ locale: "en" as const, sidebarWidth: 220, terminalFont: "JetBrains Mono", terminalFontSize: 13, connectionTimeout: 15, autoReconnect: true, reconnectMode: "limited" as const, restorePreviousWorkspace: true, confirmMultilinePaste: true, bindAddress: "127.0.0.1" as const, ...update }))
    },
    events: {
      onSessionEvent: vi.fn((listener: (event: TerminalSessionEvent) => void) => {
        sessionListener = listener
        return vi.fn()
      }),
      onSessionLaunch: vi.fn(() => vi.fn())
    }
  }
}
