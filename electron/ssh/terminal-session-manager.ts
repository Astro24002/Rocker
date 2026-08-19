import type { Client } from "ssh2"
import { SshConnectionManager, type ConnectionEvent, type ConnectionLease } from "./connection-manager"
import { TerminalOutputPump } from "./terminal-output-pump"
import type {
  ConnectionCommandExecutor,
  OwnedTerminalSessionEvent,
  SessionCommandExecutor,
  TerminalDimensions,
  TerminalFailureReason,
  TerminalSessionEvent,
  TerminalSessionInfo,
  TerminalSessionState
} from "./types"

interface TerminalChannel {
  write(data: string): void
  setWindow(rows: number, cols: number, height: number, width: number): void
  pause(): void
  resume(): void
  end(): void
  on(event: "data" | "close", listener: (data?: Buffer) => void): void
}

export interface TerminalOpenRequest {
  sessionId: string
  hostId: string
  cols: number
  rows: number
  ownerWebContentsId: number
  forceNewConnection?: boolean
  restorePriority?: "active" | "background"
}

export interface TerminalSessionManagerOptions {
  connections: SshConnectionManager
  onEvent?: (event: OwnedTerminalSessionEvent) => void
}

interface SessionRecord {
  request: TerminalOpenRequest
  state: TerminalSessionState
  channelGeneration: number
  recoveryDesired: boolean
  connectionId?: string
  lease?: ConnectionLease
  channel?: TerminalChannel
  output?: TerminalOutputPump
  pendingShell?: Promise<TerminalSessionInfo>
}

interface ShellTask {
  priority: number
  order: number
  run(): Promise<void>
}

export class TerminalSessionManager implements SessionCommandExecutor, ConnectionCommandExecutor {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly listeners = new Set<(event: OwnedTerminalSessionEvent) => void>()
  private readonly shellQueue: ShellTask[] = []
  private readonly unsubscribeConnectionEvents: () => void
  private nextQueueOrder = 0
  private drainingQueue = false
  private queueDrainScheduled = false

  public constructor(private readonly options: TerminalSessionManagerOptions) {
    this.unsubscribeConnectionEvents = options.connections.onEvent((event) => this.handleConnectionEvent(event))
  }

