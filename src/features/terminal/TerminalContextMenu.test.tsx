import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../../i18n"
import { TerminalContextMenu, type TerminalContextMenuProps } from "./TerminalContextMenu"
import type { CommandContext } from "../commands/command-registry"

describe("TerminalContextMenu", () => {
  it("disables Copy without a selection and Paste while disconnected", () => {
    const disconnected = createContext("disconnected", false)
    renderMenu({ context: disconnected })

    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeDisabled()
    expect(screen.getByRole("menuitem", { name: "Paste" })).toBeDisabled()
  })

  it.each(["connecting", "reconnecting", "error"] as const)("disables Paste while %s", (state) => {
    const context = createContext(state, true)
    renderMenu({ context })

    expect(screen.getByRole("menuitem", { name: "Paste" })).toBeDisabled()
  })

  it("dispatches common actions through typed registry command ids", async () => {
    const context = createContext("connected", true)
    renderMenu({ context })

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Select all" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Search terminal" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear terminal" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Focus terminal" }))

    await waitFor(() => {
      expect(context.actions.terminal.copy).toHaveBeenCalledTimes(1)
      expect(context.actions.terminal.selectAll).toHaveBeenCalledTimes(1)
      expect(context.actions.terminal.search).toHaveBeenCalledTimes(1)
      expect(context.actions.terminal.clear).toHaveBeenCalledTimes(1)
      expect(context.actions.terminal.focus).toHaveBeenCalledTimes(1)
    })
    expect(context.actions.terminal.paste).not.toHaveBeenCalled()
  })

  it("exposes an accessible menu and closes after a successful command", async () => {
    const context = createContext("connected", true)
    const onClose = vi.fn()
    renderMenu({ context, onClose })

    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Paste" })).toHaveAttribute("data-command-id", "terminal.paste")

    fireEvent.click(screen.getByRole("menuitem", { name: "Paste" }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})

const connectedSession = {
  id: "session-1",
  hostId: "host-1",
  label: "G11",
  state: "connected" as const,
  channelGeneration: 1
}

function createContext(state: "connected" | "disconnected" | "connecting" | "reconnecting" | "error", hasSelection: boolean): CommandContext {
  const activeSession = { ...connectedSession, state }
  return {
    activeSession,
    connectionState: state,
    terminalBufferAvailable: true,
    terminal: {
      hasSelection: () => hasSelection,
      copy: vi.fn(),
      paste: vi.fn(),
      selectAll: vi.fn(),
      clear: vi.fn(),
      focus: vi.fn()
    },
    selection: { hasSelection },
    clipboard: { canPaste: state === "connected" },
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

function renderMenu(overrides: Partial<TerminalContextMenuProps> = {}): void {
  const context = overrides.context ?? createContext("connected", true)
  render(<I18nProvider><TerminalContextMenu open x={120} y={80} context={context} onClose={vi.fn()} {...overrides} /></I18nProvider>)
}
