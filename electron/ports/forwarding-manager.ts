import { randomUUID } from "node:crypto"
import { createServer, type Socket } from "node:net"
import type {
  ConnectionCommandExecutor,
  ConnectionEvent,
  ConnectionLease,
  ConnectionLeaseController
} from "../ssh/connection-manager"
import type { TerminalFailureReason } from "../ssh/types"
import type { ForwardingInfo, ForwardingSpec } from "./types"

export interface LocalListener {
  once(event: "error", listener: (error: NodeJS.ErrnoException) => void): void
  listen(port: number, host: string, callback: () => void): void
  close(callback: (error?: Error) => void): void
  address(): string | { port: number } | null
}

export type LocalListenerFactory = (onConnection: (socket: Socket) => void) => LocalListener

export interface ForwardingConnectionAccess extends ConnectionLeaseController, ConnectionCommandExecutor {
  onEvent(listener: (event: ConnectionEvent) => void): () => void
}

export interface ForwardingManagerOptions {
  createListener?: LocalListenerFactory
  onEvent?: (event: ForwardingEvent) => void
}

export type ForwardingEvent = {
  kind: "started" | "resumed" | "suspended" | "stopped" | "error"
  connectionId: string
  ownerWebContentsId: number
  reason?: TerminalFailureReason
}

interface ForwardingRecord {
  info: ForwardingInfo
  ownerWebContentsId: number
  lease?: ConnectionLease
  listener?: LocalListener
  listenerClose?: Promise<void>
  activationGeneration: number
  activation?: {
    generation: number
    promise: Promise<void>
  }
  stopPromise?: Promise<void>
}

export class ForwardingManager {
  private readonly records = new Map<string, ForwardingRecord>()
  private readonly createListener: LocalListenerFactory
  private readonly onEvent?: (event: ForwardingEvent) => void

  public constructor(private readonly connections: ForwardingConnectionAccess, options: ForwardingManagerOptions = {}) {
    this.createListener = options.createListener ?? defaultListenerFactory
    this.onEvent = options.onEvent
    this.connections.onEvent((event) => this.handleConnectionEvent(event))
  }

  public async start(connectionId: string, spec: ForwardingSpec, ownerWebContentsId: number): Promise<ForwardingInfo> {
    const info: ForwardingInfo = {
      ...spec,
      id: randomUUID(),
      connectionId,
      status: "starting"
    }
    const lease = this.connections.retain(connectionId, ownerWebContentsId, "forward")
    const record: ForwardingRecord = { info, ownerWebContentsId, lease, activationGeneration: 0 }
    this.records.set(info.id, record)
    try {
      await this.scheduleActivation(record)
      this.emit({ kind: "started", connectionId, ownerWebContentsId })
      return this.copyInfo(record)
    } catch (error) {
      await this.releaseLease(record)
      throw error
    }
  }

  public async resume(forwardingId: string): Promise<ForwardingInfo> {
    const record = this.records.get(forwardingId)
    if (!record) throw new Error("Port forwarding was not found")
    if (record.info.status !== "suspended" || !record.lease) throw new Error("Port forwarding is not suspended")
    await this.scheduleActivation(record)
    this.emit({ kind: "resumed", connectionId: record.info.connectionId, ownerWebContentsId: record.ownerWebContentsId })
    return this.copyInfo(record)
  }

  public get(id: string): ForwardingInfo | undefined {
    const record = this.records.get(id)
    return record ? { ...record.info } : undefined
  }

  public ownerForForwarding(id: string): number | undefined {
    const record = this.records.get(id)
    return record && record.info.status !== "stopped" ? record.ownerWebContentsId : undefined
  }

  public list(): ForwardingInfo[] {
    return [...this.records.values()].map((record) => ({ ...record.info }))
  }

  public async stop(id: string): Promise<void> {
    const record = this.records.get(id)
    if (!record) return
    if (record.stopPromise) return record.stopPromise
    record.stopPromise = this.stopRecord(record)
    return record.stopPromise
  }

