import type { TerminalDimensions, TerminalOutputPacket } from "../../../electron/ssh/types"

export interface TerminalWriteAdapter {
  write(bytes: Uint8Array, done: () => void): void
  focus(): void
  dispose(): void
  setDisableStdin(disabled: boolean): void
  setFont(fontFamily: string, fontSize: number): void
}

export interface TerminalFitAdapter {
  fit(): void
  dimensions(): TerminalDimensions | undefined
}

export interface TerminalControllerCallbacks {
  onInput(data: string): void
  onResize(dimensions: TerminalDimensions): void
  onAck(channelGeneration: number, sequence: number): void
}

interface QueuedWrite {
  bytes: Uint8Array
  packet?: Pick<TerminalOutputPacket, "channelGeneration" | "sequence">
}

export class TerminalController {
  private channelGeneration = 0
  private nextSequence = 1
  private connected = false
  private disposed = false
  private writing = false
  private readonly queue: QueuedWrite[] = []
  private lastDimensions?: TerminalDimensions

  public constructor(
    private readonly sessionId: string,
    private readonly terminal: TerminalWriteAdapter,
    private readonly fitAddon: TerminalFitAdapter,
    private readonly callbacks: TerminalControllerCallbacks
  ) {}

  public attach(): void {
    if (this.disposed) return
    this.terminal.setDisableStdin(!this.connected)
  }

  public setChannelGeneration(generation: number): void {
    if (this.disposed || !Number.isSafeInteger(generation) || generation < 0 || generation === this.channelGeneration) return
    this.channelGeneration = generation
    this.nextSequence = 1
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const item = this.queue[index]
      if (item.packet) this.queue.splice(index, 1)
    }
  }

  public acceptOutput(packet: TerminalOutputPacket): void {
    if (
      this.disposed ||
      packet.sessionId !== this.sessionId ||
      packet.channelGeneration !== this.channelGeneration ||
      packet.sequence !== this.nextSequence ||
      packet.bytes.byteLength === 0
    ) return
    this.nextSequence += 1
    this.queue.push({
      bytes: packet.bytes,
      packet: { channelGeneration: packet.channelGeneration, sequence: packet.sequence }
    })
    this.flush()
  }

  public writeLocalNotice(kind: "reconnected" | "restored-new-shell"): void {
    if (this.disposed) return
    const message = kind === "reconnected" ? "\r\n[Rocker] Reconnected\r\n" : "\r\n[Rocker] Restored a new shell\r\n"
    this.queue.push({ bytes: new TextEncoder().encode(message) })
    this.flush()
  }

  public setConnected(connected: boolean): void {
    if (this.disposed) return
    this.connected = connected
    this.terminal.setDisableStdin(!connected)
  }

  public sendInput(data: string): void {
    if (!this.disposed && this.connected && data.length > 0) this.callbacks.onInput(data)
  }

  public applyPreferences(fontFamily: string, fontSize: number): void {
    if (this.disposed) return
    this.terminal.setFont(fontFamily, fontSize)
  }

  public fit(): TerminalDimensions | undefined {
    if (this.disposed) return undefined
    this.fitAddon.fit()
    const dimensions = this.fitAddon.dimensions()
    if (!isValidDimensions(dimensions)) return undefined
    if (!sameDimensions(this.lastDimensions, dimensions)) {
      this.lastDimensions = dimensions
      this.callbacks.onResize(dimensions)
    }
    return dimensions
  }

  public focus(): void {
    if (!this.disposed) this.terminal.focus()
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.queue.length = 0
    this.terminal.dispose()
  }

  private flush(): void {
    if (this.disposed || this.writing) return
    const item = this.queue.shift()
    if (!item) return
    this.writing = true
    this.terminal.write(item.bytes, () => {
      this.writing = false
      if (this.disposed) return
      if (item.packet && item.packet.channelGeneration === this.channelGeneration) {
        this.callbacks.onAck(item.packet.channelGeneration, item.packet.sequence)
      }
      this.flush()
    })
  }
}

function isValidDimensions(value: TerminalDimensions | undefined): value is TerminalDimensions {
  return value !== undefined &&
    Number.isInteger(value.cols) && value.cols >= 1 && value.cols <= 500 &&
    Number.isInteger(value.rows) && value.rows >= 1 && value.rows <= 500
}

function sameDimensions(left: TerminalDimensions | undefined, right: TerminalDimensions): boolean {
  return left?.cols === right.cols && left.rows === right.rows
}
