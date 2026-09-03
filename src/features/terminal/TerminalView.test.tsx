import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkspaceSession } from "./session-state"
import { TerminalView } from "./TerminalView"
import type { TerminalPreferences } from "./terminal-controller"

const xterm = vi.hoisted(() => {
  const terminals: FakeTerminal[] = []

  class FakeTerminal {
    public readonly options: Record<string, unknown>
    public readonly loadAddon = vi.fn()
    public readonly onWriteParsed = vi.fn(() => ({ dispose: vi.fn() }))
    public readonly onResize = vi.fn(() => ({ dispose: vi.fn() }))
    public readonly open = vi.fn()
    public readonly focus = vi.fn()
    public readonly dispose = vi.fn()
    public readonly selectAll = vi.fn()
    public readonly clear = vi.fn()
    public readonly write = vi.fn((_data: Uint8Array | string, done?: () => void) => done?.())
    public readonly hasSelection = vi.fn(() => false)
    public readonly getSelection = vi.fn(() => "")
    public readonly attachCustomKeyEventHandler = vi.fn((handler: (event: KeyboardEvent) => boolean) => {
      this.customKeyHandler = handler
    })
    private dataListener?: (data: string) => void
    private customKeyHandler?: (event: KeyboardEvent) => boolean

    public constructor(options: Record<string, unknown> = {}) {
      this.options = { ...options }
      terminals.push(this)
    }

    public onData(listener: (data: string) => void) {
      this.dataListener = listener
      return { dispose: vi.fn() }
    }

    public emitData(data: string): void {
      this.dataListener?.(data)
    }

    public emitCustomKey(event: KeyboardEvent): boolean | undefined {
      return this.customKeyHandler?.(event)
    }
  }

  return { terminals, Terminal: FakeTerminal }
})

const fit = vi.hoisted(() => {
  const addons: FakeFitAddon[] = []

  class FakeFitAddon {
    public readonly fit = vi.fn()
    public readonly dispose = vi.fn()
    public readonly proposeDimensions = vi.fn(() => ({ cols: 120, rows: 40 }))

    public constructor() {
      addons.push(this)
    }
  }

  return { addons, FitAddon: FakeFitAddon }
})

const search = vi.hoisted(() => {
  const addons: FakeSearchAddon[] = []

  class FakeSearchAddon {
    public readonly dispose = vi.fn()
    public readonly findNext = vi.fn(() => true)
    public readonly findPrevious = vi.fn(() => true)
    public readonly clearDecorations = vi.fn()
    public readonly onDidChangeResults = vi.fn(() => ({ dispose: vi.fn() }))

    public constructor() {
      addons.push(this)
    }
  }

  return { addons, SearchAddon: FakeSearchAddon }
})

vi.mock("@xterm/xterm", () => ({ Terminal: xterm.Terminal }))
vi.mock("@xterm/addon-fit", () => ({ FitAddon: fit.FitAddon }))
vi.mock("@xterm/addon-search", () => ({ SearchAddon: search.SearchAddon }))

const session: WorkspaceSession = {
  id: "11111111-1111-4111-8111-111111111111",
  hostId: "host-a",
  label: "G11",
  state: "connected",
  channelGeneration: 1,
  dimensions: { cols: 120, rows: 40 }
}

