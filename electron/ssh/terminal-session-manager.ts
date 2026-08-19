import type { Client } from "ssh2"
import {
  ConnectionResolutionError,
  SshConnectionManager,
  type ConnectionEvent,
  type ConnectionLease
} from "./connection-manager"
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
  transportAttempt: number
  recoveryDesired: boolean
  connectionId?: string
  lease?: ConnectionLease
  channel?: TerminalChannel
  output?: TerminalOutputPump
  pendingStart?: PendingStart
}

interface PendingStart {
  attempt: number
  promise: Promise<TerminalSessionInfo>
}

interface RestoreAdmission {
  activeSessionId: string
}

interface ShellTask {
  record: SessionRecord
  priority: number
  order: number
  run(): Promise<void>
}

class TerminalStartInvalidatedError extends Error {}

export class TerminalSessionManager implements SessionCommandExecutor, ConnectionCommandExecutor {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly listeners = new Set<(event: OwnedTerminalSessionEvent) => void>()
  private readonly shellQueue: ShellTask[] = []
  private readonly restoreAdmissions = new Map<number, RestoreAdmission>()
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

  public ownerForSession(sessionId: string): number | undefined {
    return this.sessions.get(sessionId)?.request.ownerWebContentsId
  }

  public beginRestore(ownerWebContentsId: number, activeSessionId: string): void {
    if (!isValidOwnerWebContentsId(ownerWebContentsId) || !isValidSessionId(activeSessionId)) {
      throw new Error("Invalid restore admission")
    }
    this.restoreAdmissions.set(ownerWebContentsId, { activeSessionId })
  }

  public completeRestore(ownerWebContentsId: number): void {
    if (this.restoreAdmissions.delete(ownerWebContentsId)) this.scheduleQueueDrain()
  }

  public async open(request: TerminalOpenRequest): Promise<TerminalSessionInfo> {
    if (!isValidSessionId(request.sessionId)) throw new Error("Invalid session identifier")
    if (!isValidDimensions(request.cols, request.rows)) throw new Error("Invalid terminal dimensions")
    if (this.sessions.has(request.sessionId)) throw new Error("Terminal session is already open")

    const isWorkspaceRestore = request.restorePriority !== undefined
    const record: SessionRecord = {
      request: { ...request },
      state: isWorkspaceRestore ? "restoring" : "connecting",
      channelGeneration: 0,
      transportAttempt: 1,
      recoveryDesired: true
    }
    this.sessions.set(request.sessionId, record)
    this.emitState(record, record.state)
    const attempt = record.transportAttempt
    try {
      return await this.queueStart(record, isWorkspaceRestore ? "restored-new-shell" : undefined, attempt)
    } catch (error) {
      await this.handleStartFailure(record, attempt, error)
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
    if (!isReconnectableState(record.state)) throw new Error("Terminal session is not reconnectable")
    record.recoveryDesired = true
    const attempt = this.nextTransportAttempt(record)
    try {
      if (!record.lease) {
        record.state = "connecting"
        this.emitState(record, "connecting")
        await this.queueStart(record, "reconnected", attempt)
        return
      }

      try {
        this.options.connections.getClientForConnection(record.connectionId!)
      } catch {
        this.options.connections.retryNow(record.connectionId)
        record.state = "reconnecting"
        this.emitState(record, "reconnecting")
        return
      }
      await this.queueStart(record, "reconnected", attempt)
    } catch (error) {
      await this.handleStartFailure(record, attempt, error)
      throw error
    }
  }

  public cancelReconnect(sessionId: string): void {
    const record = this.sessions.get(sessionId)
    if (!record || !record.recoveryDesired || (record.state !== "connecting" && record.state !== "reconnecting" && record.state !== "restoring")) return
    record.recoveryDesired = false
    this.nextTransportAttempt(record)
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
    this.releaseRestoreAdmission(record)
  }

  public async close(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record) return
    record.recoveryDesired = false
    this.nextTransportAttempt(record)
    this.emitState(record, "closing")
    record.output?.close()
    record.output = undefined
    record.channel?.end()
    record.channel = undefined
    this.releaseRestoreAdmission(record)
    await this.removeRecord(sessionId, false)
  }

