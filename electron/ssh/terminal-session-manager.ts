import type { Client } from "ssh2"
import { isRuntimeOwner, runtimeOwnerKey, sameRuntimeOwner, type RuntimeOwner } from "../runtime/owner"
import {
  ConnectionResolutionError,
  SshConnectionManager,
  type ConnectionEvent,
  type ConnectionLease
} from "./connection-manager"
import { TerminalOutputPump } from "./terminal-output-pump"
import { ConnectionFailureError } from "./types"
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
  owner: RuntimeOwner
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
  attempt: TerminalAttempt
  nextAttemptId: number
  recoveryDesired: boolean
  connectionId?: string
  lease?: ConnectionLease
  channel?: TerminalChannel
  output?: TerminalOutputPump
  pendingStart?: PendingStart
  pendingStarts: Set<PendingStart>
  recoveryWaiters: Set<RecoveryWaiter>
}

interface PendingStart {
  attemptId: number
  promise: Promise<TerminalSessionInfo>
  reject(error: Error): void
}

interface RecoveryWaiter {
  resolve(info: TerminalSessionInfo): void
  reject(error: Error): void
}

interface RestoreAdmission {
  owner: RuntimeOwner
  activeSessionId: string
}

interface ShellTask {
  record: SessionRecord
  attemptId: number
  priority: number
  order: number
  reject(error: Error): void
  run(): Promise<void>
}

interface TerminalAttempt {
  id: number
  controller: AbortController
  abortReason?: "cancelled" | "invalidated"
  expectedTransportGeneration?: number
  expectedChannelGeneration: number
}

class TerminalStartInvalidatedError extends Error {}

export class TerminalSessionManager implements SessionCommandExecutor, ConnectionCommandExecutor {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly listeners = new Set<(event: OwnedTerminalSessionEvent) => void>()
  private readonly shellQueue: ShellTask[] = []
  private readonly restoreAdmissions = new Map<string, RestoreAdmission>()
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

  public ownerForSession(sessionId: string): RuntimeOwner | undefined {
    return this.sessions.get(sessionId)?.request.owner
  }

  public beginRestore(owner: RuntimeOwner, activeSessionId: string): void {
    if (!isRuntimeOwner(owner) || !isValidSessionId(activeSessionId)) {
      throw new Error("Invalid restore admission")
    }
    this.restoreAdmissions.set(runtimeOwnerKey(owner), { owner, activeSessionId })
  }

  public completeRestore(owner: RuntimeOwner): void {
    if (this.restoreAdmissions.delete(runtimeOwnerKey(owner))) this.scheduleQueueDrain()
  }

  public async open(request: TerminalOpenRequest): Promise<TerminalSessionInfo> {
    if (!isValidSessionId(request.sessionId)) throw new Error("Invalid session identifier")
    if (!isValidDimensions(request.cols, request.rows)) throw new Error("Invalid terminal dimensions")
    if (!isRuntimeOwner(request.owner)) throw new Error("Invalid runtime owner")
    if (this.sessions.has(request.sessionId)) throw new Error("Terminal session is already open")

    const isWorkspaceRestore = request.restorePriority !== undefined
    const record: SessionRecord = {
      request: { ...request },
      state: isWorkspaceRestore ? "restoring" : "connecting",
      channelGeneration: 0,
      attempt: createTerminalAttempt(1, 1),
      nextAttemptId: 2,
      recoveryDesired: true,
      pendingStarts: new Set(),
      recoveryWaiters: new Set()
    }
    this.sessions.set(request.sessionId, record)
    this.emitState(record, record.state)
    const attempt = record.attempt
    try {
      return await this.queueStart(record, isWorkspaceRestore ? "restored-new-shell" : undefined, attempt)
    } catch (error) {
      if (error instanceof TerminalStartInvalidatedError && this.isCurrent(record) && record.recoveryDesired) {
        return this.waitForRecovery(record)
      }
      if (isTerminalCancellation(error) || !this.isCurrent(record)) throw error
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
    const attempt = this.beginAttempt(record)
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
      if (error instanceof TerminalStartInvalidatedError && this.isCurrent(record) && record.recoveryDesired) {
        await this.waitForRecovery(record)
        return
      }
      if (isTerminalCancellation(error) || !this.isCurrent(record)) throw error
      await this.handleStartFailure(record, attempt, error)
      throw error
    }
  }