  public async releaseOwner(ownerWebContentsId: number): Promise<void> {
    const ids = [...this.records.values()]
      .filter((record) => record.ownerWebContentsId === ownerWebContentsId)
      .map((record) => record.info.id)
    await Promise.all(ids.map((id) => this.stop(id)))
  }

  private async stopRecord(record: ForwardingRecord): Promise<void> {
    if (record.info.status === "stopped") {
      await this.releaseLease(record)
      return
    }
    this.invalidateActivation(record)
    record.info.status = "stopping"
    await this.closeCurrentListener(record)
    record.info.status = "stopped"
    delete record.info.error
    this.emit({ kind: "stopped", connectionId: record.info.connectionId, ownerWebContentsId: record.ownerWebContentsId })
    await this.releaseLease(record)
  }

  private scheduleActivation(record: ForwardingRecord): Promise<void> {
    const generation = record.activationGeneration
    if (record.activation?.generation === generation) return record.activation.promise

    const previous = record.activation?.promise ?? Promise.resolve()
    const activation = {
      generation,
      promise: previous.catch(() => undefined).then(() => this.activate(record, generation))
    }
    record.activation = activation
    void activation.promise.finally(() => {
      if (record.activation === activation) record.activation = undefined
    }).catch(() => undefined)
    return activation.promise
  }

  private async activate(record: ForwardingRecord, generation: number): Promise<void> {
    await record.listenerClose
    if (!this.isActivationCurrent(record, generation)) return

    let listener: LocalListener | undefined
    try {
      listener = this.createListener((socket) => this.forwardSocket(record, listener, socket))
      record.listener = listener
      record.info.status = "starting"
      const localPort = await listen(listener, record.info)
      if (!this.isActivationCurrent(record, generation, listener)) {
        await closeListener(listener)
        return
      }
      record.info.localPort = localPort
      record.info.status = "forwarding"
      delete record.info.error
    } catch (error) {
      if (!this.isActivationCurrent(record, generation, listener)) {
        if (listener) await closeListener(listener)
        return
      }
      if (listener) {
        record.listener = undefined
        await closeListener(listener)
      }
      this.setListenerFailure(record, error)
      this.emit({ kind: "error", connectionId: record.info.connectionId, ownerWebContentsId: record.ownerWebContentsId, reason: forwardingFailureReason(error) })
      await this.releaseLease(record)
      throw new Error(record.info.error)
    }
  }

  private forwardSocket(record: ForwardingRecord, listener: LocalListener | undefined, socket: Socket): void {
    if (record.listener !== listener || record.info.status !== "forwarding") {
      socket.destroy()
      return
    }
    let client
    try {
      client = this.connections.getClientForConnection(record.info.connectionId)
    } catch (error) {
      socket.destroy(error instanceof Error ? error : undefined)
      return
    }
    client.forwardOut(
      socket.remoteAddress ?? "127.0.0.1",
      socket.remotePort ?? 0,
      record.info.remoteAddress,
      record.info.remotePort,
      (error, stream) => {
        if (error || !stream) {
          socket.destroy(error ?? new Error("SSH forwarding channel was not opened"))
          return
        }
        socket.pipe(stream).pipe(socket)
      }
    )
  }

  private handleConnectionEvent(event: ConnectionEvent): void {
    const affected = [...this.records.values()].filter((record) =>
      record.info.connectionId === event.connectionId && record.ownerWebContentsId === event.ownerWebContentsId
    )
    if (event.kind === "lost") {
      for (const record of affected) this.suspend(record, event.reason)
      return
    }
    if (event.kind === "ready") {
      for (const record of affected) {
        if (record.info.status === "suspended" && isLoopback(record.info.localAddress)) {
          void this.scheduleActivation(record).then(() => {
            if (record.info.status === "forwarding") {
              this.emit({ kind: "resumed", connectionId: record.info.connectionId, ownerWebContentsId: record.ownerWebContentsId })
            }
          }).catch(() => undefined)
        }
      }
      return
    }
    if (event.kind === "failed") {
      for (const record of affected) this.fail(record, event.reason)
    }
  }

