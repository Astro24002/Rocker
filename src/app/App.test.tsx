import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  AppBootstrapSnapshot,
  BootstrapHostProfile,
  ConfigurationExportResult,
  ConfigurationImportChooseResult,
  RockerBridge
} from "../../electron/ipc/bridge-contract"
import type { ImportPreview, ImportResult } from "../../electron/storage/config-bundle"
import type { StorageHealth } from "../../electron/storage/storage-result"
import type { TerminalSessionEvent } from "../../electron/ssh/types"
import type { SftpTransferTask } from "../../electron/sftp/types"
import { clampSidebarWidth } from "../components/Sidebar"
import { visibleSessionIds } from "../features/terminal/layout"
import type { SshWorkspaceSession, TerminalWorkspaceState } from "../features/terminal/session-state"
import App from "./App"
import type { AppSettings, ForwardingProfileView, HostProfile, StoredWorkspaceWindow } from "./types"

const terminalHarness = vi.hoisted(() => ({
  controller: {
    acceptOutput: vi.fn(),
    writeLocalNotice: vi.fn(),
    setChannelGeneration: vi.fn(),
    setConnected: vi.fn(),
    applyPreferences: vi.fn()
  },
  controllers: new Map<string, { applyPreferences: ReturnType<typeof vi.fn> }>(),
  surfaces: new Map<string, {
    hasSelection: ReturnType<typeof vi.fn>
    copy: ReturnType<typeof vi.fn>
    paste: ReturnType<typeof vi.fn>
    selectAll: ReturnType<typeof vi.fn>
    clear: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
  }>(),
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
      onCommandSurface?(sessionId: string, surface: { hasSelection(): boolean; copy(): void; paste(): void; selectAll(): void; clear(): void; focus(): void } | undefined): void
      onSearchController?(sessionId: string, controller: object | undefined): void
      onResize(sessionId: string, channelGeneration: number, dimensions: { cols: number; rows: number }): void
      onContextMenu?(sessionId: string, event: MouseEvent): void
    }) => {
      terminalHarness.latestWorkspace = props.workspace
      const sshSessions = props.workspace.sessions.filter((session): session is SshWorkspaceSession => (session.kind ?? "ssh") === "ssh")
      React.useEffect(() => {
        for (const session of sshSessions) {
          if (terminalHarness.registeredSessions.has(session.id)) continue
          terminalHarness.registeredSessions.add(session.id)
          props.onController(session.id, (terminalHarness.controllers.get(session.id) ?? terminalHarness.controller) as typeof terminalHarness.controller)
          const surface = terminalHarness.surfaces.get(session.id) ?? {
            hasSelection: vi.fn(() => true),
            copy: vi.fn(),
            paste: vi.fn(),
            selectAll: vi.fn(),
            clear: vi.fn(),
            focus: vi.fn()
          }
          terminalHarness.surfaces.set(session.id, surface)
          props.onCommandSurface?.(session.id, {
            hasSelection: () => Boolean((surface.hasSelection as unknown as () => unknown)()),
            copy: () => (surface.copy as unknown as () => void)(),
            paste: () => (surface.paste as unknown as () => void)(),
            selectAll: () => (surface.selectAll as unknown as () => void)(),
            clear: () => (surface.clear as unknown as () => void)(),
            focus: () => (surface.focus as unknown as () => void)()
          })
          props.onSearchController?.(session.id, {
            getState: () => ({
              sessionId: session.id,
              query: "",
              options: { caseSensitive: false, wholeWord: false, regex: false },
              resultStatus: "idle"
            }),
            onStateChange: () => ({ dispose: vi.fn() }),
            setQuery: vi.fn(),
            setOptions: vi.fn(),
            findNext: vi.fn(),
            findPrevious: vi.fn(),
            clear: vi.fn()
          })
          props.onResize(session.id, session.channelGeneration, session.dimensions ?? { cols: 120, rows: 40 })
        }
      }, [props.workspace, props.onCommandSurface, props.onController, props.onResize, props.onSearchController, sshSessions])
      return <><div data-testid="terminal-workspace-mock">{sshSessions.map((session) => <div className="terminal-surface" data-session-id={session.id} key={session.id} onContextMenu={(event) => props.onContextMenu?.(session.id, event.nativeEvent)}><textarea className="xterm-helper-textarea" aria-label={`Terminal input ${session.label}`} /> <span>{session.label}</span></div>)}</div>{props.overlay}</>
    }
  }
})

let bridge: ReturnType<typeof createBridge>
let sessionListener: ((event: TerminalSessionEvent) => void) | undefined
let forwardingListener: (() => void) | undefined

beforeEach(() => {
  localStorage.clear()
  terminalHarness.controller.acceptOutput.mockReset()
  terminalHarness.controller.writeLocalNotice.mockReset()
  terminalHarness.controller.setChannelGeneration.mockReset()
  terminalHarness.controller.setConnected.mockReset()
  terminalHarness.controller.applyPreferences.mockReset()
  terminalHarness.controllers.clear()
  terminalHarness.surfaces.clear()
  terminalHarness.registeredSessions.clear()
  terminalHarness.latestWorkspace = undefined
  sessionListener = undefined
  forwardingListener = undefined
  bridge = createBridge()
  window.rocker = bridge as unknown as RockerBridge
})

function openPaletteShortcut(): void {
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, shiftKey: true })))
}

function openSearchShortcut(): void {
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, shiftKey: true })))
}

