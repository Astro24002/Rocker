import { readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
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

export interface SessionInfo {
  sessionId: string
  hostId: string
  state: "connected"
}

export type SessionEvent =
  | { kind: "data"; sessionId: string; data: string }
  | { kind: "state"; sessionId: string; state: "connecting" | "connected" | "closed" }
  | { kind: "host-key"; sessionId: string; fingerprint: string }
  | { kind: "error"; sessionId: string; message: string }

interface SessionRecord {
  request: SessionRequest
  client: Client
  channel?: ClientChannel
  closing: boolean
}

export interface SshManagerOptions {
  hostKeys: HostKeyStore
  onUnknownHostKey?: UnknownHostKeyApproval
}

export class SshManager {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly listeners = new Set<(event: SessionEvent) => void>()

  public constructor(private readonly options: SshManagerOptions) {}

  public onEvent(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public async open(request: SessionRequest): Promise<SessionInfo> {
    if (!validateDimensions(request.cols, request.rows)) {
      throw new Error("Invalid terminal dimensions")
    }
    const sessionId = randomUUID()
    const client = new Client()
    const record: SessionRecord = { request, client, closing: false }
    this.sessions.set(sessionId, record)
    this.emit({ kind: "state", sessionId, state: "connecting" })

    return new Promise<SessionInfo>((resolve, reject) => {
      let settled = false
      const fail = (error: Error): void => {
        this.emit({ kind: "error", sessionId, message: error.message })
        if (!settled) {
          settled = true
          this.sessions.delete(sessionId)
          reject(error)
        }
      }

      client.once("error", (error) => fail(error))
      client.once("close", () => {
        record.channel = undefined
        this.emit({ kind: "state", sessionId, state: "closed" })
        this.sessions.delete(sessionId)
        if (!settled) {
          fail(new Error("SSH connection closed before the session was ready"))
        }
      })
      client.once("ready", () => {
        client.shell({ term: "xterm-256color", cols: request.cols, rows: request.rows }, (error, channel) => {
          if (error) {
            fail(error)
            return
          }
          record.channel = channel
          channel.on("data", (data: Buffer) => {
            this.emit({ kind: "data", sessionId, data: data.toString("utf8") })
          })
          channel.on("close", () => {
            if (!record.closing) client.end()
          })
          settled = true
          this.emit({ kind: "state", sessionId, state: "connected" })
          resolve({ sessionId, hostId: request.hostId, state: "connected" })
        })
      })

      const config: ConnectConfig = {
        host: request.host,
        port: request.port,
        username: request.username,
        readyTimeout: 15_000,
        hostHash: "sha256",
        hostVerifier: (fingerprint: string, verify: (valid: boolean) => void): boolean => {
          void this.verifyHostKey(sessionId, request, fingerprint).then((accepted) => verify(accepted)).catch(() => verify(false))
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
    const record = this.getRecord(sessionId)
    if (!validateTerminalData(data)) throw new Error("Terminal input is too large")
    record.channel?.write(data)
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    const record = this.getRecord(sessionId)
    if (!validateDimensions(cols, rows)) throw new Error("Invalid terminal dimensions")
    record.channel?.setWindow(rows, cols, 0, 0)
  }

  public async exec(sessionId: string, command: string): Promise<string> {
    const record = this.getRecord(sessionId)
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
    const record = this.getRecord(sessionId)
    record.closing = true
    record.channel?.end()
    record.client.end()
  }

  public async reconnect(sessionId: string): Promise<SessionInfo> {
    const record = this.getRecord(sessionId)
    const request = { ...record.request }
    await this.close(sessionId)
    return this.open(request)
  }

  public getClient(sessionId: string): Client {
    return this.getRecord(sessionId).client
  }

  private async verifyHostKey(sessionId: string, request: SessionRequest, fingerprint: string): Promise<boolean> {
    const normalized = normalizeFingerprint(fingerprint)
    this.emit({ kind: "host-key", sessionId, fingerprint: normalized })
    const expected = await this.options.hostKeys.get(request.host, request.port)
    const approve = this.options.onUnknownHostKey ?? (async () => false)
    const accepted = await verifyHostFingerprint(normalized, expected, async () => approve({ host: request.host, port: request.port, fingerprint: normalized }))
    if (accepted && expected === undefined) {
      await this.options.hostKeys.trust(request.host, request.port, normalized)
    }
    return accepted
  }

  private getRecord(sessionId: string): SessionRecord {
    if (!isValidSessionId(sessionId)) throw new Error("Invalid session identifier")
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error("SSH session not found")
    return record
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
