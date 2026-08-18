import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Client, type ClientChannel, type ConnectConfig } from "ssh2"
import type { AuthMethod } from "../storage/types"
import { isValidSessionId, validateDimensions, validateTerminalData } from "../ipc/validation"
import { normalizeFingerprint, type HostKeyStore, type UnknownHostKeyApproval, verifyHostFingerprint } from "./host-keys"

export interface SessionRequest {
  hostId: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  identityFile?: string
  password?: string
  passphrase?: string
  agent?: string
  cols: number
  rows: number
}

export interface SessionOpenOptions {
  windowId?: number
  forceNewConnection?: boolean
}

export interface SessionInfo {
  sessionId: string
  connectionId: string
  hostId: string
  state: "connected"
}

export type SessionEvent =
  | { kind: "data"; sessionId: string; connectionId: string; data: string }
  | { kind: "state"; sessionId: string; connectionId: string; state: "connecting" | "connected" | "closed" }
  | { kind: "host-key"; sessionId: string; connectionId: string; fingerprint: string }
  | { kind: "error"; sessionId: string; connectionId: string; message: string }

interface SessionRecord {
  request: SessionRequest
  sessionId: string
  connectionId: string
  channel?: ClientChannel
  closing: boolean
}

interface ConnectionRecord {
  request: SessionRequest
  connectionId: string
  client: Client
  windowId?: number
  securityKey: string
  fingerprint?: string
  sessions: Set<string>
  closing: boolean
}

export interface SshManagerOptions {
  hostKeys: HostKeyStore
  onUnknownHostKey?: UnknownHostKeyApproval
}

export class SshManager {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly connections = new Map<string, ConnectionRecord>()
  private readonly listeners = new Set<(event: SessionEvent) => void>()

  public constructor(private readonly options: SshManagerOptions) {}