describe("desktop workspace shell", () => {
  it("keeps Sidebar and Workspace as app-shell siblings with chrome and resize inside Workspace", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([], undefined))
    const { container } = render(<App />)

    await waitFor(() => expect(bridge.bootstrap.load).toHaveBeenCalledTimes(1))

    const shell = container.querySelector(".app-shell")!
    const sidebar = shell.querySelector(":scope > .sidebar")
    const workspace = shell.querySelector(":scope > .workspace")
    expect(sidebar).toBeInTheDocument()
    expect(workspace).toBeInTheDocument()
    expect(shell.querySelector(":scope > .app-content")).toBeNull()
    expect(workspace?.querySelector(":scope > .window-chrome")).toBeInTheDocument()
    expect(workspace?.querySelector(":scope > .workspace-resize-handle")).toBeInTheDocument()
    expect(sidebar?.querySelector(".workspace-resize-handle")).toBeNull()
  })

  it("opens the command palette from the exact global shortcut", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([], undefined))
    render(<App />)

    await waitFor(() => expect(bridge.bootstrap.load).toHaveBeenCalledTimes(1))
    const event = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, shiftKey: true })
    const preventDefault = vi.spyOn(event, "preventDefault")
    window.dispatchEvent(event)

    expect(preventDefault).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Command Palette" })).toBeInTheDocument())
  })

  it("opens the command palette from an exact shortcut targeted at the xterm helper textarea", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const helper = document.querySelector(".terminal-surface .xterm-helper-textarea") as HTMLTextAreaElement
    helper.focus()
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "p", ctrlKey: true, shiftKey: true })
    const preventDefault = vi.spyOn(event, "preventDefault")
    helper.dispatchEvent(event)

    expect(preventDefault).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Command Palette" })).toBeInTheDocument())
  })

  it("opens Search from the exact global shortcut targeted at the xterm helper textarea", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const helper = document.querySelector(".terminal-surface .xterm-helper-textarea") as HTMLTextAreaElement
    helper.focus()
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "f", ctrlKey: true, shiftKey: true })
    const preventDefault = vi.spyOn(event, "preventDefault")
    helper.dispatchEvent(event)

    expect(preventDefault).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole("searchbox", { name: "Search terminal output" })).toHaveFocus())
  })

  it("returns Search focus to the active terminal after Escape", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const sessionId = workspace().activeSessionId!
    await waitFor(() => expect(terminalHarness.surfaces.get(sessionId)).toBeDefined())
    const surface = terminalHarness.surfaces.get(sessionId)!
    openSearchShortcut()
    const searchbox = await screen.findByRole("searchbox", { name: "Search terminal output" })
    expect(searchbox).toHaveFocus()

    fireEvent.keyDown(searchbox, { key: "Escape" })

    await waitFor(() => expect(screen.queryByRole("search", { name: "Search terminal" })).not.toBeInTheDocument())
    expect(surface.focus).toHaveBeenCalledTimes(1)
  })

  it("activates the terminal before showing search from a non-terminal view", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument()

    openSearchShortcut()

    const terminalHost = screen.getByTestId("terminal-workspace-mock").closest(".terminal-workspace-host") as HTMLElement
    await waitFor(() => expect(terminalHost).not.toHaveAttribute("hidden"))
    expect(screen.getByRole("search", { name: "Search terminal" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument()
  })

  it("closes Search when navigating away from the terminal destination", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    openSearchShortcut()
    expect(screen.getByRole("search", { name: "Search terminal" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    expect(screen.queryByRole("search", { name: "Search terminal" })).not.toBeInTheDocument()
    expect(document.querySelector(".terminal-search-overlay")).toBeNull()
  })

  it.each([
    ["SFTP", "SFTP"],
    ["Snippets", "Snippets"]
  ])("reaches the %s workspace entry from Sidebar navigation", async (label, heading) => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([], undefined))
    render(<App />)

    await waitFor(() => expect(bridge.bootstrap.load).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole("button", { name: label }))

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument()
    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument()
  })

  it("restores Escape focus to the unchanged active terminal", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const sessionId = workspace().activeSessionId!
    await waitFor(() => expect(terminalHarness.surfaces.get(sessionId)).toBeDefined())
    const surface = terminalHarness.surfaces.get(sessionId)!
    openPaletteShortcut()
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search commands" }), { key: "Escape" })

    expect(surface.focus).toHaveBeenCalledTimes(1)
  })

  it("routes the session context forwarding action to the Host-local destination", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Port forwarding" }))

    await waitFor(() => expect(screen.getByRole("heading", { name: "Host forwarding" })).toBeInTheDocument())
    expect(document.querySelector(".ports-host-view[data-mode='host']")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Port Forwarding" }))
    await waitFor(() => expect(document.querySelector(".ports-overview-view[data-mode='global']")).toBeInTheDocument())
  })

  it("returns to the global overview when the last Host session closes", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Port forwarding" }))
    await waitFor(() => expect(document.querySelector(".ports-host-view[data-mode='host']")).toBeInTheDocument())

    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Close" }))

    await waitFor(() => expect(document.querySelector(".ports-overview-view[data-mode='global']")).toBeInTheDocument())
    expect(document.querySelector(".ports-host-view[data-mode='host']")).not.toBeInTheDocument()
  })

  it.each([
    ["hosts", "Hosts"],
    ["history", "History"],
    ["ports", "Port Forwarding"],
    ["settings", "Settings"],
    ["sftp", "SFTP"],
    ["snippets", "Snippets"]
  ])("restores palette focus to the visible %s destination", async (queryValue, heading) => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const sessionId = workspace().activeSessionId!
    await waitFor(() => expect(terminalHarness.surfaces.get(sessionId)).toBeDefined())
    const surface = terminalHarness.surfaces.get(sessionId)!
    openPaletteShortcut()
    const query = screen.getByRole("searchbox", { name: "Search commands" })
    fireEvent.change(query, { target: { value: queryValue } })
    fireEvent.keyDown(query, { key: "Enter" })

    await waitFor(() => expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId("workspace-stage")).toHaveFocus())
    expect(surface.focus).not.toHaveBeenCalled()
  })

  it("routes selected host actions through the typed bridge", async () => {
    const duplicate = { ...host, id: "host-copy", name: "G11 copy" }
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], undefined))
    bridge.hosts.duplicate.mockResolvedValue(duplicate)
    bridge.hosts.setFavorite.mockResolvedValue({ ...host, favorite: true })
    bridge.hosts.remove.mockResolvedValue(undefined)
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<App />)

    await waitFor(() => expect(screen.getByRole("button", { name: "G11, SSH, root" })).toBeInTheDocument())
    fireEvent.contextMenu(screen.getByRole("button", { name: "G11, SSH, root" }), { clientX: 120, clientY: 80 })
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate host" }))
    await waitFor(() => expect(bridge.hosts.duplicate).toHaveBeenCalledWith(host.id))
    await waitFor(() => expect(screen.getByText("G11 copy")).toBeInTheDocument())
    expect(screen.getByRole("button", { name: "G11 copy, SSH, root" })).toHaveAttribute("aria-pressed", "true")

    fireEvent.contextMenu(screen.getByRole("button", { name: "G11 copy, SSH, root" }), { clientX: 120, clientY: 80 })
    fireEvent.click(screen.getByRole("menuitem", { name: "Favorite host" }))
    await waitFor(() => expect(bridge.hosts.setFavorite).toHaveBeenCalledWith(duplicate.id, true))
    fireEvent.contextMenu(screen.getByRole("button", { name: "G11 copy, SSH, root" }), { clientX: 120, clientY: 80 })
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete host" }))
    await waitFor(() => expect(bridge.hosts.remove).toHaveBeenCalledWith(duplicate.id))
    expect(confirmation).toHaveBeenCalled()
    confirmation.mockRestore()
  })

  it("selects a Host without navigating and opens independent numbered SSH sessions on double click", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    await waitFor(() => expect(bridge.sessions.open).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole("button", { name: "Hosts" }))
    const card = screen.getByRole("button", { name: "G11, SSH, root" })
    const originalId = workspace().sessions[0].id
    fireEvent.click(card)
    expect(card).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("heading", { name: "Hosts" })).toBeInTheDocument()
    expect(workspace().sessions).toHaveLength(1)
    expect(bridge.sessions.open).toHaveBeenCalledTimes(1)

    fireEvent.doubleClick(card)
    await waitFor(() => expect(workspace().sessions).toHaveLength(2))
    const firstNewSession = workspace().sessions[1]
    expect(firstNewSession).toMatchObject({ hostId: host.id, label: "G11(1)", kind: "ssh" })
    expect(firstNewSession.id).not.toBe(originalId)
    expect(workspace().activeSessionId).toBe(firstNewSession.id)
    await waitFor(() => expect(bridge.sessions.open).toHaveBeenCalledWith(expect.objectContaining({ sessionId: firstNewSession.id, hostId: host.id })))

    fireEvent.click(screen.getByRole("button", { name: "Hosts" }))
    fireEvent.doubleClick(screen.getByRole("button", { name: "G11, SSH, root" }))
    await waitFor(() => expect(workspace().sessions).toHaveLength(3))
    expect(workspace().sessions.map((session) => session.label)).toEqual(["G11", "G11(1)", "G11(2)"])
    expect(new Set(workspace().sessions.map((session) => session.id)).size).toBe(3)
    expect(workspace().activeSessionId).toBe(workspace().sessions[2].id)
  })

  it("numbers duplicates from the source session without reusing existing labels", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions[0]?.state).toBe("connected"))
    const originalId = workspace().sessions[0].id
    const duplicate = (label: string): void => {
      fireEvent.contextMenu(screen.getByRole("button", { name: `SSH ${label}` }))
      fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }))
    }

    duplicate("G11")
    await waitFor(() => expect(workspace().sessions.map((session) => session.label)).toEqual(["G11", "G11 (1)"]))
    const firstId = workspace().sessions[1].id
    expect(firstId).not.toBe(originalId)
    await waitFor(() => expect(workspace().sessions[1].state).toBe("connected"))

    duplicate("G11")
    await waitFor(() => expect(workspace().sessions.map((session) => session.label)).toEqual(["G11", "G11 (1)", "G11 (2)"]))
    await waitFor(() => expect(workspace().sessions[2].state).toBe("connected"))

    duplicate("G11 (1)")
    await waitFor(() => expect(workspace().sessions.map((session) => session.label)).toEqual(["G11", "G11 (1)", "G11 (2)", "G11 (3)"]))
    expect(new Set(workspace().sessions.map((session) => session.id)).size).toBe(4)
    expect(workspace().activeSessionId).toBe(workspace().sessions[3].id)
    await waitFor(() => expect(bridge.sessions.open).toHaveBeenCalledWith(expect.objectContaining({ sessionId: workspace().sessions[3].id, hostId: host.id })))
  })

  it("keeps HostEditor save errors when the host mutation rejects", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], undefined))
    bridge.hosts.save.mockRejectedValue(new Error("storage details"))
    render(<App />)

    await waitFor(() => expect(screen.getByRole("button", { name: "Add host" })).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Add host" }))
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "New host" } })
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "new.example" } })
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "root" } })
    fireEvent.click(screen.getByRole("button", { name: "Save host" }))

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Couldn't save this host"))
    expect(screen.queryByText("storage details")).not.toBeInTheDocument()
  })

  it("restores palette focus to the new active terminal after duplicate", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const originalSessionId = workspace().activeSessionId!
    await waitFor(() => expect(terminalHarness.surfaces.get(originalSessionId)).toBeDefined())
    const originalSurface = terminalHarness.surfaces.get(originalSessionId)!
    openPaletteShortcut()
    const query = screen.getByRole("searchbox", { name: "Search commands" })
    fireEvent.change(query, { target: { value: "duplicate" } })
    fireEvent.keyDown(query, { key: "Enter" })

    await waitFor(() => expect(workspace().sessions).toHaveLength(2))
    const newSessionId = workspace().activeSessionId!
    await waitFor(() => expect(terminalHarness.surfaces.get(newSessionId)?.focus).toHaveBeenCalledTimes(1))
    expect(newSessionId).not.toBe(originalSessionId)
    expect(originalSurface.focus).not.toHaveBeenCalled()
  })

  it("restores palette focus to the destination after closing the active terminal", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const sessionId = workspace().activeSessionId!
    await waitFor(() => expect(terminalHarness.surfaces.get(sessionId)).toBeDefined())
    const surface = terminalHarness.surfaces.get(sessionId)!
    openPaletteShortcut()
    const query = screen.getByRole("searchbox", { name: "Search commands" })
    fireEvent.change(query, { target: { value: "close session" } })
    fireEvent.keyDown(query, { key: "Enter" })

    await waitFor(() => expect(screen.queryByTestId("terminal-workspace-mock")).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId("workspace-stage")).toHaveFocus())
    expect(surface.focus).not.toHaveBeenCalled()
  })

  it("records successful existing-session activation, removes closed recency, and never persists it", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshotWithTwoSessions(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(2))
    fireEvent.click(screen.getByRole("button", { name: "SSH G11 copy" }))
    openPaletteShortcut()
    expect(screen.getByText("Recent Sessions")).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "G11 copy" })).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search commands" }), { key: "Escape" })
    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11 copy" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Close" }))

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    openPaletteShortcut()
    expect(screen.queryByRole("option", { name: "G11 copy" })).not.toBeInTheDocument()
    for (const [payload] of bridge.workspace.save.mock.calls as unknown as Array<[Record<string, unknown>]>) expect(payload).not.toHaveProperty("recentSessions")
  })

  it("selects a recent session through the existing activation path and closes the palette", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshotWithTwoSessions(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(2))
    const firstSessionId = workspace().sessions[0].id
    const secondSession = workspace().sessions[1]
    fireEvent.click(screen.getByRole("button", { name: `SSH ${secondSession.label}` }))
    fireEvent.click(screen.getByRole("button", { name: `SSH ${workspace().sessions[0].label}` }))
    expect(workspace().activeSessionId).toBe(firstSessionId)

    openPaletteShortcut()
    fireEvent.click(screen.getByRole("option", { name: secondSession.label }))

    await waitFor(() => expect(workspace().activeSessionId).toBe(secondSession.id))
    expect(screen.queryByRole("dialog", { name: "Command Palette" })).not.toBeInTheDocument()
  })

  it("keeps terminal menu commands bound to the opened session after a keyboard recent-session switch", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshotWithTwoSessions(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(2))
    const firstSession = workspace().sessions[0]
    const secondSession = workspace().sessions[1]
    const firstSurface = terminalHarness.surfaces.get(firstSession.id)!
    const secondSurface = terminalHarness.surfaces.get(secondSession.id)!
    fireEvent.click(screen.getByRole("button", { name: `SSH ${firstSession.label}` }))
    fireEvent.click(screen.getByRole("button", { name: `SSH ${secondSession.label}` }))
    firstSurface.focus.mockClear()
    secondSurface.focus.mockClear()

    const secondTerminal = document.querySelector(`.terminal-surface[data-session-id="${secondSession.id}"]`)
    expect(secondTerminal).not.toBeNull()
    fireEvent.contextMenu(secondTerminal!)
    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeInTheDocument()

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, shiftKey: true })))
    const query = await screen.findByRole("searchbox", { name: "Search commands" })
    expect(screen.queryByRole("menu", { name: "Terminal actions" })).not.toBeInTheDocument()
    fireEvent.keyDown(query, { key: "ArrowDown" })
    fireEvent.keyDown(query, { key: "Enter" })
    await waitFor(() => expect(workspace().activeSessionId).toBe(firstSession.id))

    expect(screen.queryByRole("menu", { name: "Terminal actions" })).not.toBeInTheDocument()

    fireEvent.contextMenu(document.querySelector(`.terminal-surface[data-session-id="${secondSession.id}"]`)!)
    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: `SSH ${firstSession.label}` }))
    expect(workspace().activeSessionId).toBe(firstSession.id)
    firstSurface.focus.mockClear()
    secondSurface.focus.mockClear()
    fireEvent.click(screen.getByRole("menuitem", { name: "Focus terminal" }))
    await waitFor(() => expect(secondSurface.focus).toHaveBeenCalledTimes(1))
    expect(firstSurface.focus).not.toHaveBeenCalled()
  })

  it("makes the command palette authoritative over a terminal context menu for keyboard actions", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const sessionId = workspace().activeSessionId!
    const surface = terminalHarness.surfaces.get(sessionId)!
    const terminal = document.querySelector(".terminal-surface")
    expect(terminal).not.toBeNull()
    fireEvent.contextMenu(terminal!)
    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeInTheDocument()

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, shiftKey: true })))
    const query = await screen.findByRole("searchbox", { name: "Search commands" })
    expect(screen.queryByRole("menu", { name: "Terminal actions" })).not.toBeInTheDocument()
    expect(query).toHaveFocus()
    expect(surface.focus).not.toHaveBeenCalled()

    fireEvent.change(query, { target: { value: "settings" } })
    fireEvent.keyDown(query, { key: "ArrowDown" })
    expect(query).toHaveFocus()
    fireEvent.keyDown(query, { key: "Enter" })
    await waitFor(() => expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument())
    expect(screen.queryByRole("menu", { name: "Terminal actions" })).not.toBeInTheDocument()
  })

  it("opens Search for the terminal-menu session after a keyboard recent-session switch", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshotWithTwoSessions(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(2))
    const firstSession = workspace().sessions[0]
    const secondSession = workspace().sessions[1]
    fireEvent.click(screen.getByRole("button", { name: `SSH ${firstSession.label}` }))
    fireEvent.click(screen.getByRole("button", { name: `SSH ${secondSession.label}` }))

    const secondTerminal = document.querySelector(`.terminal-surface[data-session-id="${secondSession.id}"]`)
    expect(secondTerminal).not.toBeNull()
    fireEvent.contextMenu(secondTerminal!)
    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeInTheDocument()

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, shiftKey: true })))
    const query = await screen.findByRole("searchbox", { name: "Search commands" })
    expect(screen.queryByRole("menu", { name: "Terminal actions" })).not.toBeInTheDocument()
    fireEvent.keyDown(query, { key: "ArrowDown" })
    fireEvent.keyDown(query, { key: "Enter" })
    await waitFor(() => expect(workspace().activeSessionId).toBe(firstSession.id))

    expect(screen.queryByRole("menu", { name: "Terminal actions" })).not.toBeInTheDocument()
    fireEvent.contextMenu(document.querySelector(`.terminal-surface[data-session-id="${secondSession.id}"]`)!)
    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: `SSH ${firstSession.label}` }))
    expect(workspace().activeSessionId).toBe(firstSession.id)
    fireEvent.click(screen.getByRole("menuitem", { name: "Search terminal" }))
    const search = await screen.findByRole("search", { name: "Search terminal" })
    expect(search).toHaveAttribute("data-session-id", secondSession.id)
    expect(screen.getByRole("searchbox", { name: "Search terminal output" })).toHaveFocus()
  })

  it("dismisses the terminal menu when a Sidebar session menu opens", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const sessionButton = screen.getByRole("button", { name: "SSH G11" })
    const terminal = document.querySelector(".terminal-surface")
    expect(terminal).not.toBeNull()

    fireEvent.contextMenu(terminal!)
    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeInTheDocument()
    fireEvent.contextMenu(sessionButton)

    expect(screen.getByRole("menu", { name: "Session actions for G11" })).toBeInTheDocument()
    expect(screen.queryByRole("menu", { name: "Terminal actions" })).not.toBeInTheDocument()
  })

  it("dismisses the Sidebar menu when a terminal context menu opens", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const sessionButton = screen.getByRole("button", { name: "SSH G11" })
    const terminal = document.querySelector(".terminal-surface")
    expect(terminal).not.toBeNull()

    fireEvent.contextMenu(sessionButton)
    expect(screen.getByRole("menu", { name: "Session actions for G11" })).toBeInTheDocument()
    fireEvent.contextMenu(terminal!)

    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeInTheDocument()
    expect(screen.queryByRole("menu", { name: "Session actions for G11" })).not.toBeInTheDocument()
  })

  it("handles pointer clicks and Escape only in the command palette after menu dismissal", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const sessionId = workspace().activeSessionId!
    await waitFor(() => expect(terminalHarness.surfaces.get(sessionId)).toBeDefined())
    const surface = terminalHarness.surfaces.get(sessionId)!
    const terminal = document.querySelector(`.terminal-surface[data-session-id="${sessionId}"]`)
    expect(terminal).not.toBeNull()
    fireEvent.contextMenu(terminal!)
    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeInTheDocument()
    surface.focus.mockClear()

    openPaletteShortcut()
    const query = await screen.findByRole("searchbox", { name: "Search commands" })
    expect(screen.queryByRole("menu", { name: "Terminal actions" })).not.toBeInTheDocument()
    expect(query).toHaveFocus()

    fireEvent.contextMenu(terminal!)
    expect(screen.queryByRole("menu", { name: "Terminal actions" })).not.toBeInTheDocument()

    fireEvent.click(query)
    expect(screen.getByRole("dialog", { name: "Command Palette" })).toBeInTheDocument()
    expect(query).toHaveFocus()

    fireEvent.keyDown(query, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command Palette" })).not.toBeInTheDocument())
    expect(screen.queryByRole("menu", { name: "Terminal actions" })).not.toBeInTheDocument()
    expect(surface.focus).toHaveBeenCalledTimes(1)
  })

  it("clears a Sidebar session menu when the palette opens and never restores it", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const session = workspace().sessions[0]
    const sessionButton = screen.getByRole("button", { name: `SSH ${session.label}` })
    fireEvent.contextMenu(sessionButton)
    expect(screen.getByRole("menu", { name: `Session actions for ${session.label}` })).toBeInTheDocument()

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, shiftKey: true })))
    const query = await screen.findByRole("searchbox", { name: "Search commands" })
    expect(query).toHaveFocus()
    expect(screen.queryByRole("menu", { name: `Session actions for ${session.label}` })).not.toBeInTheDocument()
    fireEvent.contextMenu(sessionButton)
    expect(screen.queryByRole("menu", { name: `Session actions for ${session.label}` })).not.toBeInTheDocument()

    fireEvent.change(query, { target: { value: "settings" } })
    fireEvent.keyDown(query, { key: "ArrowDown" })
    expect(query).toHaveFocus()
    fireEvent.keyDown(query, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command Palette" })).not.toBeInTheDocument())
    expect(screen.queryByRole("menu", { name: `Session actions for ${session.label}` })).not.toBeInTheDocument()
  })

  it("restores stage focus after closing the last session from its Sidebar menu", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const session = workspace().sessions[0]
    fireEvent.contextMenu(screen.getByRole("button", { name: `SSH ${session.label}` }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Close" }))

    await waitFor(() => expect(screen.queryByTestId("terminal-workspace-mock")).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId("workspace-stage")).toHaveFocus())
  })

  it("restores focus to the active terminal after closing a non-active session", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshotWithTwoSessions(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(2))
    const [activeSession, nonActiveSession] = workspace().sessions
    await waitFor(() => expect(terminalHarness.surfaces.get(activeSession.id)).toBeDefined())
    const activeSurface = terminalHarness.surfaces.get(activeSession.id)!
    fireEvent.contextMenu(screen.getByRole("button", { name: `SSH ${nonActiveSession.label}` }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Close" }))

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    await waitFor(() => expect(activeSurface.focus).toHaveBeenCalledTimes(1))
  })

  it("preserves the current leaf when splitting a connected session from the command palette", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshotWithTwoSessionsAndLayout(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(2))
    await waitFor(() => expect(workspace().sessions.every((session) => session.state === "connected")).toBe(true))
    const firstSession = workspace().sessions[0]
    const secondSession = workspace().sessions[1]
    fireEvent.click(screen.getByRole("button", { name: `SSH ${secondSession.label}` }))
    openPaletteShortcut()
    const query = screen.getByRole("searchbox", { name: "Search commands" })
    fireEvent.change(query, { target: { value: "split horizontally" } })
    fireEvent.keyDown(query, { key: "Enter" })

    await waitFor(() => expect(workspace().sessions).toHaveLength(3))
    const newSession = workspace().sessions.find((session) => session.id !== firstSession.id && session.id !== secondSession.id)
    expect(newSession).toBeDefined()
    expect(workspace().activeSessionId).toBe(newSession!.id)
    expect(visibleSessionIds(workspace().layout)).toEqual([firstSession.id, secondSession.id, newSession!.id])
    expect(workspace().layout).toMatchObject({
      kind: "split",
      first: { kind: "leaf", sessionId: firstSession.id },
      second: {
        kind: "split",
        first: { kind: "leaf", sessionId: secondSession.id },
        second: { kind: "leaf", sessionId: newSession!.id }
      }
    })
  })

  it("closes the terminal menu and restores stage focus when keyboard navigation hides its host", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const sessionId = workspace().sessions[0].id
    const terminal = document.querySelector(`.terminal-surface[data-session-id="${sessionId}"]`)
    expect(terminal).not.toBeNull()
    fireEvent.contextMenu(terminal!)
    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeInTheDocument()

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, shiftKey: true })))
    const query = await screen.findByRole("searchbox", { name: "Search commands" })
    fireEvent.change(query, { target: { value: "settings" } })
    fireEvent.keyDown(query, { key: "Enter" })

    await waitFor(() => expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Terminal actions" })).not.toBeInTheDocument())
    expect(screen.getByTestId("workspace-stage")).toHaveFocus()
  })

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
    expect(screen.queryByRole("button", { name: "Local Terminal" })).not.toBeInTheDocument()
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
    expect(screen.getByRole("button", { name: "Connections" })).toBeInTheDocument()
  })

  it("switches locale without reloading", async () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "简体中文" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "简体中文" }))

    expect(screen.getByRole("button", { name: "主机" })).toBeInTheDocument()
  })

  it("opens a host on double click and preserves the resulting session across destinations", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], undefined))
    render(<App />)

    await waitFor(() => expect(screen.getByRole("heading", { name: "Hosts" })).toBeInTheDocument())
    fireEvent.doubleClick(screen.getByRole("button", { name: "G11, SSH, root" }))
    await waitFor(() => expect(bridge.sessions.open).toHaveBeenCalledWith(expect.objectContaining({ hostId: host.id })))

    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    await waitFor(() => expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument())
    expect(screen.getByRole("button", { name: "SSH G11" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Hosts" }))
    await waitFor(() => expect(screen.getByRole("heading", { name: "Hosts" })).toBeInTheDocument())

    expect(screen.getByRole("button", { name: "SSH G11" })).toBeInTheDocument()
  })

  it("preserves the sidebar resize range without a host selection state", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], undefined))
    render(<App />)

    await waitFor(() => expect(screen.getByRole("heading", { name: "Hosts" })).toBeInTheDocument())
    const resizeHandle = screen.getByRole("separator", { name: "Resize sidebar" })

    for (let index = 0; index < 20; index += 1) fireEvent.keyDown(resizeHandle, { key: "ArrowLeft" })
    expect(resizeHandle).toHaveAttribute("aria-valuenow", "58")
    fireEvent.keyDown(resizeHandle, { key: "ArrowRight" })

    expect(resizeHandle).toHaveAttribute("aria-valuenow", "180")
    expect(screen.getByRole("heading", { name: "Hosts" })).toBeInTheDocument()
  })

  it("keeps the active terminal surface mounted while switching destinations", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const sessionId = workspace().sessions[0].id
    const terminal = screen.getByTestId("terminal-workspace-mock")
    const controller = terminalHarness.controllers.get(sessionId) ?? terminalHarness.controller

    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    await waitFor(() => expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Hosts" }))
    await waitFor(() => expect(screen.getByRole("heading", { name: "Hosts" })).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "SSH G11" }))

    expect(screen.getByTestId("terminal-workspace-mock")).toBe(terminal)
    expect(terminalHarness.controllers.get(sessionId) ?? terminalHarness.controller).toBe(controller)
    expect(bridge.sessions.open).toHaveBeenCalledTimes(1)
  })

  it("keeps the cached Hosts destination out of the active terminal layout", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const stage = screen.getByTestId("workspace-stage")
    const terminalHost = stage.querySelector<HTMLElement>(".terminal-workspace-host")
    const hostsDestination = stage.querySelector<HTMLElement>(".workspace-destination")

    expect(terminalHost).not.toHaveAttribute("hidden")
    expect(hostsDestination).toHaveAttribute("hidden")
    expect([...stage.children].filter((child) => !(child as HTMLElement).hidden).map((child) => child.className)).toEqual([
      "terminal-workspace-host"
    ])
    expect(stage.querySelector(".session-info-bar")).not.toBeInTheDocument()
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
    expect(clampSidebarWidth(520)).toBe(320)
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

  it("does not expose or poll host monitoring for a connected session", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(sessionListener).toBeTypeOf("function"))
    sessionListener!({
      kind: "state",
      sessionId: "22222222-2222-4222-8222-222222222222",
      connectionId: "connection-1",
      channelGeneration: 1,
      state: "connected"
    })
    await waitFor(() => expect(workspace().sessions[0]?.state).toBe("connected"))

    expect("monitor" in bridge).toBe(false)
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

  it.each(["connecting", "reconnecting"] as const)("blocks bridge-backed session commands while %s", async (state) => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    await waitFor(() => expect(sessionListener).toBeTypeOf("function"))
    const sessionId = workspace().sessions[0].id
    act(() => sessionListener!({ kind: "state", sessionId, connectionId: "connection-1", channelGeneration: 1, state }))
    await waitFor(() => expect(workspace().sessions[0].state).toBe(state))

    const openCallCount = bridge.sessions.open.mock.calls.length
    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    const duplicate = screen.getByRole("menuitem", { name: "Duplicate" })
    expect(screen.queryByRole("menuitem", { name: "Reconnect" })).not.toBeInTheDocument()
    expect(duplicate).toBeDisabled()

    fireEvent.click(duplicate)

    expect(bridge.sessions.reconnect).not.toHaveBeenCalled()
    expect(bridge.sessions.open).toHaveBeenCalledTimes(openCallCount)
  })

  it("renames only the display label while preserving session identity and split order", async () => {
    const splitWorkspace = workspaceSnapshotWithSplitLayout(host.id)
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], splitWorkspace))
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("renamed")
    try {
      render(<App />)

      await waitFor(() => expect(workspace().sessions).toHaveLength(2))
      await waitFor(() => expect(workspace().sessions.every((session) => session.state === "connected")).toBe(true))
      const before = workspace()
      const target = before.sessions[1]
      const beforeTarget = { ...target }
      const beforeLayout = before.layout
      const beforeActiveSessionId = before.activeSessionId

      fireEvent.contextMenu(screen.getByRole("button", { name: `SSH ${target.label}` }))
      fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }))

      await waitFor(() => expect(workspace().sessions.find((session) => session.id === target.id)?.label).toBe("renamed"))
      const afterTarget = workspace().sessions.find((session) => session.id === target.id)
      expect(afterTarget).toMatchObject({
        ...beforeTarget,
        label: "renamed"
      })
      expect(workspace().activeSessionId).toBe(beforeActiveSessionId)
      expect(workspace().layout).toEqual(beforeLayout)
      expect(bridge.sessions.reconnect).not.toHaveBeenCalled()
      expect(bridge.sessions.close).not.toHaveBeenCalled()
      expect(prompt).toHaveBeenCalledWith("Rename session", target.label)
    } finally {
      prompt.mockRestore()
    }
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

  it("refreshes imported hosts and settings after a configuration migration", async () => {
    const importedHost: HostProfile = {
      id: "imported-host",
      name: "Imported host",
      host: "imported.example",
      port: 22,
      username: "admin",
      authMethod: "agent",
      favorite: false,
      notes: ""
    }
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([], undefined))
    bridge.configuration.chooseImport.mockResolvedValue({
      canceled: false,
      importId: "11111111-1111-4111-8111-111111111111",
      preview: {
        format: "rocker-config",
        encrypted: false,
        requiresPassword: false,
        createdAt: "2026-09-08T00:00:00.000Z",
        hosts: { total: 1, new: 1, matching: 0, conflicts: 0 },
        hostKeys: { total: 0, new: 0, matching: 0, conflicts: 0 },
        hostConflicts: [],
        hostKeyConflicts: [],
        credentials: { total: 0 },
        hasSettings: true
      }
    })
    bridge.configuration.applyImport.mockResolvedValue({
      importedHosts: 1,
      replacedHosts: 0,
      copiedHosts: 0,
      importedHostKeys: 0,
      replacedHostKeys: 0,
      skippedHostKeys: 0,
      importedCredentials: 0,
      skippedCredentials: 0,
      settingsApplied: true
    })
    bridge.hosts.list.mockResolvedValue([importedHost])
    bridge.settings.get.mockResolvedValue(settingsSnapshot({ scrollback: 50000, terminalFontSize: 16 }))
    render(<App />)

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }))
    fireEvent.click(screen.getByRole("button", { name: "Import configuration" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply import" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "Apply import" }))

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Scrollback lines" })).toHaveValue("50000"))
    expect(bridge.hosts.list).toHaveBeenCalled()
  })

  it("serializes delayed settings writes and preserves newer edits across full responses", async () => {
    vi.useFakeTimers()
    try {
      const writes = [deferred<AppSettings>(), deferred<AppSettings>(), deferred<AppSettings>()]
      let writeIndex = 0
      bridge.settings.update.mockImplementation(() => writes[writeIndex++].promise)
      bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
      render(<App />)

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      fireEvent.click(screen.getByRole("button", { name: "Settings" }))
      fireEvent.change(screen.getByRole("combobox", { name: "Scrollback lines" }), { target: { value: "50000" } })
      await act(async () => { vi.advanceTimersByTime(300) })
      expect(bridge.settings.update).toHaveBeenCalledTimes(1)

      fireEvent.click(screen.getByRole("checkbox", { name: "Cursor blink" }))
      fireEvent.change(screen.getByRole("combobox", { name: "Connection timeout" }), { target: { value: "30" } })
      await act(async () => { vi.advanceTimersByTime(300) })
      expect(bridge.settings.update).toHaveBeenCalledTimes(1)

      await act(async () => {
        writes[0].resolve(settingsSnapshot({ scrollback: 50000, cursorBlink: true, connectionTimeout: 15 }))
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(bridge.settings.update).toHaveBeenCalledTimes(2)
      expect(screen.getByRole("combobox", { name: "Scrollback lines" })).toHaveValue("50000")
      expect(screen.getByRole("checkbox", { name: "Cursor blink" })).not.toBeChecked()
      expect(screen.getByRole("combobox", { name: "Connection timeout" })).toHaveValue("30")

      await act(async () => {
        writes[1].resolve(settingsSnapshot({ scrollback: 10000, cursorBlink: true, connectionTimeout: 30 }))
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(bridge.settings.update).toHaveBeenCalledTimes(3)

      await act(async () => {
        writes[2].resolve(settingsSnapshot({ scrollback: 10000, cursorBlink: false, connectionTimeout: 30 }))
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(screen.getByRole("combobox", { name: "Scrollback lines" })).toHaveValue("50000")
      expect(screen.getByRole("checkbox", { name: "Cursor blink" })).not.toBeChecked()
      expect(screen.getByRole("combobox", { name: "Connection timeout" })).toHaveValue("30")
      expect(screen.queryByText("settings storage is unavailable")).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("ignores a stale settings write failure when a newer write is pending", async () => {
    const writes = [deferred<AppSettings>(), deferred<AppSettings>()]
    let writeIndex = 0
    bridge.settings.update.mockImplementation(() => writes[writeIndex++].promise)
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    fireEvent.change(screen.getByRole("combobox", { name: "Connection timeout" }), { target: { value: "30" } })
    fireEvent.click(screen.getByRole("checkbox", { name: "Automatic reconnect" }))

    await act(async () => {
      writes[0].reject(new Error("settings write failed"))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByText("settings storage is unavailable")).not.toBeInTheDocument()

    await act(async () => {
      writes[1].resolve(settingsSnapshot({ connectionTimeout: 30, autoReconnect: false }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByText("settings storage is unavailable")).not.toBeInTheDocument()
  })

  it("preserves temporary appearance edits when a settings retry remains blocked", async () => {
    const retry = deferred<Partial<AppBootstrapSnapshot>>()
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id), {
      settings: { health: blockedHealth("settings"), value: undefined }
    }))
    bridge.bootstrap.retry.mockImplementation(() => retry.promise)
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    fireEvent.change(screen.getByRole("combobox", { name: "Scrollback lines" }), { target: { value: "50000" } })
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(bridge.bootstrap.retry).toHaveBeenCalledWith(["settings"]))
    fireEvent.change(screen.getByRole("combobox", { name: "Cursor style" }), { target: { value: "underline" } })

    await act(async () => {
      retry.resolve({ settings: { health: blockedHealth("settings"), value: undefined } })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByRole("combobox", { name: "Scrollback lines" })).toHaveValue("50000")
    expect(screen.getByRole("combobox", { name: "Cursor style" })).toHaveValue("underline")
    expect(terminalHarness.controller.applyPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ scrollback: 50000, cursorStyle: "underline" }))
  })

  it("flushes a pending appearance update when the workspace unmounts", async () => {
    vi.useFakeTimers()
    try {
      bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
      const view = render(<App />)

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      fireEvent.click(screen.getByRole("button", { name: "Settings" }))
      fireEvent.change(screen.getByRole("combobox", { name: "Scrollback lines" }), { target: { value: "50000" } })
      expect(bridge.settings.update).not.toHaveBeenCalled()

      view.unmount()

      expect(bridge.settings.update).toHaveBeenCalledTimes(1)
      expect(bridge.settings.update).toHaveBeenCalledWith({ scrollback: 50000 })
    } finally {
      vi.useRealTimers()
    }
  })

  it("clamps terminal font size before applying it to live controllers", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    const fontSize = screen.getByRole("spinbutton", { name: "Font size" })

    fireEvent.change(fontSize, { target: { value: "999" } })
    expect(fontSize).toHaveValue(24)
    expect(terminalHarness.controller.applyPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 24 }))

    fireEvent.change(fontSize, { target: { value: "" } })
    expect(fontSize).toHaveValue(10)
    expect(terminalHarness.controller.applyPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 10 }))
  })

  it("opens mixed SSH, SFTP, and PF sessions for the same host without extra reconnects", async () => {
    const other = { ...host, id: "host-b", name: "G12", host: "other.example" }
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host, other], workspaceSnapshot(host.id)))
    bridge.ports.listForHost.mockResolvedValue([forwardingRow()])
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const sshSessionId = workspace().sessions[0].id
    expect(bridge.sessions.open).toHaveBeenCalledTimes(1)

    openHostAction("G11, SSH, root", "Open SFTP")
    await waitFor(() => expect(screen.getByRole("button", { name: "SFTP G11" })).toHaveAttribute("data-active", "true"))
    expect(screen.getByRole("heading", { name: "File Browser" })).toBeInTheDocument()
    expect(screen.getByTestId("terminal-workspace-mock").closest(".terminal-workspace-host")).toHaveAttribute("hidden")
    expect(screen.getByTestId("workspace-stage").querySelector(".session-info-bar")).not.toBeInTheDocument()

    await openForwardingSession("G11, SSH, root")
    await waitFor(() => expect(screen.getByRole("button", { name: "PF G11" })).toHaveAttribute("data-active", "true"))
    expect(screen.getByRole("heading", { name: "Forwarding Info" })).toBeInTheDocument()
    expect(screen.getAllByText("127.0.0.1:3000")).not.toHaveLength(0)

    openHostAction("G12, SSH, root", "Open SSH")
    await waitFor(() => expect(screen.getByRole("button", { name: "SSH G12" })).toBeInTheDocument())
    expect(bridge.sessions.open).toHaveBeenCalledTimes(2)
    expect(bridge.sessions.close).not.toHaveBeenCalled()
    expect(bridge.ports.stop).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "SSH G11" }))
    expect(workspace().activeSessionId).toBe(sshSessionId)
    expect(screen.getByTestId("terminal-workspace-mock").closest(".terminal-workspace-host")).not.toHaveAttribute("hidden")
    expect(bridge.sessions.open).toHaveBeenCalledTimes(2)
    expect(bridge.sessions.close).not.toHaveBeenCalled()
  })

  it("does not create a PF page from an existing forwarding runtime", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    bridge.ports.listOverview.mockResolvedValue([forwardingRow()])
    render(<App />)

    await waitFor(() => expect(bridge.ports.listOverview).toHaveBeenCalled())
    expect(screen.queryByRole("button", { name: "PF G11" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "SSH G11" })).toHaveAttribute("data-active", "true")
    expect(workspace().sessions).toHaveLength(1)
  })

  it("keeps SFTP path and PF content mounted across session switches", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    bridge.ports.listForHost.mockResolvedValue([forwardingRow()])
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    openHostAction("G11, SSH, root", "Open SFTP")
    await waitFor(() => expect(screen.getByRole("heading", { name: "File Browser" })).toBeInTheDocument())

    const path = screen.getByRole("textbox", { name: "Path" })
    fireEvent.change(path, { target: { value: "/etc" } })
    fireEvent.click(screen.getByRole("button", { name: "Go" }))
    expect(path).toHaveValue("/etc")

    await openForwardingSession("G11, SSH, root")
    await waitFor(() => expect(screen.getByRole("heading", { name: "Forwarding Info" })).toBeInTheDocument())

    const sftpId = screen.getByRole("button", { name: "SFTP G11" }).getAttribute("data-session-id")
    const pfId = screen.getByRole("button", { name: "PF G11" }).getAttribute("data-session-id")
    const sftpHost = document.querySelector(`.session-content-host[data-session-id="${sftpId}"]`) as HTMLElement
    const pfHost = document.querySelector(`.session-content-host[data-session-id="${pfId}"]`) as HTMLElement
    expect(sftpHost).toHaveAttribute("hidden")
    expect(pfHost).not.toHaveAttribute("hidden")

    fireEvent.click(screen.getByRole("button", { name: "SFTP G11" }))
    expect(sftpHost).not.toHaveAttribute("hidden")
    expect(pfHost).toHaveAttribute("hidden")
    expect(screen.getByRole("textbox", { name: "Path" })).toHaveValue("/etc")
    expect(screen.getByTestId("workspace-stage").querySelector(".session-info-bar")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "SSH G11" }))
    expect(sftpHost).toHaveAttribute("hidden")
    expect(pfHost).toHaveAttribute("hidden")
    expect(bridge.sessions.open).toHaveBeenCalledTimes(1)
    expect(bridge.ports.stop).not.toHaveBeenCalled()
  })

  it("closes mixed sessions independently without stopping siblings on the same host", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    bridge.ports.listForHost.mockResolvedValue([forwardingRow()])
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    const sshSessionId = workspace().sessions[0].id
    openHostAction("G11, SSH, root", "Open SFTP")
    await openForwardingSession("G11, SSH, root")
    await waitFor(() => expect(screen.getByRole("button", { name: "PF G11" })).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: "SSH G11" }))
    fireEvent.contextMenu(screen.getByRole("button", { name: "SFTP G11" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "SFTP G11" })).not.toBeInTheDocument())
    expect(workspace().activeSessionId).toBe(sshSessionId)
    expect(screen.getByRole("button", { name: "SSH G11" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "PF G11" })).toBeInTheDocument()
    expect(bridge.sessions.close).not.toHaveBeenCalled()
    expect(bridge.ports.stop).not.toHaveBeenCalled()

    fireEvent.contextMenu(screen.getByRole("button", { name: "PF G11" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "PF G11" })).not.toBeInTheDocument())
    expect(workspace().activeSessionId).toBe(sshSessionId)
    expect(bridge.sessions.close).not.toHaveBeenCalled()

    const saved = (bridge.workspace.save.mock.calls.at(-1) as unknown as [{ sessions: Array<{ sessionId: string }> }])[0]
    expect(saved.sessions.map((session) => session.sessionId)).toEqual([sshSessionId])

    fireEvent.contextMenu(screen.getByRole("button", { name: "SSH G11" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "SSH G11" })).not.toBeInTheDocument())
    expect(bridge.sessions.close).toHaveBeenCalledWith(sshSessionId)
    expect(screen.getByRole("heading", { name: "Hosts" })).toBeInTheDocument()
  })

  it("asks how to handle active SFTP transfers before closing the page", async () => {
    const transfer = {
      id: "transfer-1",
      workspaceId: "sftp-session",
      hostId: host.id,
      direction: "upload" as const,
      name: "release.zip",
      remotePath: "/release.zip",
      status: "running" as const,
      bytesTransferred: 10,
      totalBytes: 20,
      attempt: 1,
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:01.000Z"
    }
    bridge.sftp.listTransfers.mockResolvedValue([transfer])
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    try {
      bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
      render(<App />)

      await waitFor(() => expect(workspace().sessions).toHaveLength(1))
      openHostAction("G11, SSH, root", "Open SFTP")
      await waitFor(() => expect(screen.getByRole("button", { name: "SFTP G11" })).toBeInTheDocument())

      fireEvent.contextMenu(screen.getByRole("button", { name: "SFTP G11" }))
      fireEvent.click(screen.getByRole("menuitem", { name: "Close" }))

      await waitFor(() => expect(bridge.sftp.cancelTransfer).toHaveBeenCalledWith(transfer.id))
      await waitFor(() => expect(screen.queryByRole("button", { name: "SFTP G11" })).not.toBeInTheDocument())
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining("1 transfer(s)"))
      expect(bridge.sftp.close).toHaveBeenCalledWith(expect.any(String))
    } finally {
      confirm.mockRestore()
    }
  })

  it("returns to Hosts from the brand without closing mixed sessions", async () => {
    bridge.bootstrap.load.mockResolvedValue(bootstrapSnapshot([host], workspaceSnapshot(host.id)))
    render(<App />)

    await waitFor(() => expect(workspace().sessions).toHaveLength(1))
    openHostAction("G11, SSH, root", "Open SFTP")
    await waitFor(() => expect(screen.getByRole("heading", { name: "File Browser" })).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: "Rocker" }))
    await waitFor(() => expect(screen.getByRole("heading", { name: "Hosts" })).toBeInTheDocument())
    expect(screen.getByRole("button", { name: "SSH G11" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "SFTP G11" })).toBeInTheDocument()
    expect(bridge.sessions.close).not.toHaveBeenCalled()
  })
})

