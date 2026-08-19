import { randomUUID } from "node:crypto"
import { createServer, type Socket } from "node:net"
import type {
  ConnectionCommandExecutor,
  ConnectionEvent,
  ConnectionLease,
  ConnectionLeaseController
} from "../ssh/connection-manager"
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
}

interface ForwardingRecord {
  info: ForwardingInfo
  ownerWebContentsId: number
  lease?: ConnectionLease
  listener?: LocalListener
  listenerClose?: Promise<void>
  activation?: Promise<void>
  stopPromise?: Promise<void>
}

export class ForwardingManager {
  private readonly records = new Map<string, ForwardingRecord>()
  private readonly createListener: LocalListenerFactory

  public constructor(private readonly connections: ForwardingConnectionAccess, options: ForwardingManagerOptions = {}) {
    this.createListener = options.createListener ?? defaultListenerFactory
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
    const record: ForwardingRecord = { info, ownerWebContentsId, lease }
    this.records.set(info.id, record)
    try {
      await this.scheduleActivation(record)
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
    return this.copyInfo(record)
  }

  public get(id: string): ForwardingInfo | undefined {
    const record = this.records.get(id)
    return record ? { ...record.info } : undefined
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
    record.info.status = "stopping"
    await this.closeCurrentListener(record)
    record.info.status = "stopped"
    delete record.info.error
    await this.releaseLease(record)
  }

  private scheduleActivation(record: ForwardingRecord): Promise<void> {
    const previous = record.activation ?? Promise.resolve()
    const activation = previous.catch(() => undefined).then(() => this.activate(record))
    record.activation = activation
    void activation.finally(() => {
      if (record.activation === activation) record.activation = undefined
    }).catch(() => undefined)
    return activation
  }

  private async activate(record: ForwardingRecord): Promise<void> {
    await record.listenerClose
    if (!record.lease || record.info.status === "stopped" || record.info.status === "stopping" || record.info.status === "error") return

    let listener: LocalListener | undefined
    try {
      listener = this.createListener((socket) => this.forwardSocket(record, listener, socket))
      record.listener = listener
      record.info.status = "starting"
      const localPort = await listen(listener, record.info)
      if (record.listener !== listener || record.info.status !== "starting") {
        await closeListener(listener)
        return
      }
      record.info.localPort = localPort
      record.info.status = "forwarding"
      delete record.info.error
    } catch (error) {
      if (listener && record.listener !== listener) {
        await closeListener(listener)
        return
      }
      if (listener) {
        record.listener = undefined
        await closeListener(listener)
      }
      this.setListenerFailure(record, error)
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
      for (const record of affected) this.suspend(record)
      return
    }
    if (event.kind === "ready") {
      for (const record of affected) {
        if (record.info.status === "suspended" && isLoopback(record.info.localAddress)) {
          void this.scheduleActivation(record).catch(() => undefined)
        }
      }
    }
  }

  private suspend(record: ForwardingRecord): void {
    if (!record.lease || record.info.status === "stopped" || record.info.status === "stopping" || record.info.status === "error") return
    record.info.status = "suspended"
    delete record.info.error
    void this.closeCurrentListener(record)
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
