import { createServer, type Server } from "node:net"
import { randomUUID } from "node:crypto"
import type { Client } from "ssh2"
import type { ForwardingInfo, ForwardingSpec } from "./types"

export interface SshConnectionProvider {
  getClientForConnection?(connectionId: string): Client
  getClient?(sessionId: string): Client
}

interface ForwardingRecord {
  info: ForwardingInfo
  server: Server
}

export class ForwardingManager {
  private readonly records = new Map<string, ForwardingRecord>()

  public constructor(private readonly connections: SshConnectionProvider) {}

  public async start(connectionId: string, spec: ForwardingSpec): Promise<ForwardingInfo> {
    const info: ForwardingInfo = {
      ...spec,
      id: randomUUID(),
      connectionId,
      status: "starting"
    }
    const server = createServer((socket) => {
      let client: Client
      try {
        client = this.connections.getClientForConnection?.(connectionId) ?? this.connections.getClient?.(connectionId) ?? (() => { throw new Error("SSH connection provider is unavailable") })()
      } catch (error) {
        socket.destroy(error as Error)
        return
      }
      client.forwardOut(socket.remoteAddress ?? "127.0.0.1", socket.remotePort ?? 0, spec.remoteAddress, spec.remotePort, (error, stream) => {
        if (error) {
          socket.destroy(error)
          return
        }
        socket.pipe(stream).pipe(socket)
      })
    })
    this.records.set(info.id, { info, server })

    await new Promise<void>((resolve, reject) => {
      server.once("error", (error: NodeJS.ErrnoException) => {
        info.status = "error"
        info.error = error.code === "EADDRINUSE" ? "LOCAL_PORT_IN_USE" : (error.code ?? error.message)
        reject(new Error(info.error))
      })
      server.listen(spec.localPort, spec.localAddress, () => {
        const address = server.address()
        if (address && typeof address !== "string") info.localPort = address.port
        info.status = "forwarding"
        resolve()
      })
    })
    return { ...info }
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
    if (!record || record.info.status === "stopped") return
    record.info.status = "stopping"
    await new Promise<void>((resolve) => record.server.close(() => resolve()))
    record.info.status = "stopped"
  }

  public async stopForConnection(connectionId: string): Promise<void> {
    const ids = [...this.records.values()]
      .filter((record) => record.info.connectionId === connectionId && record.info.status !== "stopped")
      .map((record) => record.info.id)
    await Promise.all(ids.map((id) => this.stop(id)))
  }

  public async stopForSession(sessionId: string): Promise<void> {
    return this.stopForConnection(sessionId)
  }
}
