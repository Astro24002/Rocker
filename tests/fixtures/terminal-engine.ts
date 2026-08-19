import { TerminalOutputPump } from "../../electron/ssh/terminal-output-pump"
import type { TerminalOutputPacket } from "../../electron/ssh/types"
import { TerminalController, type TerminalWriteAdapter } from "../../src/features/terminal/terminal-controller"

class FakeChannel {
  public paused = false
  public onData: (bytes: Uint8Array) => void = () => undefined

  public pause(): void {
    this.paused = true
  }

  public resume(): void {
    this.paused = false
  }

  public emitData(bytes: Uint8Array): void {
    this.onData(bytes)
  }
}

class ManualTerminal implements TerminalWriteAdapter {
  public readonly writes: Uint8Array[] = []
  private readonly completions: Array<() => void> = []

  public write(bytes: Uint8Array, done: () => void): void {
    this.writes.push(bytes)
    this.completions.push(done)
  }

  public completeNextWrite(): void {
    this.completions.shift()?.()
  }

  public completeAllWrites(): void {
    while (this.completions.length > 0) this.completeNextWrite()
  }

  public focus(): void {}

  public dispose(): void {}

  public setDisableStdin(_disabled: boolean): void {}

  public setFont(_fontFamily: string, _fontSize: number): void {}
}

export function createTerminalEngineHarness(sessionId: string) {
  const channel = new FakeChannel()
  const terminal = new ManualTerminal()
  let generation = 1
  let pump!: TerminalOutputPump
  const controller = new TerminalController(
    sessionId,
    terminal,
    {
      fit: () => undefined,
      dimensions: () => ({ cols: 120, rows: 40 })
    },
    {
      onInput: () => undefined,
      onResize: () => undefined,
      onAck: (acknowledgedGeneration, sequence) => pump.acknowledge(acknowledgedGeneration, sequence)
    }
  )
  const createPump = (): TerminalOutputPump => new TerminalOutputPump(
    channel,
    sessionId,
    generation,
    (packet) => controller.acceptOutput(packet)
  )

  pump = createPump()
  channel.onData = (bytes) => pump.enqueue(bytes)

  return {
    channel,
    terminal,
    async open(): Promise<void> {
      controller.setChannelGeneration(generation)
      controller.attach()
      controller.setConnected(true)
    },
    async dropAndRecover(): Promise<void> {
      controller.setConnected(false)
      pump.close()
      generation += 1
      controller.setChannelGeneration(generation)
      pump = createPump()
      controller.setConnected(true)
    },
    emitOldPacket(packet: TerminalOutputPacket): void {
      controller.acceptOutput(packet)
    }
  }
}
