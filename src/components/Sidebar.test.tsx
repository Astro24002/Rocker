import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n"
import type { WorkspaceSession } from "../features/terminal/session-state"
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
    expect(screen.getByRole("button", { name: "Hosts" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("button", { name: "Settings" })).not.toHaveAttribute("aria-current")
    expect(screen.queryByText("Current host")).not.toBeInTheDocument()
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Rocker", "Hosts", "Snippets", "Port Forwarding", "Connections", "Settings"
    ])
    expect(onNavigate).not.toHaveBeenCalled()
    expect(container.querySelector(".sidebar-resizer")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Port Forwarding" }))
    expect(onNavigate).toHaveBeenCalledWith("port-forwarding")
  })

  it.each(["connections", "history", "trust"] as const)("marks Connections as the current workspace for %s", (activeNav) => {
    render(<I18nProvider><Sidebar width={220} activeNav={activeNav} sessions={[session]} activeSessionId={session.id} onNavigate={vi.fn()} /></I18nProvider>)

    expect(screen.getByRole("button", { name: "Connections" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("button", { name: "SSH G11" })).not.toHaveAttribute("aria-current")
  })

  it("visually marks only the session whose content is currently on stage", () => {
    const themeForHost = vi.fn(() => "paper")
    const { rerender } = render(<I18nProvider><Sidebar width={220} activeNav="terminal" sessions={[session]} activeSessionId={session.id} themeForHost={themeForHost} onNavigate={vi.fn()} /></I18nProvider>)

    expect(screen.getByRole("button", { name: "SSH G11" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("button", { name: "SSH G11" })).toHaveAttribute("data-theme", "paper")
    expect(themeForHost).toHaveBeenCalledWith("host-1")
    expect(screen.getByRole("button", { name: "Hosts" })).not.toHaveAttribute("aria-current")

    rerender(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} activeSessionId={session.id} themeForHost={themeForHost} onNavigate={vi.fn()} /></I18nProvider>)
    expect(screen.getByRole("button", { name: "SSH G11" })).not.toHaveAttribute("aria-current")
    expect(screen.getByRole("button", { name: "SSH G11" })).not.toHaveAttribute("data-theme")
    expect(screen.getByRole("button", { name: "Hosts" })).toHaveAttribute("aria-current", "page")
  })

  it("activates a session on left click and opens its menu on right click", () => {
    const onNavigate = vi.fn()
    const onSessionActivate = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={onNavigate} onSessionActivate={onSessionActivate} /></I18nProvider>)

    const sessionButton = screen.getByRole("button", { name: "SSH G11" })
    fireEvent.click(sessionButton)
    expect(onSessionActivate).toHaveBeenCalledWith("session-1")
    expect(onNavigate).toHaveBeenCalledWith("terminal")
    expect(screen.queryByRole("button", { name: /Actions for G11/ })).not.toBeInTheDocument()

    fireEvent.contextMenu(sessionButton)
    const menu = screen.getByRole("menu", { name: "Session actions for G11" })
    expect(menu).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "SSH G11" }).closest(".sidebar-session-list")).not.toContainElement(menu)
    expect(menu).toHaveStyle({ visibility: "visible" })
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Duplicate in a new window" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Close" })).toBeInTheDocument()
  })

  it("keeps a Host-level PF session on its Host forwarding detail route", () => {
    const onNavigate = vi.fn()
    const onSessionActivate = vi.fn()
    const pfSession = { id: "pf-1", hostId: "host-1", label: "G11", state: "disconnected" as const, kind: "pf" as const, forwardingStatus: "stopped" as const }
    render(<I18nProvider><Sidebar width={220} activeNav="host-port-forwarding" sessions={[pfSession]} activeSessionId={pfSession.id} onNavigate={onNavigate} onSessionActivate={onSessionActivate} /></I18nProvider>)

    const sessionButton = screen.getByRole("button", { name: "PF G11" })
    expect(sessionButton).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("button", { name: "Port Forwarding" })).not.toHaveAttribute("aria-current")
    fireEvent.click(sessionButton)

    expect(onSessionActivate).toHaveBeenCalledWith(pfSession.id)
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it("dispatches the shared Close command from the row close button without activating the session", () => {
    const onNavigate = vi.fn()
    const onSessionActivate = vi.fn()
    const onSessionCommand = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="terminal" sessions={[session]} activeSessionId={session.id} onNavigate={onNavigate} onSessionActivate={onSessionActivate} onSessionCommand={onSessionCommand} /></I18nProvider>)

    const closeButton = screen.getByRole("button", { name: "Close G11" })
    expect(closeButton).toHaveAttribute("title", "Close")
    fireEvent.click(closeButton)

    expect(onSessionCommand).toHaveBeenCalledExactlyOnceWith("session.close", session)
    expect(onSessionActivate).not.toHaveBeenCalled()
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it("disables the row close button while the session is closing", () => {
    render(<I18nProvider><Sidebar width={220} activeNav="terminal" sessions={[{ ...session, state: "closing" }]} activeSessionId={session.id} onNavigate={vi.fn()} onSessionCommand={vi.fn()} /></I18nProvider>)

    expect(screen.getByRole("button", { name: "Close G11" })).toBeDisabled()
  })

  it("focuses the session menu and closes it on Escape", () => {
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={vi.fn()} /></I18nProvider>)

    const sessionButton = screen.getByRole("button", { name: "SSH G11" })
    fireEvent.contextMenu(sessionButton)
    const menu = screen.getByRole("menu", { name: "Session actions for G11" })

    expect(menu).toHaveFocus()
    fireEvent.keyDown(menu, { key: "Escape" })
    expect(screen.queryByRole("menu", { name: "Session actions for G11" })).not.toBeInTheDocument()
    expect(sessionButton).toHaveFocus()
  })

  it.each(["ContextMenu", "F10"] as const)("opens the Session menu with %s keyboard input", (key) => {
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={vi.fn()} /></I18nProvider>)

    const sessionButton = screen.getByRole("button", { name: "SSH G11" })
    sessionButton.focus()
    fireEvent.keyDown(sessionButton, { key, shiftKey: key === "F10" })

    expect(screen.getByRole("menu", { name: "Session actions for G11" })).toHaveFocus()
  })

  it("restores focus to the session row after an outside dismissal", () => {
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={vi.fn()} /></I18nProvider>)

    const sessionButton = screen.getByRole("button", { name: "SSH G11" })
    fireEvent.contextMenu(sessionButton)
    fireEvent.click(document.body)

    expect(screen.queryByRole("menu", { name: "Session actions for G11" })).not.toBeInTheDocument()
    expect(sessionButton).toHaveFocus()
  })

  it("closes a Session menu and restores its origin focus after destination changes", () => {
    const { rerender } = render(<I18nProvider><Sidebar width={220} activeNav="terminal" sessions={[session]} onNavigate={vi.fn()} /></I18nProvider>)

    const sessionButton = screen.getByRole("button", { name: "SSH G11" })
    fireEvent.contextMenu(sessionButton)
    expect(screen.getByRole("menu", { name: "Session actions for G11" })).toBeInTheDocument()

    rerender(<I18nProvider><Sidebar width={58} activeNav="hosts" sessions={[session]} activeSessionId={session.id} onNavigate={vi.fn()} /></I18nProvider>)

    expect(screen.queryByRole("menu", { name: "Session actions for G11" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "SSH G11" })).toHaveFocus()
    expect(screen.getByRole("button", { name: "SSH G11" })).toHaveAttribute("data-active", "true")
  })

  it("clears its row menu when the command palette opens", () => {
    const { rerender } = render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={vi.fn()} commandPaletteOpen={false} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    expect(screen.getByRole("menu", { name: "Session actions for G11" })).toBeInTheDocument()

    rerender(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={vi.fn()} commandPaletteOpen /></I18nProvider>)
    expect(screen.queryByRole("menu", { name: "Session actions for G11" })).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    expect(screen.queryByRole("menu", { name: "Session actions for G11" })).not.toBeInTheDocument()

    rerender(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={vi.fn()} commandPaletteOpen={false} /></I18nProvider>)
    expect(screen.queryByRole("menu", { name: "Session actions for G11" })).not.toBeInTheDocument()
  })

  it("shows the requested flat menu order and duplicates in this window", () => {
    const onSessionCommand = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[{ ...session, state: "disconnected" }]} onNavigate={vi.fn()} onSessionCommand={onSessionCommand} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    const menu = screen.getByRole("menu", { name: "Session actions for G11" })
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Duplicate",
      "Duplicate in a new window",
      "Rename",
      "SFTP",
      "Port forwarding",
      "Close"
    ])
    const duplicate = screen.getByRole("menuitem", { name: "Duplicate" })
    expect(duplicate).not.toHaveAttribute("aria-haspopup")
    fireEvent.pointerEnter(duplicate)
    expect(screen.getAllByRole("menu")).toHaveLength(1)
    fireEvent.click(duplicate)
    expect(onSessionCommand).toHaveBeenCalledTimes(1)
    expect(onSessionCommand).toHaveBeenCalledWith("session.duplicate", expect.objectContaining({ id: session.id }))
    expect(menu).not.toBeInTheDocument()
  })

  it("dispatches Duplicate in a new window directly when available", () => {
    const onSessionCommand = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="terminal" sessions={[session]} onNavigate={vi.fn()} onSessionCommand={onSessionCommand} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate in a new window" }))

    expect(onSessionCommand).toHaveBeenCalledExactlyOnceWith("session.duplicate-window", session)
    expect(screen.queryByRole("menu", { name: "Session actions for G11" })).not.toBeInTheDocument()
  })

  it("dispatches the single Host-local forwarding entry", () => {
    const onSessionCommand = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="terminal" sessions={[session]} onNavigate={vi.fn()} onSessionCommand={onSessionCommand} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Port forwarding" }))

    expect(onSessionCommand).toHaveBeenCalledWith("session.port-forwarding", session)
    expect(screen.queryByRole("menu", { name: "Session actions for G11" })).not.toBeInTheDocument()
  })

  it("dispatches SFTP from an SSH session", () => {
    const onSessionCommand = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="terminal" sessions={[session]} onNavigate={vi.fn()} onSessionCommand={onSessionCommand} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "SFTP" }))

    expect(onSessionCommand).toHaveBeenCalledExactlyOnceWith("session.sftp", session)
    expect(screen.queryByRole("menu", { name: "Session actions for G11" })).not.toBeInTheDocument()
  })

  it("only enables new-window duplication for a connected SSH session", () => {
    const { rerender } = render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[session]} onNavigate={vi.fn()} onSessionCommand={vi.fn()} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    expect(screen.getByRole("menuitem", { name: "Duplicate in a new window" })).toBeEnabled()

    rerender(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[{ ...session, state: "error" }]} onNavigate={vi.fn()} onSessionCommand={vi.fn()} /></I18nProvider>)
    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    expect(screen.getByRole("menuitem", { name: "Duplicate in a new window" })).toBeDisabled()
  })

  it.each([
    ["idle", { rename: true, duplicate: false, duplicateWindow: false, sftp: true, forwarding: true, close: true }],
    ["restoring", { rename: true, duplicate: false, duplicateWindow: false, sftp: true, forwarding: true, close: true }],
    ["connecting", { rename: true, duplicate: false, duplicateWindow: false, sftp: true, forwarding: true, close: true }],
    ["connected", { rename: true, duplicate: true, duplicateWindow: true, sftp: true, forwarding: true, close: true }],
    ["reconnecting", { rename: true, duplicate: false, duplicateWindow: false, sftp: true, forwarding: true, close: true }],
    ["disconnected", { rename: true, duplicate: true, duplicateWindow: false, sftp: true, forwarding: true, close: true }],
    ["error", { rename: true, duplicate: true, duplicateWindow: false, sftp: true, forwarding: true, close: true }],
    ["closing", { rename: false, duplicate: false, duplicateWindow: false, sftp: false, forwarding: false, close: false }]
  ] as const)("derives every session action guard from the registry for %s sessions", (state, expected) => {
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[{ ...session, state }]} onNavigate={vi.fn()} onSessionCommand={vi.fn()} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    const enabledByLabel = {
      duplicate: "Duplicate",
      duplicateWindow: "Duplicate in a new window",
      rename: "Rename",
      sftp: "SFTP",
      forwarding: "Port forwarding",
      close: "Close"
    } as const
    for (const [key, label] of Object.entries(enabledByLabel) as Array<[keyof typeof expected, string]>) {
      const item = screen.getByRole("menuitem", { name: label })
      if (expected[key]) expect(item).toBeEnabled()
      else expect(item).toBeDisabled()
    }
  })

  it("does not dispatch disabled session commands", () => {
    const onSessionCommand = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[{ ...session, state: "connecting" }]} onNavigate={vi.fn()} onSessionCommand={onSessionCommand} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }))
    expect(onSessionCommand).not.toHaveBeenCalled()
  })

  it("renders mixed session kinds with aligned icons and accessible type names", () => {
    render(<I18nProvider><Sidebar width={220} activeNav="terminal" sessions={[
      session,
      { id: "session-2", hostId: "host-1", label: "G11 files", state: "idle", kind: "sftp", browser: { path: "/", entries: [], loading: false } },
      { id: "session-3", hostId: "host-1", label: "G11 forward", state: "disconnected", kind: "pf", profileId: "profile-1", forwardingStatus: "stopped" }
    ]} activeSessionId="session-2" onNavigate={vi.fn()} /></I18nProvider>)

    expect(screen.getByRole("button", { name: "SSH G11" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "SFTP G11 files" })).toHaveAttribute("data-active", "true")
    expect(screen.getByRole("button", { name: "PF G11 forward" })).toBeInTheDocument()
    for (const [type, label] of [["SSH", "G11"], ["SFTP", "G11 files"], ["PF", "G11 forward"]]) {
      const icon = screen.getByRole("button", { name: `${type} ${label}` }).querySelector(".session-type-icon")
      expect(icon).toHaveAttribute("title", type)
      expect(icon).toHaveAttribute("data-label-length", String(type.length))
      expect(icon).toHaveTextContent(type)
      expect(icon?.querySelector("svg")).toBeNull()
    }
    expect(screen.queryByText("10.0.0.11")).not.toBeInTheDocument()
    expect(screen.queryByText("connected")).not.toBeInTheDocument()
  })

  it("shows activity dots for unread SSH output and real running PF or SFTP work", () => {
    const sessions: WorkspaceSession[] = [
      { ...session, id: "ssh-unread", label: "SSH unread", hasUnreadActivity: true },
      { ...session, id: "ssh-connected", label: "SSH connected" },
      { id: "sftp-running", hostId: "host-1", label: "SFTP running", state: "connected", kind: "sftp", activeTransferCount: 1, browser: { path: "/", entries: [], loading: false } },
      { id: "pf-running", hostId: "host-1", label: "PF running", state: "connected", kind: "pf", profileId: "profile-1", forwardingStatus: "forwarding" },
      { id: "pf-stopped", hostId: "host-1", label: "PF stopped", state: "disconnected", kind: "pf", profileId: "profile-2", forwardingStatus: "stopped" }
    ]
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={sessions} onNavigate={vi.fn()} /></I18nProvider>)

    expect(screen.getByRole("button", { name: "SSH SSH unread" })).toHaveAttribute("aria-description", "New activity")
    expect(screen.getByRole("button", { name: "SSH SSH unread" }).querySelector(".session-activity-dot")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "SSH SSH connected" })).not.toHaveAttribute("aria-description")
    expect(screen.getByRole("button", { name: "SSH SSH connected" }).querySelector(".session-activity-dot")).toBeNull()
    expect(screen.getByRole("button", { name: "SFTP SFTP running" })).toHaveAttribute("aria-description", "Running")
    expect(screen.getByRole("button", { name: "SFTP SFTP running" }).querySelector(".session-activity-dot")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "PF PF running" }).querySelector(".session-activity-dot")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "PF PF stopped" }).querySelector(".session-activity-dot")).toBeNull()
  })

  it.each([
    ["sftp", "SFTP G11", { id: "sftp-1", hostId: "host-1", label: "G11", state: "connected" as const, kind: "sftp" as const, browser: { path: "/", entries: [], loading: false } }],
    ["pf", "PF G11", { id: "pf-1", hostId: "host-1", label: "G11", state: "disconnected" as const, kind: "pf" as const, profileId: "profile-1", forwardingStatus: "stopped" as const }]
  ] satisfies Array<[string, string, WorkspaceSession]>)("shows only cross-window duplication, rename, and close for %s sessions", (_kind, accessibleName, typedSession) => {
    const onSessionCommand = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[typedSession]} onNavigate={vi.fn()} onSessionCommand={onSessionCommand} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: accessibleName }))
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Duplicate in a new window",
      "Rename",
      "Close"
    ])
    const duplicateWindow = screen.getByRole("menuitem", { name: "Duplicate in a new window" })
    expect(duplicateWindow).toBeEnabled()
    fireEvent.click(duplicateWindow)
    expect(onSessionCommand).toHaveBeenCalledExactlyOnceWith("session.duplicate-window", typedSession)
  })

  it("does not dispatch rename or close for a closing session", () => {
    const onSessionCommand = vi.fn()
    render(<I18nProvider><Sidebar width={220} activeNav="hosts" sessions={[{ ...session, state: "closing" }]} onNavigate={vi.fn()} onSessionCommand={onSessionCommand} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }))
    expect(onSessionCommand).not.toHaveBeenCalled()
  })
})
