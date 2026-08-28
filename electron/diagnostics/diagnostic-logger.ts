import { readFileSync } from "node:fs"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { DiagnosticEvent } from "./diagnostic-types"
import { sanitizeDiagnosticEvent } from "./sanitize"

export const DIAGNOSTIC_LOG_FILE_NAME = "diagnostics.jsonl"
export const DEFAULT_DIAGNOSTIC_EVENT_LIMIT = 500

export type DiagnosticClock = () => Date | number | string

export interface DiagnosticLoggerOptions {
  directory: string
  clock?: DiagnosticClock
  maxEvents?: number
}

export type DiagnosticEventInput = Partial<DiagnosticEvent> & Record<string, unknown>

const defaultClock: DiagnosticClock = () => new Date()
const writeDelayMs = 100

export class DiagnosticLogger {
  private readonly directory: string
  private readonly filePath: string
  private readonly clock: DiagnosticClock
  private readonly maxEvents: number
  private readonly events: DiagnosticEvent[]
  private writeTimer?: ReturnType<typeof setTimeout>
  private writeChain: Promise<void> = Promise.resolve()
  private dirty = false
  private closing = false
  private closed = false
  private closePromise?: Promise<void>

  public constructor(options: DiagnosticLoggerOptions)
  public constructor(directory: string, clock?: DiagnosticClock, maxEvents?: number)
  public constructor(
    optionsOrDirectory: DiagnosticLoggerOptions | string,
    clock: DiagnosticClock = defaultClock,
    maxEvents = DEFAULT_DIAGNOSTIC_EVENT_LIMIT
  ) {
    if (typeof optionsOrDirectory === "string") {
      this.directory = optionsOrDirectory
      this.clock = clock
      this.maxEvents = normalizeLimit(maxEvents)
    } else {
      this.directory = optionsOrDirectory.directory
      this.clock = optionsOrDirectory.clock ?? defaultClock
      this.maxEvents = normalizeLimit(optionsOrDirectory.maxEvents ?? DEFAULT_DIAGNOSTIC_EVENT_LIMIT)
    }
    this.filePath = join(this.directory, DIAGNOSTIC_LOG_FILE_NAME)
    this.events = loadEvents(this.filePath, this.maxEvents)
  }

  public record(event: DiagnosticEventInput): void {
    if (this.closing || this.closed) return
    const source = { ...event }
    if (typeof source.at !== "string") source.at = this.timestamp()
    this.events.push(sanitizeDiagnosticEvent(source))
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents)
    this.dirty = true
    this.scheduleWrite()
  }

  public snapshot(): DiagnosticEvent[] {
    return this.events.map((event) => structuredClone(event))
  }

  public async flush(): Promise<void> {
    this.clearWriteTimer()
    await this.writeChain
    if (!this.dirty) return

    const events = this.snapshot()
    this.dirty = false
    const nextWrite = this.writeChain.catch(() => undefined).then(() => this.persist(events))
    this.writeChain = nextWrite
    await nextWrite

    if (this.dirty) await this.flush()
  }

  public async close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closing = true
    this.clearWriteTimer()
    this.closePromise = this.flush().finally(() => {
      this.closed = true
    })
    await this.closePromise
  }

  private scheduleWrite(): void {
    if (this.writeTimer || this.closing || this.closed) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined
      void this.flush().catch(() => undefined)
    }, writeDelayMs)
  }

  private clearWriteTimer(): void {
    if (!this.writeTimer) return
    clearTimeout(this.writeTimer)
    this.writeTimer = undefined
  }

  private timestamp(): string {
    try {
      const value = this.clock()
      const date = value instanceof Date ? value : new Date(value)
      if (!Number.isNaN(date.getTime())) return date.toISOString()
    } catch {
      // Logging must remain fail-open if an injected clock is unavailable.
    }
    return new Date().toISOString()
  }

  private async persist(events: DiagnosticEvent[]): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      const content = events.map((event) => `${JSON.stringify(event)}\n`).join("")
      await writeFile(temporaryPath, content, "utf8")
      await rename(temporaryPath, this.filePath)
    } catch {
      // Diagnostics are best effort and must never affect SSH lifecycle work.
    }
  }
}

function normalizeLimit(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_DIAGNOSTIC_EVENT_LIMIT
}

function loadEvents(filePath: string, maxEvents: number): DiagnosticEvent[] {
  let serialized: string
  try {
    serialized = readFileSync(filePath, "utf8")
  } catch {
    return []
  }
  if (!serialized.endsWith("\n")) serialized = serialized.slice(0, serialized.lastIndexOf("\n") + 1)
  const events: DiagnosticEvent[] = []
  for (const line of serialized.split("\n")) {
    if (!line.trim()) continue
    try {
      events.push(sanitizeDiagnosticEvent(JSON.parse(line)))
    } catch {
      // Ignore malformed complete lines and continue loading the ring.
    }
  }
  return events.slice(-maxEvents)
}