function workspace(): TerminalWorkspaceState {
  return terminalHarness.latestWorkspace as TerminalWorkspaceState
}

function openHostAction(hostLabel: string, action: string): void {
  fireEvent.click(screen.getByRole("button", { name: "Hosts" }))
  fireEvent.contextMenu(screen.getByRole("button", { name: hostLabel }), { clientX: 120, clientY: 80 })
  fireEvent.click(screen.getByRole("menuitem", { name: action }))
}

async function openForwardingSession(hostLabel: string): Promise<void> {
  openHostAction(hostLabel, "Open forwarding")
  fireEvent.click(await screen.findByRole("button", { name: "Open session" }))
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolvePromise: (value: T) => void = () => undefined
  let rejectPromise: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

function settingsSnapshot(overrides: Partial<AppSettings>): AppSettings {
  return {
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
    bindAddress: "127.0.0.1",
    ...overrides
  }
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

function workspaceSnapshotWithTwoSessionsAndLayout(hostId: string) {
  return {
    ...workspaceSnapshotWithTwoSessions(hostId),
    layout: { kind: "leaf" as const, sessionId: "22222222-2222-4222-8222-222222222222" }
  }
}

function workspaceSnapshotWithSplitLayout(hostId: string) {
  return {
    ...workspaceSnapshotWithTwoSessions(hostId),
    layout: {
      kind: "split" as const,
      direction: "horizontal" as const,
      ratio: 0.5,
      first: { kind: "leaf" as const, sessionId: "22222222-2222-4222-8222-222222222222" },
      second: { kind: "leaf" as const, sessionId: "33333333-3333-4333-8333-333333333333" }
    }
  }
}

function createBridge() {
  return {
    app: { platform: "linux" as NodeJS.Platform, minimize: vi.fn(async () => undefined), toggleMaximize: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
    hosts: {
      list: vi.fn(async (): Promise<HostProfile[]> => []),
      save: vi.fn(async () => undefined),
      duplicate: vi.fn(async (id: string): Promise<HostProfile> => ({ ...host, id, name: `${host.name} copy` })),
      setFavorite: vi.fn(async (id: string, favorite: boolean): Promise<HostProfile> => ({ ...host, id, favorite })),
      remove: vi.fn(async () => undefined),
      importSshConfig: vi.fn(async () => []),
      testConnection: vi.fn(async () => ({ status: "reachable" as const, latencyMs: 24 }))
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
      listOverview: vi.fn(async (): Promise<ForwardingProfileView[]> => []),
      listForHost: vi.fn(async (): Promise<ForwardingProfileView[]> => []),
      createProfile: vi.fn(async () => forwardingRow().profile),
      updateProfile: vi.fn(async () => forwardingRow().profile),
      removeProfile: vi.fn(async () => undefined),
      startProfile: vi.fn(async () => forwardingRow().runtime),
      openAddress: vi.fn(async () => undefined)
    },
    sftp: {
      open: vi.fn(async (workspaceId: string, hostId: string) => ({ workspaceId, hostId, state: "ready" as const, path: "/" })),
      close: vi.fn(async () => undefined),
      list: vi.fn(async (workspaceId: string, path: string) => ({ workspaceId, path, entries: [] })),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      chooseUpload: vi.fn(async () => undefined),
      chooseDownload: vi.fn(async () => undefined),
      upload: vi.fn(async () => ({ kind: "started" as const, task: undefined })),
      download: vi.fn(async () => ({ kind: "started" as const, task: undefined })),
      listTransfers: vi.fn(async (): Promise<SftpTransferTask[]> => []),
      cancelTransfer: vi.fn(async () => undefined),
      retryTransfer: vi.fn(async () => ({ kind: "started" as const, task: undefined }))
    },
    workspace: {
      load: vi.fn(async (): Promise<StoredWorkspaceWindow | undefined> => undefined),
      save: vi.fn(async () => undefined)
    },
    bootstrap: {
      load: vi.fn(async () => bootstrapSnapshot([], undefined)),
      retry: vi.fn(async () => ({}))
    },
    history: { list: vi.fn(async () => []), clear: vi.fn(async () => undefined) },
    settings: {
      get: vi.fn(async (): Promise<AppSettings> => ({ locale: "en", sidebarWidth: 220, terminalFont: "JetBrains Mono", terminalFontSize: 13, scrollback: 10000, cursorStyle: "bar", cursorBlink: true, terminalBell: true, connectionTimeout: 15, autoReconnect: true, reconnectMode: "limited", restorePreviousWorkspace: true, confirmMultilinePaste: true, bindAddress: "127.0.0.1" })),
      update: vi.fn(async (update: object): Promise<AppSettings> => ({ locale: "en", sidebarWidth: 220, terminalFont: "JetBrains Mono", terminalFontSize: 13, scrollback: 10000, cursorStyle: "bar", cursorBlink: true, terminalBell: true, connectionTimeout: 15, autoReconnect: true, reconnectMode: "limited", restorePreviousWorkspace: true, confirmMultilinePaste: true, bindAddress: "127.0.0.1", ...update }))
    },
    diagnostics: { export: vi.fn(async () => ({ canceled: true })) },
    configuration: {
      exportTemplate: vi.fn(async (): Promise<ConfigurationExportResult> => ({ canceled: true })),
      exportBundle: vi.fn(async (): Promise<ConfigurationExportResult> => ({ canceled: true })),
      chooseImport: vi.fn(async (): Promise<ConfigurationImportChooseResult> => ({ canceled: true })),
      previewImport: vi.fn(async (): Promise<ImportPreview> => ({
        format: "rocker-config",
        encrypted: false,
        requiresPassword: false,
        hosts: { total: 0, new: 0, matching: 0, conflicts: 0 },
        hostKeys: { total: 0, new: 0, matching: 0, conflicts: 0 },
        hostConflicts: [],
        hostKeyConflicts: [],
        credentials: { total: 0 },
        hasSettings: false
      })),
      applyImport: vi.fn(async (): Promise<ImportResult> => ({
        importedHosts: 0,
        replacedHosts: 0,
        copiedHosts: 0,
        importedHostKeys: 0,
        replacedHostKeys: 0,
        skippedHostKeys: 0,
        importedCredentials: 0,
        skippedCredentials: 0,
        settingsApplied: false
      }))
    },
    credentials: {
      protectionStatus: vi.fn(async () => ({ mode: "keychain" as const, keychainAvailable: true, vaultState: "not-configured" as const })),
      enableVault: vi.fn(async () => ({ mode: "vault" as const, keychainAvailable: true, vaultState: "unlocked" as const })),
      unlockVault: vi.fn(async () => ({ mode: "vault" as const, keychainAvailable: true, vaultState: "unlocked" as const })),
      lockVault: vi.fn(async () => ({ mode: "vault" as const, keychainAvailable: true, vaultState: "locked" as const })),
      disableVault: vi.fn(async () => ({ mode: "keychain" as const, keychainAvailable: true, vaultState: "not-configured" as const }))
    },
    events: {
      onSessionEvent: vi.fn((listener: (event: TerminalSessionEvent) => void) => {
        sessionListener = listener
        return vi.fn()
      }),
      onSessionLaunch: vi.fn(() => vi.fn()),
      onForwardingEvent: vi.fn((listener: () => void) => {
        forwardingListener = listener
        return vi.fn()
      }),
      onSftpEvent: vi.fn(() => vi.fn())
    }
  }
}

function forwardingRow() {
  return {
    profile: {
      id: "profile-1",
      hostId: host.id,
      name: "G11",
      localAddress: "127.0.0.1" as const,
      localPort: 3000,
      remoteAddress: "127.0.0.1",
      remotePort: 3000,
      autoStart: false,
      createdAt: "2026-09-17T00:00:00.000Z",
      updatedAt: "2026-09-17T00:00:00.000Z"
    },
    runtime: {
      id: "forward-1",
      hostId: host.id,
      profileId: "profile-1",
      connectionId: "connection-1",
      localAddress: "127.0.0.1",
      localPort: 3000,
      remoteAddress: "127.0.0.1",
      remotePort: 3000,
      status: "forwarding" as const
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
