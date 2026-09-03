import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../../i18n"
import { CommandPalette, type CommandPaletteProps } from "./CommandPalette"
import type { CommandContext } from "./command-registry"

describe("CommandPalette", () => {
  it("renders grouped commands, keeps disabled rows visible, and fuzzy filters labels", () => {
    const context = createContext(undefined)
    renderPalette({ context })

    expect(screen.getByRole("dialog", { name: "Command Palette" })).toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "Search commands" })).toBeInTheDocument()
    expect(screen.getByText("Terminal")).toBeInTheDocument()
    expect(screen.getByText("Session")).toBeInTheDocument()
    expect(screen.getByText("Navigation")).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Search terminal" })).toHaveAttribute("aria-disabled", "true")

    fireEvent.change(screen.getByRole("searchbox", { name: "Search commands" }), { target: { value: "paste" } })

    expect(screen.getByRole("option", { name: "Paste" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Hosts" })).not.toBeInTheDocument()
  })

  it("shows typed recent-session input only in the empty-query section", () => {
    const context = createContext("connected")
    context.recentSessions = [
      { id: "recent-1", label: "Build server", session: { ...connectedSession, id: "recent-1", label: "Build server" }, lastFocusedAt: 200 },
      { id: "recent-2", label: "Logs", session: { ...connectedSession, id: "recent-2", label: "Logs" }, lastFocusedAt: 100 }
    ]
    renderPalette({ context })

    expect(screen.getByText("Recent Sessions")).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Build server" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Logs" })).toBeInTheDocument()

    fireEvent.change(screen.getByRole("searchbox", { name: "Search commands" }), { target: { value: "paste" } })
    expect(screen.getByRole("option", { name: "Paste" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Build server" })).not.toBeInTheDocument()
  })

  it("moves selection, executes with Enter, closes, and restores focus", async () => {
    const context = createContext("connected")
    const onClose = vi.fn()
    const onRestoreFocus = vi.fn()
    renderPalette({ context, onClose, onRestoreFocus })
    const query = screen.getByRole("searchbox", { name: "Search commands" })

    fireEvent.change(query, { target: { value: "focus" } })
    fireEvent.keyDown(query, { key: "ArrowDown" })
    fireEvent.keyDown(query, { key: "ArrowUp" })
    fireEvent.keyDown(query, { key: "Enter" })

    await waitFor(() => expect(context.actions.terminal.focus).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onRestoreFocus).toHaveBeenCalledTimes(1)
  })

  it("closes on Escape and reports only a safe failure status", async () => {
    const context = createContext("connected")
    const copy = context.actions.terminal.copy as unknown as ReturnType<typeof vi.fn>
    copy.mockRejectedValue(new Error("password and terminal output"))
    const onClose = vi.fn()
    const onRestoreFocus = vi.fn()
    renderPalette({ context, onClose, onRestoreFocus })
    const query = screen.getByRole("searchbox", { name: "Search commands" })

    fireEvent.change(query, { target: { value: "copy" } })
    fireEvent.keyDown(query, { key: "Enter" })
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Command could not be completed."))
    expect(screen.queryByText("password and terminal output")).not.toBeInTheDocument()

    fireEvent.keyDown(query, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onRestoreFocus).toHaveBeenCalledTimes(1)
  })
})

const connectedSession = {
  id: "session-1",
  hostId: "host-1",
  label: "G11",
  state: "connected" as const,
  channelGeneration: 1
}

function createContext(state: "connected" | undefined): CommandContext {
  const activeSession = state ? connectedSession : undefined
  return {
    activeSession,
    connectionState: state,
    terminalBufferAvailable: Boolean(activeSession),
    terminal: {
      hasSelection: () => Boolean(activeSession),
      copy: vi.fn(),
      paste: vi.fn(),
      selectAll: vi.fn(),
      clear: vi.fn(),
      focus: vi.fn()
    },
    clipboard: { canPaste: state === "connected" },
    selection: { hasSelection: Boolean(activeSession) },
    activeNavigation: "terminal",
    settingsAvailable: true,
    recentSessions: [],
    actions: {
      terminal: {
        search: vi.fn(),
        copy: vi.fn(),
        paste: vi.fn(),
        selectAll: vi.fn(),
        clear: vi.fn(),
        focus: vi.fn(),
        increaseFont: vi.fn(),
        decreaseFont: vi.fn(),
        resetFont: vi.fn()
      },
      session: {
        activate: vi.fn(),
        reconnect: vi.fn(),
        rename: vi.fn(),
        duplicate: vi.fn(),
        duplicateWindow: vi.fn(),
        splitHorizontal: vi.fn(),
        close: vi.fn()
      },
      navigation: { navigate: vi.fn() },
      palette: { open: vi.fn() }
    }
  }
}

function renderPalette(overrides: Partial<CommandPaletteProps> = {}): void {
  const context = overrides.context ?? createContext("connected")
  render(<I18nProvider><CommandPalette open context={context} onClose={vi.fn()} onRestoreFocus={vi.fn()} {...overrides} /></I18nProvider>)
}
