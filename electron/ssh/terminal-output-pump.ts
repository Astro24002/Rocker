import type { TerminalOutputPacket } from "./types"

const MAX_PACKET_BYTES = 64 * 1024
const PAUSE_AT_BYTES = 4 * 1024 * 1024
const RESUME_BELOW_BYTES = 1 * 1024 * 1024

interface TerminalOutputChannel {
  pause(): void
  resume(): void
}

export class TerminalOutputPump {
  private readonly queued: Uint8Array[] = []
  private readonly inFlight = new Map<number, Uint8Array>()
  private readonly acknowledged = new Set<number>()
  private nextSequence = 1
  private nextAcknowledgement = 1
  private pendingBytes = 0
  private closed = false
  public isPaused = false

  public constructor(
    private readonly channel: TerminalOutputChannel,
    private readonly sessionId: string,
    private readonly channelGeneration: number,
    private readonly send: (packet: TerminalOutputPacket) => void
  ) {}

  public get queuedByteCount(): number {
    return this.pendingBytes
  }

  public enqueue(chunk: Uint8Array): void {
    if (this.closed) return

    for (let offset = 0; offset < chunk.byteLength; offset += MAX_PACKET_BYTES) {
      const bytes = chunk.slice(offset, Math.min(offset + MAX_PACKET_BYTES, chunk.byteLength))
      this.queued.push(bytes)
      this.pendingBytes += bytes.byteLength
    }

    this.flush()
    this.updateFlowControl()
  }

  public acknowledge(channelGeneration: number, sequence: number): void {
    if (this.closed || channelGeneration !== this.channelGeneration || !this.inFlight.has(sequence)) return

    this.acknowledged.add(sequence)
    while (this.acknowledged.delete(this.nextAcknowledgement)) {
      const bytes = this.inFlight.get(this.nextAcknowledgement)!
      this.pendingBytes -= bytes.byteLength
      this.inFlight.delete(this.nextAcknowledgement)
      this.nextAcknowledgement += 1
    }

    this.updateFlowControl()
  }

  public close(): void {
    this.closed = true
    this.queued.length = 0
    this.inFlight.clear()
    this.acknowledged.clear()
    this.pendingBytes = 0
  }

  private flush(): void {
    while (!this.closed && this.queued.length > 0) {
      const bytes = this.queued.shift()!
      const sequence = this.nextSequence++
      this.inFlight.set(sequence, bytes)
      this.send({
        sessionId: this.sessionId,
        channelGeneration: this.channelGeneration,
        sequence,
        bytes
      })
    }
  }

  private updateFlowControl(): void {
    if (!this.isPaused && this.pendingBytes >= PAUSE_AT_BYTES) {
      this.isPaused = true
      this.channel.pause()
    }

    if (this.isPaused && this.pendingBytes < RESUME_BELOW_BYTES) {
      this.isPaused = false
      this.channel.resume()
    }
  }
}
