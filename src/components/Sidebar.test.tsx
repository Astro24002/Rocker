import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n"
import { Sidebar } from "./Sidebar"

describe("Sidebar session actions", () => {
  const session = { id: "session-1", hostId: "host-1", label: "G11", state: "connected" as const, channelGeneration: 1 }

  it("renders the compact brand and the approved navigation order", () => {
    const onNavigate = vi.fn()
    const { container } = render(<I18nProvider><Sidebar width={58} activeNav="hosts" sessions={[]} onNavigate={onNavigate} /></I18nProvider>)

    expect(screen.queryByRole("button", { name: "Personal" })).not.toBeInTheDocument()
    expect(screen.getByAltText("")).toBeInTheDocument()
    expect(container.querySelector(".sidebar[data-compact='true']")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Local Terminal" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument()
    expect(screen.queryByText("Current host")).not.toBeInTheDocument()
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Hosts", "SFTP", "Snippets", "Port Forwarding", "History", "Settings"
    ])
    expect(onNavigate).not.toHaveBeenCalled()
    expect(container.querySelector(".sidebar-resizer")).toBeNull()
  })

  it("activates a session on left click and opens its menu on right click", () => {
    const onNavigate = vi.fn()
    const onSessionActivate = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={onNavigate} onSessionActivate={onSessionActivate} /></I18nProvider>)

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

  it("focuses the session menu and closes it on Escape", () => {
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={vi.fn()} /></I18nProvider>)

    const sessionButton = screen.getByRole("button", { name: "G11" })
    fireEvent.contextMenu(sessionButton)
    const menu = screen.getByRole("menu", { name: "Session actions for G11" })

    expect(menu).toHaveFocus()
    fireEvent.keyDown(menu, { key: "Escape" })
    expect(screen.queryByRole("menu", { name: "Session actions for G11" })).not.toBeInTheDocument()
    expect(sessionButton).toHaveFocus()
  })

  it("restores focus to the session row after an outside dismissal", () => {
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={vi.fn()} /></I18nProvider>)

    const sessionButton = screen.getByRole("button", { name: "G11" })
    fireEvent.contextMenu(sessionButton)
    fireEvent.click(document.body)

    expect(screen.queryByRole("menu", { name: "Session actions for G11" })).not.toBeInTheDocument()
    expect(sessionButton).toHaveFocus()
  })

  it("clears its row menu when the command palette opens", () => {
    const { rerender } = render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={vi.fn()} commandPaletteOpen={false} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "G11" }))
    expect(screen.getByRole("menu", { name: "Session actions for G11" })).toBeInTheDocument()

    rerender(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={vi.fn()} commandPaletteOpen /></I18nProvider>)
    expect(screen.queryByRole("menu", { name: "Session actions for G11" })).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByRole("button", { name: "G11" }))
    expect(screen.queryByRole("menu", { name: "Session actions for G11" })).not.toBeInTheDocument()

    rerender(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={vi.fn()} commandPaletteOpen={false} /></I18nProvider>)
    expect(screen.queryByRole("menu", { name: "Session actions for G11" })).not.toBeInTheDocument()
  })

  it("keeps Duplicate as a submenu and dispatches the selected existing command id", () => {
    const onSessionCommand = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[{ ...session, state: "disconnected" }]} onNavigate={vi.fn()} onSessionCommand={onSessionCommand} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "G11" }))
    const menu = screen.getByRole("menu", { name: "Session actions for G11" })
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Reconnect",
      "Rename",
      "Duplicate",
      "Split horizontally",
      "Close"
    ])
    const duplicate = screen.getByRole("menuitem", { name: "Duplicate" })
    expect(duplicate).toHaveAttribute("aria-haspopup", "menu")
    expect(screen.queryByRole("menu", { name: "Duplicate options" })).not.toBeInTheDocument()

    fireEvent.keyDown(duplicate, { key: "ArrowRight" })
    const submenu = screen.getByRole("menu", { name: "Duplicate options" })
    expect(screen.getByRole("menuitem", { name: "In this window" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "In a new window" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("menuitem", { name: "In this window" }))
    expect(onSessionCommand).toHaveBeenCalledTimes(1)
    expect(onSessionCommand).toHaveBeenCalledWith("session.duplicate", expect.objectContaining({ id: session.id }))
    expect(menu).not.toBeInTheDocument()
    expect(submenu).not.toBeInTheDocument()
  })

  it("opens Duplicate with pointer hover and returns focus on Escape", () => {
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={vi.fn()} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "G11" }))
    const duplicate = screen.getByRole("menuitem", { name: "Duplicate" })
    fireEvent.pointerEnter(duplicate)
    expect(screen.getByRole("menu", { name: "Duplicate options" })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole("menu", { name: "Duplicate options" }), { key: "Escape" })
    expect(screen.queryByRole("menu", { name: "Duplicate options" })).not.toBeInTheDocument()
    expect(duplicate).toHaveFocus()
  })

  it("only enables Reconnect for disconnected or error sessions", () => {
    const { rerender } = render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={vi.fn()} onSessionCommand={vi.fn()} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "G11" }))
    expect(screen.getByRole("menuitem", { name: "Reconnect" })).toBeDisabled()

    rerender(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[{ ...session, state: "error" }]} onNavigate={vi.fn()} onSessionCommand={vi.fn()} /></I18nProvider>)
    fireEvent.contextMenu(screen.getByRole("button", { name: "G11" }))
    expect(screen.getByRole("menuitem", { name: "Reconnect" })).toBeEnabled()
  })

  it.each([
    ["idle", { reconnect: false, rename: true, duplicate: false, duplicateWindow: false, split: false, close: true }],
    ["restoring", { reconnect: false, rename: true, duplicate: false, duplicateWindow: false, split: false, close: true }],
    ["connecting", { reconnect: false, rename: true, duplicate: false, duplicateWindow: false, split: false, close: true }],
    ["connected", { reconnect: false, rename: true, duplicate: true, duplicateWindow: true, split: true, close: true }],
    ["reconnecting", { reconnect: false, rename: true, duplicate: false, duplicateWindow: false, split: false, close: true }],
    ["disconnected", { reconnect: true, rename: true, duplicate: true, duplicateWindow: false, split: false, close: true }],
    ["error", { reconnect: true, rename: true, duplicate: true, duplicateWindow: false, split: false, close: true }],
    ["closing", { reconnect: false, rename: false, duplicate: false, duplicateWindow: false, split: false, close: false }]
  ] as const)("derives every session action guard from the registry for %s sessions", (state, expected) => {
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[{ ...session, state }]} onNavigate={vi.fn()} onSessionCommand={vi.fn()} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "G11" }))
    const enabledByLabel = {
      reconnect: "Reconnect",
      rename: "Rename",
      duplicate: "Duplicate",
      split: "Split horizontally",
      close: "Close"
    } as const
    for (const [key, label] of Object.entries(enabledByLabel) as Array<[Exclude<keyof typeof expected, "duplicateWindow">, string]>) {
      const item = screen.getByRole("menuitem", { name: label })
      if (expected[key]) expect(item).toBeEnabled()
      else expect(item).toBeDisabled()
    }
    const duplicate = screen.getByRole("menuitem", { name: "Duplicate" })
    if (expected.duplicate) {
      fireEvent.pointerEnter(duplicate)
      const child = screen.getByRole("menuitem", { name: "In this window" })
      expect(child).toBeEnabled()
      if (expected.duplicateWindow) expect(screen.getByRole("menuitem", { name: "In a new window" })).toBeEnabled()
      else expect(screen.getByRole("menuitem", { name: "In a new window" })).toBeDisabled()
    }
  })

  it("does not dispatch disabled session commands", () => {
    const onSessionCommand = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[{ ...session, state: "connecting" }]} onNavigate={vi.fn()} onSessionCommand={onSessionCommand} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "G11" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }))
    expect(onSessionCommand).not.toHaveBeenCalled()
  })

  it("does not dispatch rename or close for a closing session", () => {
    const onSessionCommand = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[{ ...session, state: "closing" }]} onNavigate={vi.fn()} onSessionCommand={onSessionCommand} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "G11" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }))
    expect(onSessionCommand).not.toHaveBeenCalled()
  })
})
