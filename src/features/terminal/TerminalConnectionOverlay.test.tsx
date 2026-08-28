import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../../i18n"
import type { WorkspaceSession } from "./session-state"
import { TerminalConnectionOverlay } from "./TerminalConnectionOverlay"

const reconnectingSession: WorkspaceSession = {
  id: "11111111-1111-4111-8111-111111111111",
  hostId: "host-a",
  label: "G11",
  state: "reconnecting",
  channelGeneration: 2,
  attempt: 3,
  nextRetryAt: "2026-08-19T12:00:04.000Z"
}

describe("TerminalConnectionOverlay", () => {
  it("shows Cancel and Reconnect now while a session reconnects", () => {
    render(<I18nProvider><TerminalConnectionOverlay session={reconnectingSession} onCancel={vi.fn()} onReconnectNow={vi.fn()} /></I18nProvider>)

    expect(screen.getByRole("button", { name: "Cancel reconnect" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reconnect now" })).toBeInTheDocument()
    expect(screen.getByText("Reconnect attempt 3")).toBeInTheDocument()
  })

  it("lets the user cancel an initial connection", () => {
    render(<I18nProvider><TerminalConnectionOverlay session={{ ...reconnectingSession, state: "connecting", attempt: undefined }} onCancel={vi.fn()} onReconnectNow={vi.fn()} /></I18nProvider>)

    expect(screen.getByRole("button", { name: "Cancel connection" })).toBeInTheDocument()
  })

  it("explains a restored session whose saved host is gone", () => {
    render(<I18nProvider><TerminalConnectionOverlay session={{ ...reconnectingSession, state: "error", reason: "configuration" }} onCancel={vi.fn()} onReconnectNow={vi.fn()} /></I18nProvider>)

    expect(screen.getByText("The saved host is no longer available.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument()
  })

  it("explains authentication failures and exposes an explicit close action", () => {
    const onClose = vi.fn()
    render(<I18nProvider><TerminalConnectionOverlay
      session={{ ...reconnectingSession, state: "error", reason: "authentication" }}
      onCancel={vi.fn()}
      onReconnectNow={vi.fn()}
      onClose={onClose}
    /></I18nProvider>)

    expect(screen.getByText("Authentication failed. Check the saved credentials."))
      .toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Close session" }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("keeps network recovery non-blocking while showing the buffer notice", () => {
    render(<I18nProvider><TerminalConnectionOverlay
      session={{ ...reconnectingSession, reason: "network" }}
      onCancel={vi.fn()}
      onReconnectNow={vi.fn()}
    /></I18nProvider>)

    expect(screen.getByText("Network connection interrupted. Terminal output is preserved."))
      .toBeInTheDocument()
  })
})
