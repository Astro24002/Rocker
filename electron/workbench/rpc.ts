import { StringDecoder } from "node:string_decoder"
import { record, text } from "./types"

export interface CodexTransport {
  write(data: string): void
  close(): void
  onData(listener: (data: Buffer) => void): void
  onClose(listener: (error: Error) => void): void
}

/** One JSONL connection per Codex session; terminal output is never parsed as RPC. */
export class CodexRpc {
  private nextId = 0
  private buffer = ""
  private decoder = new StringDecoder("utf8")
  private failure?: Error
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> }>()
  constructor(private transport: CodexTransport, private onMessage: (message: Record<string, unknown>) => void, private onFailure: (error: Error) => void) {
    transport.onData(data => this.receive(data))
    transport.onClose(error => this.fail(error))
  }
  request(method: string, params: unknown, timeout = 30_000): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure)
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = timeout ? setTimeout(() => this.fail(new Error(`Codex request timed out: ${method}`)), timeout) : undefined
      this.pending.set(id, { resolve, reject, timer })
      try { this.transport.write(`${JSON.stringify({ id, method, params })}\n`) } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
    })
  }
  notify(method: string): void { this.transport.write(`${JSON.stringify({ method })}\n`) }
  respond(id: unknown, result: unknown): void { this.transport.write(`${JSON.stringify({ id, result })}\n`) }
  reject(id: unknown): void { this.transport.write(`${JSON.stringify({ id, error: { code: -32601, message: "Unsupported client request" } })}\n`) }
  close(): void { this.fail(new Error("Codex session closed")) }
  private fail(error: Error): void {
    if (this.failure) return
    this.failure = error
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error) }
    this.pending.clear()
    this.transport.close()
    this.onFailure(error)
  }
  private receive(data: Buffer): void {
    if (this.failure) return
    this.buffer += this.decoder.write(data)
    if (this.buffer.length > 8 * 1024 * 1024) { this.fail(new Error("Codex response exceeds limit")); return }
    let newline: number
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1)
      if (!line.trim()) continue
      try {
        const message = record(JSON.parse(line))
        if (typeof message.method === "string") { this.onMessage(message); continue }
        const entry = typeof message.id === "number" ? this.pending.get(message.id) : undefined
        if (!entry) continue
        this.pending.delete(message.id as number); clearTimeout(entry.timer)
        if (message.error) entry.reject(new Error(text(record(message.error).message) || "Codex request failed"))
        else entry.resolve(message.result)
      } catch (error) { this.fail(error instanceof Error ? error : new Error("Invalid Codex protocol")); return }
    }
  }
}