  public cancelReconnect(sessionId: string): void {
    const record = this.sessions.get(sessionId)
    if (!record || !record.recoveryDesired || (record.state !== "connecting" && record.state !== "reconnecting" && record.state !== "restoring")) return
    record.recoveryDesired = false
    this.abortAttempt(record.attempt, "cancelled")
    const cancellation = terminalCancellationError()
    this.rejectPendingStart(record, cancellation)
    this.rejectRecoveryWaiters(record, cancellation)
    record.output?.close()
    record.output = undefined
    record.channel = undefined
    if (record.lease) {
      const lease = record.lease
      record.lease = undefined
      record.connectionId = undefined
      void this.options.connections.release(lease.id).catch(() => undefined)
    }
    record.state = "disconnected"
    this.emitState(record, "disconnected", "cancelled")
    this.releaseRestoreAdmission(record)
  }

  public async close(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    if (!record) return
    record.recoveryDesired = false
    this.abortAttempt(record.attempt, "cancelled")
    const closed = new Error("Terminal session is closed")
    this.rejectPendingStart(record, closed)
    this.rejectRecoveryWaiters(record, closed)
    this.emitState(record, "closing")
    record.output?.close()
    record.output = undefined
    record.channel?.end()
    record.channel = undefined
    this.releaseRestoreAdmission(record)
    await this.removeRecord(sessionId, false)
  }

  public async releaseOwner(owner: RuntimeOwner): Promise<void> {
    const ids = [...this.sessions.entries()]
      .filter(([, record]) => sameRuntimeOwner(record.request.owner, owner))
      .map(([sessionId]) => sessionId)
    await Promise.all(ids.map((sessionId) => this.close(sessionId)))
    if (this.restoreAdmissions.delete(runtimeOwnerKey(owner))) this.scheduleQueueDrain()
  }

