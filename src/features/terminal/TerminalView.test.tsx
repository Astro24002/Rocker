import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkspaceSession } from "./session-state"
import { TerminalView } from "./TerminalView"

const xterm = vi.hoisted(() => {
  const terminals: FakeTerminal[] = []

  class FakeTerminal {
    public readonly options: Record<string, unknown>
    public readonly loadAddon = vi.fn()
    public readonly open = vi.fn()
    public readonly focus = vi.fn()
    public readonly dispose = vi.fn()
    public readonly write = vi.fn((_data: Uint8Array | string, done?: () => void) => done?.())
    public readonly hasSelection = vi.fn(() => false)
    public readonly attachCustomKeyEventHandler = vi.fn()
    private dataListener?: (data: string) => void

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

vi.mock("@xterm/xterm", () => ({ Terminal: xterm.Terminal }))
vi.mock("@xterm/addon-fit", () => ({ FitAddon: fit.FitAddon }))

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

  it("keeps one xterm instance while applying live font preferences", async () => {
    const { rerender } = render(<TerminalView {...createProps()} />)
    const terminal = xterm.terminals[0]

    rerender(<TerminalView {...createProps({ fontFamily: "Cascadia Mono", fontSize: 15 })} />)

    expect(xterm.terminals).toHaveLength(1)
    expect(terminal.options.fontFamily).toBe("Cascadia Mono")
    expect(terminal.options.fontSize).toBe(15)
    await waitFor(() => expect(fit.addons[0].fit).toHaveBeenCalled())
  })

  it("registers its controller for the stable session and clears it on disposal", () => {
    const onController = vi.fn()
    const { unmount } = render(<TerminalView {...createProps({ onController })} />)

    expect(onController).toHaveBeenCalledWith(session.id, expect.objectContaining({ acceptOutput: expect.any(Function) }))
    unmount()
    expect(onController).toHaveBeenLastCalledWith(session.id, undefined)
  })
})

function createProps(overrides: Partial<ComponentProps<typeof TerminalView>> = {}) {
  return {
    session,
    visible: true,
    fontFamily: "JetBrains Mono",
    fontSize: 13,
    confirmMultilinePaste: true,
    onInput: vi.fn(),
    onResize: vi.fn(),
    onAck: vi.fn(),
    onController: vi.fn(),
    ...overrides
  }
}