  public onEvent(listener: (event: OwnedTerminalSessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public async open(request: TerminalOpenRequest): Promise<TerminalSessionInfo> {
    if (!isValidSessionId(request.sessionId)) throw new Error("Invalid session identifier")
    if (!isValidDimensions(request.cols, request.rows)) throw new Error("Invalid terminal dimensions")
    if (this.sessions.has(request.sessionId)) throw new Error("Terminal session is already open")

    const record: SessionRecord = {
      request: { ...request },
      state: "connecting",
      channelGeneration: 0,
      recoveryDesired: true
    }
    this.sessions.set(request.sessionId, record)
    this.emitState(record, "connecting")
    try {
      record.lease = await this.options.connections.acquire({
        hostId: request.hostId,
        ownerWebContentsId: request.ownerWebContentsId,
        kind: "terminal",
        forceNewConnection: request.forceNewConnection
      })
      record.connectionId = record.lease.connectionId
      return await this.queueShell(record)
    } catch (error) {
      await this.removeRecord(request.sessionId, false)
      throw error
    }
  }

  public write(sessionId: string, channelGeneration: number, data: string): void {
    const record = this.sessions.get(sessionId)
    if (!record || record.channelGeneration !== channelGeneration || !record.channel || !isValidTerminalData(data)) return
    record.channel.write(data)
  }

  public resize(sessionId: string, channelGeneration: number, dimensions: TerminalDimensions): void {
    const record = this.sessions.get(sessionId)
    if (!record || record.channelGeneration !== channelGeneration || !record.channel || !isValidDimensions(dimensions.cols, dimensions.rows)) return
    record.request.cols = dimensions.cols
    record.request.rows = dimensions.rows
    record.channel.setWindow(dimensions.rows, dimensions.cols, 0, 0)
  }

  public ackOutput(sessionId: string, channelGeneration: number, sequence: number): void {
    const record = this.sessions.get(sessionId)
    if (!record || record.channelGeneration !== channelGeneration) return
    record.output?.acknowledge(channelGeneration, sequence)
  }

  public async reconnect(sessionId: string): Promise<void> {
    const record = this.requireSession(sessionId)
    record.recoveryDesired = true
    if (!record.lease) {
      record.state = "connecting"
      this.emitState(record, "connecting")
      record.lease = await this.options.connections.acquire({
        hostId: record.request.hostId,
        ownerWebContentsId: record.request.ownerWebContentsId,
        kind: "terminal",
        forceNewConnection: record.request.forceNewConnection
      })
      record.connectionId = record.lease.connectionId
    }

    try {
      this.options.connections.getClientForConnection(record.connectionId!)
    } catch {
      record.state = "reconnecting"
      this.emitState(record, "reconnecting")
      return
    }
    await this.queueShell(record, "reconnected")
  }

  public cancelReconnect(sessionId: string): void {
    const record = this.sessions.get(sessionId)
    if (!record || !record.recoveryDesired) return
    record.recoveryDesired = false
    record.output?.close()
    record.output = undefined
    record.channel = undefined
    if (record.lease) {
      const lease = record.lease
      record.lease = undefined
      record.connectionId = undefined
      void this.options.connections.release(lease.id)
    }
    record.state = "disconnected"
    this.emitState(record, "disconnected", "cancelled")
  }

  public async close(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record) return
    record.recoveryDesired = false
    this.emitState(record, "closing")
    record.output?.close()
    record.output = undefined
    record.channel?.end()
    record.channel = undefined
    await this.removeRecord(sessionId, false)
  }

  public async releaseOwner(ownerWebContentsId: number): Promise<void> {
    const ids = [...this.sessions.entries()]
      .filter(([, record]) => record.request.ownerWebContentsId === ownerWebContentsId)
      .map(([sessionId]) => sessionId)
    await Promise.all(ids.map((sessionId) => this.close(sessionId)))
  }

  public retryAfterResume(): void {
    for (const [sessionId, record] of this.sessions) {
      if (!record.recoveryDesired || (record.state !== "reconnecting" && record.state !== "disconnected")) continue
      void this.reconnect(sessionId)
    }
  }

  public async exec(sessionId: string, command: string): Promise<string> {
    const record = this.requireSession(sessionId)
    if (!record.connectionId) throw new Error("SSH connection is not ready")
    return this.options.connections.execOnConnection(record.connectionId, command)
  }

  public async execOnConnection(connectionId: string, command: string): Promise<string> {
    return this.options.connections.execOnConnection(connectionId, command)
  }

  private queueShell(record: SessionRecord, notice?: "reconnected" | "restored-new-shell"): Promise<TerminalSessionInfo> {
    if (record.pendingShell) return record.pendingShell
    const task = new Promise<TerminalSessionInfo>((resolve, reject) => {
      const priority = record.request.restorePriority === "background" ? 1 : 0
      this.shellQueue.push({
        priority,
        order: this.nextQueueOrder++,
        run: async () => {
          try {
            const info = await this.openShell(record, notice)
            resolve(info)
          } catch (error) {
            reject(error)
          }
        }
      })
      this.scheduleQueueDrain()
    })
    record.pendingShell = task
    void task.finally(() => {
      if (record.pendingShell === task) record.pendingShell = undefined
    }).catch(() => undefined)
    return task
  }

  private async openShell(record: SessionRecord, notice?: "reconnected" | "restored-new-shell"): Promise<TerminalSessionInfo> {
    if (!record.recoveryDesired || !record.connectionId || !this.isCurrent(record)) throw new Error("Terminal session is closed")
    const connectionId = record.connectionId
    const client = this.options.connections.getClientForConnection(connectionId)
    const generation = record.channelGeneration + 1
    const channel = await new Promise<TerminalChannel>((resolve, reject) => {
      client.shell({ term: "xterm-256color", cols: record.request.cols, rows: record.request.rows }, (error, openedChannel) => {
        if (error || !openedChannel) {
          reject(error ?? new Error("SSH shell channel was not opened"))
          return
        }
        resolve(openedChannel as unknown as TerminalChannel)
      })
    })
    if (!record.recoveryDesired || !this.isCurrent(record) || record.connectionId !== connectionId) {
      channel.end()
      throw new Error("Terminal session is closed")
    }

    record.channelGeneration = generation
    record.channel = channel
    record.output = new TerminalOutputPump(channel, record.request.sessionId, generation, (packet) => {
      if (this.isCurrent(record) && record.channelGeneration === generation) this.emit(record, { kind: "output", packet })
    })
    channel.on("data", (data) => {
      if (data && this.isCurrent(record) && record.channelGeneration === generation) record.output?.enqueue(new Uint8Array(data))
    })
    channel.on("close", () => this.handleChannelClose(record, generation, channel))
    record.state = "connected"
    this.emitState(record, "connected", undefined, notice)
    return this.info(record)
  }

  private handleChannelClose(record: SessionRecord, generation: number, channel: TerminalChannel): void {
    if (!this.isCurrent(record) || record.channelGeneration !== generation || record.channel !== channel || record.state === "closing") return
    record.recoveryDesired = false
    record.output?.close()
    record.output = undefined
    record.channel = undefined
    record.state = "disconnected"
    this.emitState(record, "disconnected", "channel-ended")
  }

  private handleConnectionEvent(event: ConnectionEvent): void {
    const affected = [...this.sessions.values()].filter((record) => record.connectionId === event.connectionId)
    if (event.kind === "lost") {
      for (const record of affected) {
        if (!record.recoveryDesired) continue
        record.output?.close()
        record.output = undefined
        record.channel = undefined
        record.state = "reconnecting"
        this.emitState(record, "reconnecting", event.reason)
      }
      return
    }
    if (event.kind === "retrying") {
      for (const record of affected) {
        if (record.recoveryDesired) this.emitState(record, "reconnecting", undefined, undefined, event.attempt, event.nextRetryAt)
      }
      return
    }
    if (event.kind === "ready") {
      for (const record of affected) {
        if (record.recoveryDesired && record.state === "reconnecting") void this.queueShell(record, "reconnected").catch(() => undefined)
      }
      return
    }
    if (event.kind === "failed") {
      for (const record of affected) {
        record.lease = undefined
        record.connectionId = undefined
        record.output?.close()
        record.output = undefined
        record.channel = undefined
        record.state = "error"
        this.emitState(record, "error", event.reason)
      }
    }
  }

  private scheduleQueueDrain(): void {
    if (this.drainingQueue || this.queueDrainScheduled) return
    this.queueDrainScheduled = true
    queueMicrotask(() => {
      this.queueDrainScheduled = false
      void this.drainQueue()
    })
  }

  private async drainQueue(): Promise<void> {
    if (this.drainingQueue) return
    this.drainingQueue = true
    try {
      while (this.shellQueue.length > 0) {
        this.shellQueue.sort((left, right) => left.priority - right.priority || left.order - right.order)
        const task = this.shellQueue.shift()!
        await task.run()
      }
    } finally {
      this.drainingQueue = false
      if (this.shellQueue.length > 0) this.scheduleQueueDrain()
    }
  }

  private async removeRecord(sessionId: string, emitClosing: boolean): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record) return
    if (emitClosing) this.emitState(record, "closing")
    this.sessions.delete(sessionId)
    if (record.lease) {
      const leaseId = record.lease.id
      record.lease = undefined
      await this.options.connections.release(leaseId)
    }
  }

  private requireSession(sessionId: string): SessionRecord {
    if (!isValidSessionId(sessionId)) throw new Error("Invalid session identifier")
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error("Terminal session not found")
    return record
  }

  private isCurrent(record: SessionRecord): boolean {
    return this.sessions.get(record.request.sessionId) === record
  }

  private info(record: SessionRecord): TerminalSessionInfo {
    return { sessionId: record.request.sessionId, hostId: record.request.hostId, channelGeneration: record.channelGeneration, state: record.state }
  }

  private emitState(
    record: SessionRecord,
    state: TerminalSessionState,
    reason?: TerminalFailureReason,
    notice?: "reconnected" | "restored-new-shell",
    attempt?: number,
    nextRetryAt?: string
  ): void {
    record.state = state
    this.emit(record, { kind: "state", sessionId: record.request.sessionId, connectionId: record.connectionId, channelGeneration: record.channelGeneration, state, reason, notice, attempt, nextRetryAt })
  }

  private emit(record: SessionRecord, event: TerminalSessionEvent): void {
    const owned = { ownerWebContentsId: record.request.ownerWebContentsId, event }
    this.options.onEvent?.(owned)
    for (const listener of this.listeners) listener(owned)
  }
}

function isValidSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isValidDimensions(cols: number, rows: number): boolean {
  return Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && cols <= 1000 && rows > 0 && rows <= 1000
}

function isValidTerminalData(data: string): boolean {
  return data.length <= 1024 * 1024 && !data.includes("\u0000")
}