  public async releaseOwner(ownerWebContentsId: number): Promise<void> {
    const ids = [...this.sessions.entries()]
      .filter(([, record]) => record.request.ownerWebContentsId === ownerWebContentsId)
      .map(([sessionId]) => sessionId)
    await Promise.all(ids.map((sessionId) => this.close(sessionId)))
    this.restoreAdmissions.delete(ownerWebContentsId)
  }

  public retryAfterResume(): void {
    this.options.connections.retryNow()
  }

  public async exec(sessionId: string, command: string): Promise<string> {
    const record = this.requireSession(sessionId)
    if (!record.connectionId) throw new Error("SSH connection is not ready")
    return this.options.connections.execOnConnection(record.connectionId, command)
  }

  public async execOnConnection(connectionId: string, command: string): Promise<string> {
    return this.options.connections.execOnConnection(connectionId, command)
  }

  private queueStart(
    record: SessionRecord,
    notice?: "reconnected" | "restored-new-shell",
    attempt = record.transportAttempt
  ): Promise<TerminalSessionInfo> {
    if (record.pendingStart?.attempt === attempt) return record.pendingStart.promise
    const task = new Promise<TerminalSessionInfo>((resolve, reject) => {
      const priority = record.request.restorePriority === "background" ? 1 : 0
      this.shellQueue.push({
        record,
        priority,
        order: this.nextQueueOrder++,
        run: async () => {
          try {
            const info = await this.startSession(record, attempt, notice)
            resolve(info)
          } catch (error) {
            reject(error)
          }
        }
      })
      this.scheduleQueueDrain()
    })
    record.pendingStart = { attempt, promise: task }
    void task.finally(() => {
      if (record.pendingStart?.promise === task) record.pendingStart = undefined
    }).catch(() => undefined)
    return task
  }

  private async startSession(
    record: SessionRecord,
    attempt: number,
    notice?: "reconnected" | "restored-new-shell"
  ): Promise<TerminalSessionInfo> {
    this.assertCurrentAttempt(record, attempt)
    if (!record.lease) {
      const lease = await this.options.connections.acquire({
        hostId: record.request.hostId,
        ownerWebContentsId: record.request.ownerWebContentsId,
        kind: "terminal",
        forceNewConnection: record.request.forceNewConnection
      })
      if (!this.isCurrentAttempt(record, attempt)) {
        await this.options.connections.release(lease.id)
        throw this.currentAttemptError(record)
      }
      record.lease = lease
      record.connectionId = lease.connectionId
    }
    return this.openShell(record, attempt, notice)
  }

