import { vi } from "vitest"
import type { CodexTransport } from "./rpc"
import { record } from "./types"

export class TestTransport implements CodexTransport {
  private data?: (data: Buffer) => void
  private failure?: (error: Error) => void
  sent: Record<string, unknown>[] = []
  close = vi.fn()
  constructor(private automatic = true) {}
  onData(listener: (data: Buffer) => void): void { this.data = listener }
  onClose(listener: (error: Error) => void): void { this.failure = listener }
  disconnect(): void { this.failure?.(new Error("SSH disconnected")) }
  bytes(value: Buffer): void { this.data?.(value) }
  emit(value: unknown): void { this.bytes(Buffer.from(`${JSON.stringify(value)}\n`)) }
  write(value: string): void {
    const request = record(JSON.parse(value)); this.sent.push(request)
    if (!this.automatic || typeof request.id !== "number" || !request.method || request.method === "command/exec") return
    queueMicrotask(() => {
      const params = record(request.params)
      const result = request.method === "thread/start" ? { thread: { id: "thread-1", turns: [] } }
        : request.method === "thread/resume" ? { thread: { id: params.threadId, turns: [] } }
        : request.method === "turn/start" ? { turn: { id: "turn-1" } } : {}
      this.emit({ id: request.id, result })
    })
  }
}
