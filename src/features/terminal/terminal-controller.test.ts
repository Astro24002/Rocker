import { describe, expect, it, vi } from "vitest"
import { TerminalController, type TerminalWriteAdapter } from "./terminal-controller"

const sessionId = "11111111-1111-4111-8111-111111111111"

describe("TerminalController", () => {
  it("acknowledges a packet only after xterm accepts it", () => {
    const { controller, terminal, callbacks } = createHarness()
    controller.setChannelGeneration(2)

    controller.acceptOutput({ sessionId, channelGeneration: 2, sequence: 1, bytes: Uint8Array.of(0xe4) })

    expect(callbacks.onAck).not.toHaveBeenCalled()
    terminal.completeNextWrite()
    expect(callbacks.onAck).toHaveBeenCalledWith(2, 1)
  })

  it("writes matching packets serially and never writes a stale or duplicate packet", () => {
    const { controller, terminal } = createHarness()
    controller.setChannelGeneration(2)
    controller.acceptOutput({ sessionId, channelGeneration: 1, sequence: 99, bytes: Uint8Array.of(0x61) })
    controller.acceptOutput({ sessionId, channelGeneration: 2, sequence: 1, bytes: Uint8Array.of(0x62) })
    controller.acceptOutput({ sessionId, channelGeneration: 2, sequence: 2, bytes: Uint8Array.of(0x63) })
    terminal.completeNextWrite()
    controller.acceptOutput({ sessionId, channelGeneration: 2, sequence: 1, bytes: Uint8Array.of(0x64) })
    terminal.completeNextWrite()

    expect(terminal.writes.map((bytes) => Buffer.from(bytes).toString("utf8"))).toEqual(["b", "c"])
  })

  it("ignores a state event that moves the channel generation backwards", () => {
    const { controller, terminal } = createHarness()
    controller.setChannelGeneration(2)
    controller.setConnected(true)
    controller.setChannelGeneration(1)
    controller.acceptOutput({ sessionId, channelGeneration: 1, sequence: 1, bytes: Uint8Array.of(0x73) })

    expect(terminal.writes).toHaveLength(0)
  })

  it("sends a resize only for a changed valid fitted grid", () => {
    const { controller, fit, callbacks } = createHarness()
    fit.dimensions
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ cols: 120, rows: 40 })
      .mockReturnValue({ cols: 120, rows: 40 })

    controller.fit()
    controller.fit()
    controller.fit()

    expect(fit.fit).toHaveBeenCalledTimes(3)
    expect(callbacks.onResize).toHaveBeenCalledTimes(1)
    expect(callbacks.onResize).toHaveBeenCalledWith({ cols: 120, rows: 40 })
  })

  it("renders local notices without sending terminal input or output acknowledgements", () => {
    const { controller, terminal, callbacks } = createHarness()

    controller.writeLocalNotice("reconnected")
    terminal.completeNextWrite()

    expect(Buffer.from(terminal.writes[0]).toString("utf8")).toContain("Reconnected")
    expect(callbacks.onInput).not.toHaveBeenCalled()
    expect(callbacks.onAck).not.toHaveBeenCalled()
  })

  it("gates input by connection state and applies terminal preferences without disposal", () => {
    const { controller, terminal, callbacks } = createHarness()
    controller.setConnected(false)
    controller.sendInput("blocked")
    controller.setConnected(true)
    controller.sendInput("accepted")
    controller.applyPreferences("Cascadia Mono", 15)

    expect(terminal.setDisableStdin).toHaveBeenLastCalledWith(false)
    expect(callbacks.onInput).toHaveBeenCalledWith("accepted")
    expect(terminal.setFont).toHaveBeenCalledWith("Cascadia Mono", 15)
    expect(terminal.dispose).not.toHaveBeenCalled()
  })
})

function createHarness() {
  const terminal = new FakeTerminal()
  const fit = {
    fit: vi.fn(),
    dimensions: vi.fn()
  }
  const callbacks = {
    onInput: vi.fn(),
    onResize: vi.fn(),
    onAck: vi.fn()
  }
  return {
    controller: new TerminalController(sessionId, terminal, fit, callbacks),
    terminal,
    fit,
    callbacks
  }
}

class FakeTerminal implements TerminalWriteAdapter {
  public readonly writes: Uint8Array[] = []
  private readonly completions: Array<() => void> = []
  public readonly focus = vi.fn()
  public readonly dispose = vi.fn()
  public readonly setDisableStdin = vi.fn()
  public readonly setFont = vi.fn()

  public write(bytes: Uint8Array, done: () => void): void {
    this.writes.push(bytes)
    this.completions.push(done)
  }

  public completeNextWrite(): void {
    this.completions.shift()?.()
  }
}
