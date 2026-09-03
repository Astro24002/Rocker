import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n"
import { Sidebar } from "./Sidebar"

describe("Sidebar session actions", () => {
  const session = { id: "session-1", hostId: "host-1", label: "G11", state: "connected" as const, channelGeneration: 1 }

  it("replaces the personal-space header with local terminal and settings actions", () => {
    const onNavigate = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[]} onWidthChange={vi.fn()} onNavigate={onNavigate} /></I18nProvider>)

    expect(screen.queryByRole("button", { name: "Personal" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Local Terminal" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument()
    expect(screen.queryByText("Current host")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Local Terminal" }))
    expect(onNavigate).toHaveBeenCalledWith("local-terminal")
  })

  it("activates a session on left click and opens its menu on right click", () => {
    const onNavigate = vi.fn()
    const onSessionActivate = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onWidthChange={vi.fn()} onNavigate={onNavigate} onSessionActivate={onSessionActivate} /></I18nProvider>)

    const sessionButton = screen.getByRole("button", { name: "G11" })
    fireEvent.click(sessionButton)
    expect(onSessionActivate).toHaveBeenCalledWith("session-1")
    expect(onNavigate).toHaveBeenCalledWith("terminal")
    expect(screen.queryByRole("button", { name: /Actions for G11/ })).not.toBeInTheDocument()

    fireEvent.contextMenu(sessionButton)
    expect(screen.getByRole("menu", { name: "Session actions for G11" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Reconnect" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Close" })).toBeInTheDocument()
  })

  it("keeps the session menu in the typed command order and dispatches one id", () => {
    const onSessionCommand = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[{ ...session, state: "disconnected" }]} onWidthChange={vi.fn()} onNavigate={vi.fn()} onSessionCommand={onSessionCommand} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "G11" }))
    const menu = screen.getByRole("menu", { name: "Session actions for G11" })
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Reconnect",
      "Rename",
      "Duplicate",
      "Duplicate in a new window",
      "Split horizontally",
      "Close"
    ])

    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }))
    expect(onSessionCommand).toHaveBeenCalledTimes(1)
    expect(onSessionCommand).toHaveBeenCalledWith("session.duplicate", expect.objectContaining({ id: session.id }))
    expect(menu).not.toBeInTheDocument()
  })

  it("only enables Reconnect for disconnected or error sessions", () => {
    const { rerender } = render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onWidthChange={vi.fn()} onNavigate={vi.fn()} onSessionCommand={vi.fn()} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "G11" }))
    expect(screen.getByRole("menuitem", { name: "Reconnect" })).toBeDisabled()

    rerender(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[{ ...session, state: "error" }]} onWidthChange={vi.fn()} onNavigate={vi.fn()} onSessionCommand={vi.fn()} /></I18nProvider>)
    fireEvent.contextMenu(screen.getByRole("button", { name: "G11" }))
    expect(screen.getByRole("menuitem", { name: "Reconnect" })).toBeEnabled()
  })
})