  public async releaseWebContents(webContentsId: number): Promise<void> {
    const ids = [...this.sessions.entries()]
      .filter(([, record]) => record.request.owner.webContentsId === webContentsId)
      .map(([sessionId]) => sessionId)
    await Promise.all(ids.map((sessionId) => this.close(sessionId)))
    let removedAdmission = false
    for (const [key, admission] of this.restoreAdmissions) {
      if (admission.owner.webContentsId !== webContentsId) continue
      removedAdmission = this.restoreAdmissions.delete(key) || removedAdmission
    }
    if (removedAdmission) this.scheduleQueueDrain()
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
    attempt = record.attempt
  ): Promise<TerminalSessionInfo> {
    if (record.pendingStart?.attemptId === attempt.id) return record.pendingStart.promise
    let rejectTask = (_error: Error): void => undefined
    const task = new Promise<TerminalSessionInfo>((resolve, reject) => {
      rejectTask = reject
      const priority = record.request.restorePriority === "background" ? 1 : 0
      this.shellQueue.push({
        record,
        attemptId: attempt.id,
        priority,
        order: this.nextQueueOrder++,
        reject: rejectTask,
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
    const pendingStart = { attemptId: attempt.id, promise: task, reject: rejectTask }
    record.pendingStart = pendingStart
    record.pendingStarts.add(pendingStart)
    void task.finally(() => {
      if (record.pendingStart?.promise === task) record.pendingStart = undefined
      record.pendingStarts.delete(pendingStart)
    }).catch(() => undefined)
    return task
  }

  private async startSession(
    record: SessionRecord,
    attempt: TerminalAttempt,
    notice?: "reconnected" | "restored-new-shell"
  ): Promise<TerminalSessionInfo> {
    this.assertCurrentAttempt(record, attempt)
    if (!record.lease) {
      const lease = await this.options.connections.acquire({
        hostId: record.request.hostId,
        owner: record.request.owner,
        kind: "terminal",
        forceNewConnection: record.request.forceNewConnection,
        signal: attempt.controller.signal
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
    attempt: TerminalAttempt,
    notice?: "reconnected" | "restored-new-shell"
  ): Promise<TerminalSessionInfo> {
    this.assertCurrentAttempt(record, attempt)
    if (!record.connectionId) throw new Error("SSH connection is not ready")
    const connectionId = record.connectionId
    const client = this.options.connections.getClientForConnection(connectionId)
    const transportGeneration = this.options.connections.transportGenerationForConnection(connectionId)
    attempt.expectedTransportGeneration = transportGeneration
    const generation = attempt.expectedChannelGeneration
    const channel = await new Promise<TerminalChannel>((resolve, reject) => {
      let settled = false
      const signal = attempt.controller.signal
      let abortListener: (() => void) | undefined
      const disposeAbort = (): void => {
        if (abortListener) signal.removeEventListener("abort", abortListener)
      }
      const settleResolve = (openedChannel: TerminalChannel): void => {
        if (settled) return
        settled = true
        disposeAbort()
        resolve(openedChannel)
      }
      const settleReject = (error: Error): void => {
        if (settled) return
        settled = true
        disposeAbort()
        reject(error)
      }
      const isCurrentShell = (): boolean => {
        if (!this.isCurrentAttempt(record, attempt) || record.connectionId !== connectionId) return false
        try {
          return this.options.connections.transportGenerationForConnection(connectionId) === transportGeneration
        } catch {
          return false
        }
      }
      abortListener = (): void => {
        settleReject(attempt.abortReason === "cancelled" ? terminalCancellationError() : this.currentAttemptError(record))
      }
      signal.addEventListener("abort", abortListener, { once: true })
      if (signal.aborted) {
        abortListener()
        return
      }
      try {
        client.shell({ term: "xterm-256color", cols: record.request.cols, rows: record.request.rows }, (error, openedChannel) => {
          if (!isCurrentShell()) {
            if (openedChannel) {
              try {
                openedChannel.end()
              } catch {
                // A stale channel is already unusable; settlement must still continue.
              }
            }
            settleReject(this.currentAttemptError(record))
            return
          }
          if (error || !openedChannel) {
            settleReject(error ?? new Error("SSH shell channel was not opened"))
            return
          }
          settleResolve(openedChannel as unknown as TerminalChannel)
        })
      } catch (error) {
        settleReject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    if (!this.isCurrentAttempt(record, attempt) || record.connectionId !== connectionId || this.options.connections.transportGenerationForConnection(connectionId) !== transportGeneration) {
      try {
        channel.end()
      } catch {
        // A stale channel is already unusable; settlement must still continue.
      }
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
    this.resolveRecoveryWaiters(record)
    return this.info(record)
  }

  private handleChannelClose(record: SessionRecord, generation: number, channel: TerminalChannel): void {
    if (!this.isCurrent(record) || record.channelGeneration !== generation || record.channel !== channel || record.state === "closing") return
    record.recoveryDesired = false
    record.output?.close()
    record.output = undefined
    record.channel = undefined
    const lease = record.lease
    record.lease = undefined
    record.connectionId = undefined
    record.state = "disconnected"
    this.emitState(record, "disconnected", "channel-ended")
    if (lease) void this.options.connections.release(lease.id).catch(() => undefined)
  }

  private handleConnectionEvent(event: ConnectionEvent): void {
    const affected = [...this.sessions.values()].filter((record) =>
      record.connectionId === event.connectionId && sameRuntimeOwner(record.request.owner, event.owner)
    )
    if (event.kind === "lost") {
      for (const record of affected) {
        if (!record.recoveryDesired) continue
        this.beginAttempt(record)
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
        const attempt = record.attempt
        attempt.expectedTransportGeneration = event.transportGeneration
        const notice = record.state === "restoring" ? "restored-new-shell" : "reconnected"
        void this.queueStart(record, notice, attempt).catch((error) => this.handleRecoveredStartFailure(record, attempt, error))
      }
      return
    }
    if (event.kind === "failed") {
      for (const record of affected) {
        record.recoveryDesired = false
        this.abortAttempt(record.attempt, "invalidated")
        record.lease = undefined
        record.connectionId = undefined
        record.output?.close()
        record.output = undefined
        record.channel = undefined
        record.state = "error"
        this.emitState(record, "error", event.reason)
        this.rejectRecoveryWaiters(record, new Error(`SSH connection failed: ${event.reason}`))
        this.releaseRestoreAdmission(record)
      }
    }
  }

  private handleRecoveredStartFailure(record: SessionRecord, attempt: TerminalAttempt, error: unknown): void {
    void this.handleStartFailure(record, attempt, error).catch(() => undefined)
  }

  private async handleStartFailure(record: SessionRecord, attempt: TerminalAttempt, error: unknown): Promise<void> {
    if (!this.isCurrent(record) || record.attempt !== attempt || error instanceof TerminalStartInvalidatedError || isTerminalCancellation(error)) return
    record.recoveryDesired = false
    this.abortAttempt(attempt, "invalidated")
    record.output?.close()
    record.output = undefined
    record.channel?.end()
    record.channel = undefined
    const lease = record.lease
    record.lease = undefined
    record.connectionId = undefined
    this.emitState(record, "error", sessionFailureReason(error))
    this.rejectRecoveryWaiters(record, error instanceof Error ? error : new Error("Terminal session failed"))
    this.releaseRestoreAdmission(record)
    if (lease) {
      try {
        await this.options.connections.release(lease.id)
      } catch {
        // A terminal error must remain visible even if transport cleanup also fails.
      }
    }
  }

  private beginAttempt(record: SessionRecord): TerminalAttempt {
    this.abortAttempt(record.attempt, "invalidated")
    const attempt = createTerminalAttempt(record.nextAttemptId, record.channelGeneration + 1)
    record.nextAttemptId += 1
    record.attempt = attempt
    return attempt
  }

  private abortAttempt(attempt: TerminalAttempt, reason: "cancelled" | "invalidated"): void {
    attempt.abortReason = reason
    attempt.controller.abort()
  }

  private isCurrentAttempt(record: SessionRecord, attempt: TerminalAttempt): boolean {
    return this.isCurrent(record) && record.recoveryDesired && record.attempt === attempt && !attempt.controller.signal.aborted
  }

  private isCurrentAttemptId(record: SessionRecord, attemptId: number): boolean {
    return this.isCurrent(record) && record.recoveryDesired && record.attempt.id === attemptId && !record.attempt.controller.signal.aborted
  }

  private assertCurrentAttempt(record: SessionRecord, attempt: TerminalAttempt): void {
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
        if (this.isCurrentAttemptId(task.record, task.attemptId)) await task.run()
        else task.reject(this.currentAttemptError(task.record))
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
    this.rejectRecoveryWaiters(record, new Error("Terminal session was closed"))
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
    const admission = this.restoreAdmissions.get(runtimeOwnerKey(record.request.owner))
    return !admission || admission.activeSessionId === record.request.sessionId
  }

  private releaseRestoreAdmission(record: SessionRecord): void {
    const admission = this.restoreAdmissions.get(runtimeOwnerKey(record.request.owner))
    if (admission?.activeSessionId !== record.request.sessionId) return
    this.restoreAdmissions.delete(runtimeOwnerKey(record.request.owner))
    this.scheduleQueueDrain()
  }

  private info(record: SessionRecord): TerminalSessionInfo {
    return { sessionId: record.request.sessionId, hostId: record.request.hostId, channelGeneration: record.channelGeneration, state: record.state }
  }

  private waitForRecovery(record: SessionRecord): Promise<TerminalSessionInfo> {
    if (record.state === "connected" && record.channel) return Promise.resolve(this.info(record))
    return new Promise<TerminalSessionInfo>((resolve, reject) => {
      record.recoveryWaiters.add({ resolve, reject })
    })
  }

  private resolveRecoveryWaiters(record: SessionRecord): void {
    const info = this.info(record)
    for (const waiter of record.recoveryWaiters) waiter.resolve(info)
    record.recoveryWaiters.clear()
  }

  private rejectRecoveryWaiters(record: SessionRecord, error: Error): void {
    for (const waiter of record.recoveryWaiters) waiter.reject(error)
    record.recoveryWaiters.clear()
  }

  private rejectPendingStart(record: SessionRecord, error: Error): void {
    for (const pendingStart of record.pendingStarts) pendingStart.reject(error)
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
    const owned = { owner: record.request.owner, event }
    this.options.onEvent?.(owned)
    for (const listener of this.listeners) listener(owned)
  }
}

function isValidSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function createTerminalAttempt(id: number, expectedChannelGeneration: number): TerminalAttempt {
  return { id, controller: new AbortController(), expectedChannelGeneration }
}

function terminalCancellationError(): ConnectionFailureError {
  return new ConnectionFailureError("Terminal connection was cancelled", "cancelled")
}

function isTerminalCancellation(error: unknown): boolean {
  return error instanceof ConnectionFailureError && error.reason === "cancelled"
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
  const typedReason = error && typeof error === "object" && "reason" in error
    ? (error as { reason?: unknown }).reason
    : undefined
  if (isTerminalFailureReason(typedReason)) return typedReason
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

function isTerminalFailureReason(value: unknown): value is TerminalFailureReason {
  return value === "network" || value === "timeout" || value === "dns" || value === "authentication" ||
    value === "host-key-changed" || value === "host-key-rejected" || value === "configuration" ||
    value === "channel-ended" || value === "local-port-in-use" || value === "cancelled" || value === "unknown"
}
