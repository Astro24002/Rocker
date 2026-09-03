import { describe, expect, it, vi } from "vitest"
import type { TerminalSessionState } from "../../../electron/ssh/types"
import {
  commandRegistry,
  executeCommand,
  filterCommands,
  getCommand,
  groupCommands,
  type CommandContext,
  type CommandId
} from "./command-registry"

const session = {
  id: "session-1",
  hostId: "host-1",
  label: "G11",
  state: "connected" as const,
  channelGeneration: 1
}

describe("command registry", () => {
  it("defines the complete typed command surface and stable categories", () => {
    const ids = commandRegistry.map((command) => command.id)

    expect(ids).toEqual([
      "terminal.search",
      "terminal.copy",
      "terminal.paste",
      "terminal.selectAll",
      "terminal.clear",
      "terminal.focus",
      "terminal.font.increase",
      "terminal.font.decrease",
      "terminal.font.reset",
      "session.reconnect",
      "session.rename",
      "session.duplicate",
      "session.duplicate-window",
      "session.split-horizontal",
      "session.close",
      "navigation.hosts",
      "navigation.history",
      "navigation.ports",
      "navigation.settings",
      "navigation.sftp",
      "navigation.snippets",
      "navigation.local-terminal",
      "palette.open"
    ] satisfies CommandId[])

    expect(new Set(commandRegistry.map((command) => command.category))).toEqual(new Set(["terminal", "session", "navigation", "palette"]))
    expect(getCommand("terminal.search")?.label).toBe("Search terminal")
    expect(getCommand("navigation.sftp")?.label).toBe("SFTP")
  })

  it.each([
    ["no active session", undefined, false, {
      "terminal.search": false,
      "terminal.copy": false,
      "terminal.paste": false,
      "terminal.clear": false,
      "session.reconnect": false,
      "session.rename": false,
      "session.duplicate": false,
      "session.duplicate-window": false,
      "session.split-horizontal": false,
      "session.close": false
    }],
    ["connected session", "connected", true, {
      "terminal.search": true,
      "terminal.copy": true,
      "terminal.paste": true,
      "terminal.clear": true,
      "session.reconnect": false,
      "session.rename": true,
      "session.duplicate": true,
      "session.duplicate-window": true,
      "session.split-horizontal": true,
      "session.close": true
    }],
    ["restoring session", "restoring", false, {
      "terminal.search": true,
      "terminal.copy": false,
      "terminal.paste": false,
      "terminal.clear": true,
      "session.reconnect": false,
      "session.rename": true,
      "session.duplicate": false,
      "session.duplicate-window": false,
      "session.split-horizontal": false,
      "session.close": true
    }],
    ["connecting session", "connecting", false, {
      "terminal.search": true,
      "terminal.copy": false,
      "terminal.paste": false,
      "terminal.clear": true,
      "session.reconnect": false,
      "session.rename": true,
      "session.duplicate": false,
      "session.duplicate-window": false,
      "session.split-horizontal": false,
      "session.close": true
    }],
    ["reconnecting session", "reconnecting", false, {
      "terminal.search": true,
      "terminal.copy": false,
      "terminal.paste": false,
      "terminal.clear": true,
      "session.reconnect": false,
      "session.rename": true,
      "session.duplicate": false,
      "session.duplicate-window": false,
      "session.split-horizontal": false,
      "session.close": true
    }],
    ["disconnected session", "disconnected", true, {
      "terminal.search": true,
      "terminal.copy": true,
      "terminal.paste": false,
      "terminal.clear": true,
      "session.reconnect": true,
      "session.rename": true,
      "session.duplicate": true,
      "session.duplicate-window": false,
      "session.split-horizontal": false,
      "session.close": true
    }],
    ["error session", "error", false, {
      "terminal.search": true,
      "terminal.copy": false,
      "terminal.paste": false,
      "terminal.clear": true,
      "session.reconnect": true,
      "session.rename": true,
      "session.duplicate": true,
      "session.duplicate-window": false,
      "session.split-horizontal": false,
      "session.close": true
    }]
  ] satisfies Array<[string, TerminalSessionState | undefined, boolean, Record<string, boolean>]>)("derives exact enabled states for %s", (_name, state, hasSelection, expected) => {
    const context = createContext(state, hasSelection)

    for (const [id, enabled] of Object.entries(expected as Record<string, boolean>)) {
      expect(getCommand(id as CommandId)?.isEnabled(context), id).toBe(enabled)
    }
    expect(getCommand("navigation.sftp")?.isEnabled(context)).toBe(true)
    expect(getCommand("navigation.local-terminal")?.isEnabled(context)).toBe(true)
    expect(getCommand("palette.open")?.isEnabled(context)).toBe(true)
  })

  it("never executes a disabled session command in any connection state", async () => {
    const expectedByState: Array<[TerminalSessionState | undefined, Record<string, boolean>]> = [
      [undefined, {
        "session.reconnect": false,
        "session.rename": false,
        "session.duplicate": false,
        "session.duplicate-window": false,
        "session.split-horizontal": false,
        "session.close": false
      }],
      ["connected", {
        "session.reconnect": false,
        "session.rename": true,
        "session.duplicate": true,
        "session.duplicate-window": true,
        "session.split-horizontal": true,
        "session.close": true
      }],
      ["restoring", {
        "session.reconnect": false,
        "session.rename": true,
        "session.duplicate": false,
        "session.duplicate-window": false,
        "session.split-horizontal": false,
        "session.close": true
      }],
      ["connecting", {
        "session.reconnect": false,
        "session.rename": true,
        "session.duplicate": false,
        "session.duplicate-window": false,
        "session.split-horizontal": false,
        "session.close": true
      }],
      ["reconnecting", {
        "session.reconnect": false,
        "session.rename": true,
        "session.duplicate": false,
        "session.duplicate-window": false,
        "session.split-horizontal": false,
        "session.close": true
      }],
      ["disconnected", {
        "session.reconnect": true,
        "session.rename": true,
        "session.duplicate": true,
        "session.duplicate-window": false,
        "session.split-horizontal": false,
        "session.close": true
      }],
      ["error", {
        "session.reconnect": true,
        "session.rename": true,
        "session.duplicate": true,
        "session.duplicate-window": false,
        "session.split-horizontal": false,
        "session.close": true
      }]
    ]

    for (const [state, expected] of expectedByState) {
      const context = createContext(state, true)
      for (const [commandId, enabled] of Object.entries(expected) as Array<[CommandId, boolean]>) {
        if (enabled) continue
        await expect(executeCommand(commandId, context)).resolves.toEqual({ status: "disabled" })
      }
      for (const action of Object.values(context.actions.session)) expect(action).not.toHaveBeenCalled()
    }
  })

  it("keeps disabled commands visible without executing their actions", async () => {
    const context = createContext(undefined, true)

    await expect(executeCommand("terminal.copy", context)).resolves.toEqual({ status: "disabled" })
    await expect(executeCommand("session.reconnect", context)).resolves.toEqual({ status: "disabled" })

    expect(context.actions.terminal.copy).not.toHaveBeenCalled()
    expect(context.actions.session.reconnect).not.toHaveBeenCalled()
  })

  it("routes enabled terminal, session, navigation, and placeholder commands through typed actions", async () => {
    const context = createContext("connected", true)

    await expect(executeCommand("terminal.copy", context)).resolves.toEqual({ status: "executed" })
    await expect(executeCommand("session.rename", context)).resolves.toEqual({ status: "executed" })
    await expect(executeCommand("navigation.sftp", context)).resolves.toEqual({ status: "executed" })
    await expect(executeCommand("navigation.local-terminal", context)).resolves.toEqual({ status: "executed" })

    expect(context.actions.terminal.copy).toHaveBeenCalledTimes(1)
    expect(context.actions.session.rename).toHaveBeenCalledWith(session)
    expect(context.actions.navigation.navigate).toHaveBeenNthCalledWith(1, "sftp")
    expect(context.actions.navigation.navigate).toHaveBeenNthCalledWith(2, "local-terminal")
  })

  it("returns a safe failure result without exposing an action error", async () => {
    const context = createContext("connected", true)
    const copy = context.actions.terminal.copy as unknown as ReturnType<typeof vi.fn>
    copy.mockRejectedValue(new Error("secret terminal output"))

    await expect(executeCommand("terminal.copy", context)).resolves.toEqual({ status: "failed" })
  })

  it("filters fuzzy matches and groups them in deterministic registry order", () => {
    const filtered = filterCommands(commandRegistry, "font inc")
    expect(filtered.map((command) => command.id)).toEqual(["terminal.font.increase"])

    const groups = groupCommands(filterCommands(commandRegistry, "recon"))
    expect(groups).toEqual([{ category: "session", commands: [getCommand("session.reconnect")] }])
  })
})

function createContext(state: TerminalSessionState | undefined, hasSelection: boolean): CommandContext {
  const activeSession = state ? { ...session, state } : undefined
  return {
    activeSession,
    connectionState: state,
    terminalBufferAvailable: Boolean(activeSession),
    terminal: {
      hasSelection: vi.fn(() => hasSelection),
      copy: vi.fn(),
      paste: vi.fn(),
      selectAll: vi.fn(),
      clear: vi.fn(),
      focus: vi.fn()
    },
    clipboard: { canPaste: state === "connected" },
    selection: { hasSelection },
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