  public onEvent(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public async open(request: SessionRequest, options: SessionOpenOptions = {}): Promise<SessionInfo> {
    if (!validateDimensions(request.cols, request.rows)) {
      throw new Error("Invalid terminal dimensions")
    }
    const securityKey = createSecurityKey(request)
    if (!options.forceNewConnection) {
      const reusable = [...this.connections.values()].find((connection) =>
        connection.windowId === options.windowId &&
        connection.securityKey === securityKey &&
        connection.fingerprint !== undefined &&
        !connection.closing
      )
      if (reusable) return this.openChannel(reusable, request)
    }

    const connectionId = randomUUID()
    const client = new Client()
    const connection: ConnectionRecord = {
      request,
      connectionId,
      client,
      windowId: options.windowId,
      securityKey,
      sessions: new Set(),
      closing: false
    }
    this.connections.set(connectionId, connection)
    const sessionId = randomUUID()
    const session: SessionRecord = { request, sessionId, connectionId, closing: false }
    this.sessions.set(sessionId, session)
    connection.sessions.add(sessionId)
    this.emit({ kind: "state", sessionId, connectionId, state: "connecting" })

    return new Promise<SessionInfo>((resolve, reject) => {
      let settled = false
      const fail = (error: Error): void => {
        this.emit({ kind: "error", sessionId, connectionId, message: error.message })
        this.removeSession(sessionId)
        if (!settled) {
          settled = true
          reject(error)
        }
      }

      client.once("error", (error) => fail(error))
      client.once("close", () => {
        connection.closing = true
        for (const childId of [...connection.sessions]) {
          const child = this.sessions.get(childId)
          if (child) {
            child.channel = undefined
            this.emit({ kind: "state", sessionId: childId, connectionId, state: "closed" })
            this.sessions.delete(childId)
          }
        }
        connection.sessions.clear()
        this.connections.delete(connectionId)
        if (!settled) fail(new Error("SSH connection closed before the session was ready"))
      })
      client.once("ready", () => {
        void this.openChannel(connection, request, sessionId).then((info) => {
          settled = true
          resolve(info)
        }).catch((error: Error) => fail(error))
      })

      const config: ConnectConfig = {
        host: request.host,
        port: request.port,
        username: request.username,
        readyTimeout: 15_000,
        hostHash: "sha256",
        hostVerifier: (fingerprint: string, verify: (valid: boolean) => void): boolean => {
          void this.verifyHostKey(sessionId, connection, fingerprint).then((accepted) => verify(accepted)).catch(() => verify(false))
          return true
        }
      }
      if (request.authMethod === "password") {
        config.password = request.password
      } else if (request.authMethod === "privateKey") {
        if (!request.identityFile) {
          fail(new Error("Private key path is missing"))
          return
        }
        void readFile(request.identityFile).then((privateKey) => {
          config.privateKey = privateKey
          config.passphrase = request.passphrase
          client.connect(config)
        }).catch((error: Error) => fail(error))
        return
      } else {
        config.agent = request.agent ?? process.env.SSH_AUTH_SOCK ?? (process.platform === "win32" ? "pageant" : undefined)
      }
      client.connect(config)
    })
  }

  public write(sessionId: string, data: string): void {
    const record = this.getSession(sessionId)
    if (!validateTerminalData(data)) throw new Error("Terminal input is too large")
    record.channel?.write(data)
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    const record = this.getSession(sessionId)
    if (!validateDimensions(cols, rows)) throw new Error("Invalid terminal dimensions")
    record.channel?.setWindow(rows, cols, 0, 0)
  }

  public async exec(sessionId: string, command: string): Promise<string> {
    const record = this.getSession(sessionId)
    return this.execOnConnection(record.connectionId, command)
  }

  public async execOnConnection(connectionId: string, command: string): Promise<string> {
    const record = this.getConnection(connectionId)
    if (!command || command.includes("\u0000") || command.length > 4096) throw new Error("Invalid remote command")
    return new Promise<string>((resolve, reject) => {
      record.client.exec(command, (error, channel) => {
        if (error) {
          reject(error)
          return
        }
        const chunks: Buffer[] = []
        channel.on("data", (data: Buffer) => chunks.push(data))
        channel.stderr.on("data", (data: Buffer) => chunks.push(data))
        channel.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")))
      })
    })
  }

  public async close(sessionId: string): Promise<void> {
    const record = this.getSession(sessionId)
    record.closing = true
    record.channel?.end()
    this.removeSession(sessionId)
    const connection = this.connections.get(record.connectionId)
    if (connection && connection.sessions.size === 0) {
      connection.closing = true
      connection.client.end()
      this.connections.delete(connection.connectionId)
    }
    this.emit({ kind: "state", sessionId, connectionId: record.connectionId, state: "closed" })
  }

  public async reconnect(sessionId: string): Promise<SessionInfo> {
    const record = this.getSession(sessionId)
    const request = { ...record.request }
    const connection = this.getConnection(record.connectionId)
    const windowId = connection.windowId
    await this.close(sessionId)
    return this.open(request, { windowId })
  }

  public getClient(sessionId: string): Client {
    return this.getClientForConnection(this.getSession(sessionId).connectionId)
  }

  public getClientForConnection(connectionId: string): Client {
    return this.getConnection(connectionId).client
  }

  public getConnectionId(sessionId: string): string {
    return this.getSession(sessionId).connectionId
  }

  public hasSessionsForConnection(connectionId: string): boolean {
    return (this.connections.get(connectionId)?.sessions.size ?? 0) > 0
  }

  private async openChannel(connection: ConnectionRecord, request: SessionRequest, existingSessionId?: string): Promise<SessionInfo> {
    const sessionId = existingSessionId ?? randomUUID()
    const session = this.sessions.get(sessionId) ?? { request, sessionId, connectionId: connection.connectionId, closing: false }
    this.sessions.set(sessionId, session)
    connection.sessions.add(sessionId)
    return new Promise<SessionInfo>((resolve, reject) => {
      connection.client.shell({ term: "xterm-256color", cols: request.cols, rows: request.rows }, (error, channel) => {
        if (error) {
          this.removeSession(sessionId)
          reject(error)
          return
        }
        session.channel = channel
        channel.on("data", (data: Buffer) => this.emit({ kind: "data", sessionId, connectionId: connection.connectionId, data: data.toString("utf8") }))
        channel.on("close", () => {
          if (!session.closing) {
            session.closing = true
            this.removeSession(sessionId)
            this.emit({ kind: "state", sessionId, connectionId: connection.connectionId, state: "closed" })
            if (connection.sessions.size === 0) {
              connection.closing = true
              connection.client.end()
              this.connections.delete(connection.connectionId)
            }
          }
        })
        this.emit({ kind: "state", sessionId, connectionId: connection.connectionId, state: "connected" })
        resolve({ sessionId, connectionId: connection.connectionId, hostId: request.hostId, state: "connected" })
      })
    })
  }

  private async verifyHostKey(sessionId: string, connection: ConnectionRecord, fingerprint: string): Promise<boolean> {
    const normalized = normalizeFingerprint(fingerprint)
    this.emit({ kind: "host-key", sessionId, connectionId: connection.connectionId, fingerprint: normalized })
    const expected = await this.options.hostKeys.get(connection.request.host, connection.request.port)
    const approve = this.options.onUnknownHostKey ?? (async () => false)
    const accepted = await verifyHostFingerprint(normalized, expected, async () => approve({ host: connection.request.host, port: connection.request.port, fingerprint: normalized }))
    if (accepted && expected === undefined) await this.options.hostKeys.trust(connection.request.host, connection.request.port, normalized)
    if (accepted) connection.fingerprint = normalized
    return accepted
  }

  private removeSession(sessionId: string): void {
    const record = this.sessions.get(sessionId)
    if (!record) return
    this.sessions.delete(sessionId)
    this.connections.get(record.connectionId)?.sessions.delete(sessionId)
  }

  private getSession(sessionId: string): SessionRecord {
    if (!isValidSessionId(sessionId)) throw new Error("Invalid session identifier")
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error("SSH session not found")
    return record
  }

  private getConnection(connectionId: string): ConnectionRecord {
    const record = this.connections.get(connectionId)
    if (!record) throw new Error("SSH connection not found")
    return record
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

function createSecurityKey(request: SessionRequest): string {
  return createHash("sha256").update(JSON.stringify({
    hostId: request.hostId,
    host: request.host,
    port: request.port,
    username: request.username,
    authMethod: request.authMethod,
    identityFile: request.identityFile,
    password: request.password,
    passphrase: request.passphrase,
    agent: request.agent
  })).digest("hex")
}
