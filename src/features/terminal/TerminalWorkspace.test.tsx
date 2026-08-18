import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../../i18n"
import { createMonitorState, applyMetrics } from "../monitoring/monitor-state"
import { TerminalWorkspace } from "./TerminalWorkspace"

vi.mock("./TerminalView", () => ({ TerminalView: () => <div data-testid="terminal-surface" /> }))

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
      tabs={[{ id: "local-1", hostId: "host-1", sessionId: "ssh-1", connectionId: "connection-1", label: "G11", state: "connected", output: "" }]}
      activeId="local-1"
      monitor={monitor}
      monitorHostName="G11"
      onMonitorToggle={vi.fn()}
      onInput={vi.fn()}
      onResize={vi.fn()}
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
    expect(screen.getByTestId("terminal-monitor").compareDocumentPosition(screen.getByTestId("terminal-surface")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