  private async openShell(
    record: SessionRecord,
    attempt: number,
    notice?: "reconnected" | "restored-new-shell"
  ): Promise<TerminalSessionInfo> {
    this.assertCurrentAttempt(record, attempt)
    if (!record.connectionId) throw new Error("SSH connection is not ready")
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
    if (!this.isCurrentAttempt(record, attempt) || record.connectionId !== connectionId) {
      channel.end()
      throw this.currentAttemptError(record)
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
        this.nextTransportAttempt(record)
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
        if (!record.recoveryDesired) continue
        if (record.state === "restoring") {
          this.emitState(record, "restoring", undefined, undefined, event.attempt, event.nextRetryAt)
        } else {
          this.emitState(record, "reconnecting", undefined, undefined, event.attempt, event.nextRetryAt)
        }
      }
      return
    }
    if (event.kind === "ready") {
      for (const record of affected) {
        if (!record.recoveryDesired || (record.state !== "reconnecting" && record.state !== "restoring")) continue
        const attempt = record.transportAttempt
        const notice = record.state === "restoring" ? "restored-new-shell" : "reconnected"
        void this.queueStart(record, notice, attempt).catch((error) => this.handleRecoveredStartFailure(record, attempt, error))
      }
      return
    }
    if (event.kind === "failed") {
      for (const record of affected) {
        record.recoveryDesired = false
        this.nextTransportAttempt(record)
        record.lease = undefined
        record.connectionId = undefined
        record.output?.close()
        record.output = undefined
        record.channel = undefined
        record.state = "error"
        this.emitState(record, "error", event.reason)
        this.releaseRestoreAdmission(record)
      }
    }
  }

  private handleRecoveredStartFailure(record: SessionRecord, attempt: number, error: unknown): void {
    void this.handleStartFailure(record, attempt, error).catch(() => undefined)
  }

  private async handleStartFailure(record: SessionRecord, attempt: number, error: unknown): Promise<void> {
    if (!this.isCurrent(record) || record.transportAttempt !== attempt || error instanceof TerminalStartInvalidatedError) return
    record.recoveryDesired = false
    record.output?.close()
    record.output = undefined
    record.channel?.end()
    record.channel = undefined
    const lease = record.lease
    record.lease = undefined
    record.connectionId = undefined
    this.emitState(record, "error", sessionFailureReason(error))
    this.releaseRestoreAdmission(record)
    if (lease) {
      try {
        await this.options.connections.release(lease.id)
      } catch {
        // A terminal error must remain visible even if transport cleanup also fails.
      }
    }
  }

  private nextTransportAttempt(record: SessionRecord): number {
    record.transportAttempt += 1
    return record.transportAttempt
  }

  private isCurrentAttempt(record: SessionRecord, attempt: number): boolean {
    return this.isCurrent(record) && record.recoveryDesired && record.transportAttempt === attempt
  }

  private assertCurrentAttempt(record: SessionRecord, attempt: number): void {
    if (!this.isCurrentAttempt(record, attempt)) throw this.currentAttemptError(record)
  }

  private currentAttemptError(record: SessionRecord): TerminalStartInvalidatedError {
    return new TerminalStartInvalidatedError(record.recoveryDesired ? "Terminal transport attempt changed" : "Terminal session is closed")
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
        const taskIndex = this.shellQueue.findIndex((task) => this.isRestoreTaskReady(task.record))
        if (taskIndex === -1) return
        const [task] = this.shellQueue.splice(taskIndex, 1)
        await task.run()
        this.releaseRestoreAdmission(task.record)
      }
    } finally {
      this.drainingQueue = false
      if (this.shellQueue.some((task) => this.isRestoreTaskReady(task.record))) this.scheduleQueueDrain()
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

  private isRestoreTaskReady(record: SessionRecord): boolean {
    if (record.request.restorePriority !== "background") return true
    const admission = this.restoreAdmissions.get(record.request.ownerWebContentsId)
    return !admission || admission.activeSessionId === record.request.sessionId
  }

  private releaseRestoreAdmission(record: SessionRecord): void {
    const admission = this.restoreAdmissions.get(record.request.ownerWebContentsId)
    if (admission?.activeSessionId !== record.request.sessionId) return
    this.restoreAdmissions.delete(record.request.ownerWebContentsId)
    this.scheduleQueueDrain()
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

function isValidOwnerWebContentsId(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function isValidDimensions(cols: number, rows: number): boolean {
  return Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && cols <= 1000 && rows > 0 && rows <= 1000
}

function isValidTerminalData(data: string): boolean {
  return data.length <= 1024 * 1024 && !data.includes("\u0000")
}

function isReconnectableState(state: TerminalSessionState): boolean {
  return state === "disconnected" || state === "reconnecting" || state === "error"
}

function sessionFailureReason(error: unknown): TerminalFailureReason {
  if (error instanceof ConnectionResolutionError) return error.reason
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  if (message.includes("host key") && message.includes("changed")) return "host-key-changed"
  if (message.includes("host key")) return "host-key-rejected"
  if (message.includes("authentication") || message.includes("auth failed")) return "authentication"
  if (message.includes("private key") || message.includes("credential") || message.includes("configuration")) return "configuration"
  if (message.includes("cancelled") || message.includes("canceled")) return "cancelled"
  if (message.includes("timeout") || message.includes("timed out")) return "timeout"
  if (message.includes("dns") || message.includes("enotfound")) return "dns"
  return "unknown"
}
