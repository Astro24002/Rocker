import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../../i18n"
import { applyMetrics, createMonitorState } from "../monitoring/monitor-state"
import type { TerminalWorkspaceState } from "./session-state"
import { TerminalWorkspace } from "./TerminalWorkspace"

vi.mock("./TerminalView", () => ({
  TerminalView: ({ session, visible }: { session: { id: string }; visible: boolean }) => (
    <div data-testid={`terminal-surface-${session.id}`} data-visible={String(visible)} />
  )
}))

describe("TerminalWorkspace layout", () => {
  it("places host metrics above terminal content without a session toolbar", () => {
    const monitor = applyMetrics(createMonitorState(), {
      sessionId: "ssh-1",
      latencyMs: 17,
      cpuPercent: 22,
      memoryPercent: 41,
      diskPercent: 60,
      loadAverage: 1.25,
      receiveBytesPerSecond: 1200,
      transmitBytesPerSecond: 800,
      sampledAt: "2026-08-18T12:00:00.000Z"
    })
    render(<I18nProvider><TerminalWorkspace
      workspace={workspace}
      monitor={monitor}
      monitorHostName="G11"
      onMonitorToggle={vi.fn()}
      preferences={preferences}
      confirmMultilinePaste
      onInput={vi.fn()}
      onResize={vi.fn()}
      onAck={vi.fn()}
      onController={vi.fn()}
    /></I18nProvider>)

    expect(screen.queryByRole("button", { name: "Reconnect" })).not.toBeInTheDocument()
    expect(screen.getByText("CPU")).toBeInTheDocument()
    expect(screen.getByText("22%")).toBeInTheDocument()
    expect(screen.getByText("Memory")).toBeInTheDocument()
    expect(screen.getByText("41%")).toBeInTheDocument()
    expect(screen.getByText("1200 B/s")).toBeInTheDocument()
    expect(screen.getByText("800 B/s")).toBeInTheDocument()
    expect(screen.getByText("Load")).toBeInTheDocument()
    expect(screen.getByText("1.25")).toBeInTheDocument()
    expect(screen.getByTestId("terminal-monitor")).toHaveClass("terminal-monitor-hud")
    expect(screen.getByTestId("terminal-monitor").compareDocumentPosition(screen.getByTestId("terminal-surface-a")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("renders every session surface but hides non-visible layout leaves", () => {
    render(<I18nProvider><TerminalWorkspace
      workspace={workspace}
      monitor={createMonitorState()}
      onMonitorToggle={vi.fn()}
      preferences={preferences}
      confirmMultilinePaste
      onInput={vi.fn()}
      onResize={vi.fn()}
      onAck={vi.fn()}
      onController={vi.fn()}
    /></I18nProvider>)

    expect(screen.getAllByTestId(/terminal-surface-/)).toHaveLength(3)
    expect(screen.getByTestId("terminal-surface-a")).toHaveAttribute("data-visible", "true")
    expect(screen.getByTestId("terminal-surface-b")).toHaveAttribute("data-visible", "false")
    expect(screen.getByTestId("terminal-surface-c")).toHaveAttribute("data-visible", "false")
  })
})

const workspace: TerminalWorkspaceState = {
  activeSessionId: "a",
  layout: { kind: "leaf", sessionId: "a" },
  sessions: [
    { id: "a", hostId: "host-a", label: "G11", state: "connected", channelGeneration: 1 },
    { id: "b", hostId: "host-b", label: "Build", state: "disconnected", channelGeneration: 2 },
    { id: "c", hostId: "host-c", label: "Logs", state: "idle", channelGeneration: 0 }
  ]
}

const preferences = {
  fontFamily: "JetBrains Mono",
  fontSize: 13,
  scrollback: 10000 as const,
  cursorStyle: "bar" as const,
  cursorBlink: true,
  terminalBell: true
}