  private suspend(record: ForwardingRecord, reason: TerminalFailureReason = "network"): void {
    if (!record.lease || record.info.status === "stopped" || record.info.status === "stopping" || record.info.status === "error") return
    this.invalidateActivation(record)
    record.info.status = "suspended"
    delete record.info.error
    this.emit({ kind: "suspended", connectionId: record.info.connectionId, ownerWebContentsId: record.ownerWebContentsId, reason })
    void this.closeCurrentListener(record)
  }

  private fail(record: ForwardingRecord, reason: string): void {
    if (!record.lease || record.info.status === "stopped" || record.info.status === "stopping" || record.info.status === "error") return
    this.invalidateActivation(record)
    record.info.status = "error"
    record.info.error = reason
    this.emit({ kind: "error", connectionId: record.info.connectionId, ownerWebContentsId: record.ownerWebContentsId, reason: forwardingFailureReason(reason) })
    void this.closeCurrentListener(record)
    void this.releaseLease(record).catch(() => undefined)
  }

  private invalidateActivation(record: ForwardingRecord): void {
    record.activationGeneration += 1
  }

  private isActivationCurrent(record: ForwardingRecord, generation: number, listener?: LocalListener): boolean {
    if (
      record.activationGeneration !== generation ||
      !record.lease ||
      (record.info.status !== "starting" && record.info.status !== "suspended")
    ) return false
    return !listener || record.listener === listener
  }

  private closeCurrentListener(record: ForwardingRecord): Promise<void> {
    const listener = record.listener
    if (!listener) return record.listenerClose ?? Promise.resolve()
    record.listener = undefined
    const closing = closeListener(listener)
    record.listenerClose = closing
    void closing.finally(() => {
      if (record.listenerClose === closing) record.listenerClose = undefined
    }).catch(() => undefined)
    return closing
  }

  private async releaseLease(record: ForwardingRecord): Promise<void> {
    if (!record.lease) return
    const lease = record.lease
    record.lease = undefined
    await this.connections.release(lease.id)
  }

  private setListenerFailure(record: ForwardingRecord, error: unknown): void {
    record.info.status = "error"
    const errno = error as NodeJS.ErrnoException
    record.info.error = errno?.code === "EADDRINUSE" ? "LOCAL_PORT_IN_USE" : (errno?.code ?? messageFor(error))
  }

  private copyInfo(record: ForwardingRecord): ForwardingInfo {
    return { ...record.info }
  }

  private emit(event: ForwardingEvent): void {
    try {
      this.onEvent?.(event)
    } catch {
      // Diagnostics must never change forwarding behavior.
    }
  }
}

const defaultListenerFactory: LocalListenerFactory = (onConnection) => {
  const server = createServer(onConnection)
  return {
    once: (event, listener) => { server.once(event, listener) },
    listen: (port, host, callback) => { server.listen(port, host, callback) },
    close: (callback) => { server.close(callback) },
    address: () => server.address()
  }
}

function listen(listener: LocalListener, spec: ForwardingSpec): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let settled = false
    const fail = (error: NodeJS.ErrnoException): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    listener.once("error", fail)
    try {
      listener.listen(spec.localPort, spec.localAddress, () => {
        if (settled) return
        settled = true
        const address = listener.address()
        resolve(address && typeof address !== "string" ? address.port : spec.localPort)
      })
    } catch (error) {
      fail(error as NodeJS.ErrnoException)
    }
  })
}

function closeListener(listener: LocalListener): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      listener.close(() => resolve())
    } catch {
      resolve()
    }
  })
}

function isLoopback(address: string): boolean {
  return address === "127.0.0.1" || address === "::1"
}

function messageFor(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "LOCAL_LISTENER_FAILED"
}

function forwardingFailureReason(error: unknown): TerminalFailureReason {
  if (error === "network" || error === "timeout" || error === "dns" || error === "authentication" ||
    error === "host-key-changed" || error === "host-key-rejected" || error === "configuration" ||
    error === "channel-ended" || error === "local-port-in-use" || error === "cancelled" || error === "unknown") {
    return error
  }
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code).toUpperCase()
    : ""
  return code === "EADDRINUSE" || error === "LOCAL_PORT_IN_USE" ? "local-port-in-use" : "unknown"
}