describe("TerminalView", () => {
  beforeEach(() => {
    xterm.terminals.length = 0
    fit.addons.length = 0
    search.addons.length = 0
    vi.clearAllMocks()
  })

  afterEach(() => vi.restoreAllMocks())

  it("confirms a multi-line paste and lets unselected Ctrl+C reach the shell", () => {
    const onInput = vi.fn()
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)

    render(<TerminalView {...createProps({ onInput })} />)
    const surface = screen.getByTestId("terminal-surface")
    fireEvent.paste(surface, { clipboardData: { getData: () => "a\nb" } })
    fireEvent.keyDown(surface, { key: "c", ctrlKey: true })

    expect(confirm).toHaveBeenCalledWith("Paste multiple lines into the terminal?")
    expect(onInput).toHaveBeenNthCalledWith(1, "a\nb")
    expect(onInput).toHaveBeenNthCalledWith(2, "\u0003")
  })

  it("copies a selected terminal range with the platform shortcut", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard })
    const onInput = vi.fn()

    render(<TerminalView {...createProps({ onInput })} />)
    const terminal = xterm.terminals[0]
    terminal.hasSelection.mockReturnValue(true)
    terminal.getSelection.mockReturnValue("selected output")

    const result = terminal.emitCustomKey({
      altKey: false,
      ctrlKey: true,
      key: "c",
      metaKey: false,
      preventDefault: vi.fn(),
      shiftKey: true
    } as unknown as KeyboardEvent)

    expect(result).toBe(false)
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("selected output"))
    expect(onInput).not.toHaveBeenCalled()
  })

  it("copies a selected terminal range with Cmd+C on macOS", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard })

    render(<TerminalView {...createProps()} />)
    const terminal = xterm.terminals[0]
    terminal.hasSelection.mockReturnValue(true)
    terminal.getSelection.mockReturnValue("macOS selection")

    const result = terminal.emitCustomKey({
      altKey: false,
      ctrlKey: false,
      key: "c",
      metaKey: true,
      preventDefault: vi.fn(),
      shiftKey: false
    } as unknown as KeyboardEvent)

    expect(result).toBe(false)
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("macOS selection"))
  })

  it("keeps one xterm instance while applying live appearance preferences", async () => {
    const { rerender } = render(<TerminalView {...createProps()} />)
    const terminal = xterm.terminals[0]

    rerender(<TerminalView {...createProps({ preferences: {
      fontFamily: "Cascadia Mono",
      fontSize: 15,
      scrollback: 25000,
      cursorStyle: "underline",
      cursorBlink: false,
      terminalBell: false
    } })} />)

    expect(xterm.terminals).toHaveLength(1)
    expect(terminal.options.fontFamily).toBe("Cascadia Mono")
    expect(terminal.options.fontSize).toBe(15)
    expect(terminal.options.scrollback).toBe(25000)
    expect(terminal.options.cursorStyle).toBe("underline")
    expect(terminal.options.cursorBlink).toBe(false)
    expect(terminal.options.bellStyle).toBe("none")
    await waitFor(() => expect(fit.addons[0].fit).toHaveBeenCalled())
  })

  it("registers its controller for the stable session and clears it on disposal", () => {
    const onController = vi.fn()
    const { unmount } = render(<TerminalView {...createProps({ onController })} />)

    expect(onController).toHaveBeenCalledWith(session.id, expect.objectContaining({ acceptOutput: expect.any(Function) }))
    unmount()
    expect(onController).toHaveBeenLastCalledWith(session.id, undefined)
  })

  it("registers a renderer-only command surface for the stable terminal", () => {
    const onCommandSurface = vi.fn()
    const { unmount } = render(<TerminalView {...createProps({ onCommandSurface })} />)
    const surface = onCommandSurface.mock.calls[0][1] as {
      copy(): Promise<void>
      clear(): void
      focus(): void
      selectAll(): void
    }

    expect(surface).toEqual(expect.objectContaining({ copy: expect.any(Function), clear: expect.any(Function), focus: expect.any(Function), selectAll: expect.any(Function) }))
    surface.clear()
    surface.focus()
    surface.selectAll()
    expect(xterm.terminals[0].clear).toHaveBeenCalledTimes(1)
    expect(xterm.terminals[0].focus).toHaveBeenCalledTimes(1)
    expect(xterm.terminals[0].selectAll).toHaveBeenCalledTimes(1)

    unmount()
    expect(onCommandSurface).toHaveBeenLastCalledWith(session.id, undefined)
  })

  it("creates one per-session search controller and disposes it with the xterm", () => {
    const onSearchController = vi.fn()
    const { unmount } = render(<TerminalView {...createProps({ onSearchController })} />)

    expect(search.addons).toHaveLength(1)
    expect(onSearchController).toHaveBeenCalledWith(session.id, expect.objectContaining({ getState: expect.any(Function) }))

    unmount()

    expect(search.addons[0].dispose).toHaveBeenCalledTimes(1)
    expect(onSearchController).toHaveBeenLastCalledWith(session.id, undefined)
  })

  it("fits a mounted hidden surface so a restored session receives a real grid", async () => {
    render(<TerminalView {...createProps({ visible: false })} />)

    await waitFor(() => expect(fit.addons[0].fit).toHaveBeenCalled())
  })
})

function createProps(overrides: Partial<ComponentProps<typeof TerminalView>> = {}) {
  return {
    session,
    visible: true,
    preferences: {
      fontFamily: "JetBrains Mono",
      fontSize: 13,
      scrollback: 10000,
      cursorStyle: "bar",
      cursorBlink: true,
      terminalBell: true
    } satisfies TerminalPreferences,
    confirmMultilinePaste: true,
    onInput: vi.fn(),
    onResize: vi.fn(),
    onAck: vi.fn(),
    onController: vi.fn(),
    onSearchController: vi.fn(),
    ...overrides
  }
}
