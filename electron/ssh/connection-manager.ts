import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Client, type ConnectConfig, type HostFingerprintVerifier } from "ssh2"
import type { AuthMethod } from "../storage/types"
import type { TerminalFailureReason } from "./types"
import { inspectHostKey as inspectStoredHostKey, normalizeFingerprint, type HostKeyInspection, type HostKeyStore } from "./host-keys"
import { retryDelayMs } from "./reconnect-policy"

export interface ConnectionAcquireRequest {
  hostId: string
  ownerWebContentsId: number
  kind: "terminal" | "forward"
  forceNewConnection?: boolean
}

export interface ResolvedConnectionRequest {
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  identityFile?: string
  password?: string
  passphrase?: string
  agent?: string
  readyTimeoutMs: number
  securityContextKey: string
}

export type ConnectionResolutionFailureReason = "authentication" | "configuration" | "cancelled"

export class ConnectionResolutionError extends Error {
  public constructor(message: string, public readonly reason: ConnectionResolutionFailureReason = "configuration") {
    super(message)
  }
}

export interface RetryScheduler {
  schedule(delayMs: number, action: () => void): number
  cancel(id: number): void
}

export interface ConnectionLease {
  id: string
  connectionId: string
  ownerWebContentsId: number
  kind: "terminal" | "forward"
}

export type ConnectionEvent =
  | { kind: "ready"; connectionId: string; ownerWebContentsId: number; transportGeneration: number }
  | { kind: "lost"; connectionId: string; ownerWebContentsId: number; reason: TerminalFailureReason }
  | { kind: "retrying"; connectionId: string; ownerWebContentsId: number; attempt: number; nextRetryAt: string }
  | { kind: "failed"; connectionId: string; ownerWebContentsId: number; reason: TerminalFailureReason }

export interface ConnectionLeaseController {
  retain(connectionId: string, ownerWebContentsId: number, kind: ConnectionLease["kind"]): ConnectionLease
  release(leaseId: string): Promise<void>
  releaseOwner(ownerWebContentsId: number): Promise<void>
}

export interface ConnectionCommandExecutor {
  execOnConnection(connectionId: string, command: string): Promise<string>
  getClientForConnection(connectionId: string): Client
}

export interface HostKeyPromptRequest {
  ownerWebContentsId: number
  host: string
  port: number
  inspection: HostKeyInspection
}

export interface SshConnectionManagerOptions {
  createClient?: () => Client
  scheduler?: RetryScheduler
  random?: () => number
  maxRetryAttempts?: number
  resolve(request: ConnectionAcquireRequest): Promise<ResolvedConnectionRequest>
  inspectHostKey?: (request: ResolvedConnectionRequest, fingerprint: string) => Promise<HostKeyInspection>
  hostKeys?: HostKeyStore
  promptForHostKey(request: HostKeyPromptRequest): Promise<boolean>
  trustHostKey?: (host: string, port: number, fingerprint: string) => Promise<void>
  replaceHostKey?: (host: string, port: number, expectedFingerprint: string, replacementFingerprint: string) => Promise<void>
  onEvent?: (event: ConnectionEvent) => void
}

type ConnectionState = "connecting" | "ready" | "retrying" | "closed"

interface ConnectionRecord {
  connectionId: string
  ownerWebContentsId: number
  hostId: string
  identityKey: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  identityFile?: string
  agent?: string
  verifiedFingerprint?: string
  transportGeneration: number
  client?: Client
  leases: Map<string, ConnectionLease>
  state: ConnectionState
  retryTimer?: number
  retryAttempt: number
  connectPromise?: Promise<void>
}

class HostKeyError extends Error {
  public constructor(message: string, public readonly reason: "host-key-changed" | "host-key-rejected") {
    super(message)
  }
}

const defaultScheduler: RetryScheduler = {
  schedule: (delayMs, action) => setTimeout(action, delayMs) as unknown as number,
  cancel: (id) => clearTimeout(id)
}

export class SshConnectionManager implements ConnectionLeaseController, ConnectionCommandExecutor {
  private readonly connections = new Map<string, ConnectionRecord>()
  private readonly leaseIndex = new Map<string, string>()
  private readonly listeners = new Set<(event: ConnectionEvent) => void>()
  private readonly createClient: () => Client
  private readonly scheduler: RetryScheduler
  private readonly random: () => number
  private readonly maxRetryAttempts: number

  public constructor(private readonly options: SshConnectionManagerOptions) {
    this.createClient = options.createClient ?? (() => new Client())
    this.scheduler = options.scheduler ?? defaultScheduler
    this.random = options.random ?? Math.random
    this.maxRetryAttempts = Math.max(1, Math.floor(options.maxRetryAttempts ?? 8))
  }

  public onEvent(listener: (event: ConnectionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public async acquire(request: ConnectionAcquireRequest): Promise<ConnectionLease> {
    if (request.kind !== "terminal") throw new Error("Connection acquisition is only available for terminal leases")
    let resolved: ResolvedConnectionRequest
    try {
      resolved = await this.options.resolve(request)
    } catch (error) {
      this.emit({
        kind: "failed",
        connectionId: randomUUID(),
        ownerWebContentsId: request.ownerWebContentsId,
        reason: resolutionFailureReason(error)
      })
      throw error
    }
    const identityKey = connectionIdentity(request.hostId, resolved)
    if (!request.forceNewConnection) {
      const reusable = [...this.connections.values()].find((record) =>
        record.ownerWebContentsId === request.ownerWebContentsId &&
        record.identityKey === identityKey &&
        ((record.verifiedFingerprint !== undefined && record.state === "ready") ||
          (record.state === "connecting" && record.connectPromise !== undefined))
      )
      if (reusable) {
        const connecting = reusable.connectPromise
        if (connecting) await connecting
        if (reusable.state === "ready" && reusable.verifiedFingerprint !== undefined) {
          return this.addLease(reusable, request.ownerWebContentsId, "terminal")
        }
      }
    }

    const record = this.createRecord(request, resolved, identityKey)
    this.connections.set(record.connectionId, record)
    try {
      await this.connect(record, resolved)
      return this.addLease(record, request.ownerWebContentsId, "terminal")
    } catch (error) {
      this.discard(record, failureReason(error))
      throw error
    }
  }

  public retain(connectionId: string, ownerWebContentsId: number, kind: ConnectionLease["kind"]): ConnectionLease {
    if (kind !== "forward") throw new Error("Only forwarding leases may be retained")
    const record = this.getConnection(connectionId)
    if (record.ownerWebContentsId !== ownerWebContentsId || record.state !== "ready") {
      throw new Error("SSH connection is not owned by this window")
    }
    return this.addLease(record, ownerWebContentsId, kind)
  }

  public async release(leaseId: string): Promise<void> {
    const connectionId = this.leaseIndex.get(leaseId)
    if (!connectionId) return
    this.leaseIndex.delete(leaseId)
    const record = this.connections.get(connectionId)
    if (!record) return
    record.leases.delete(leaseId)
    if (record.leases.size === 0) this.close(record)
  }

  public async releaseOwner(ownerWebContentsId: number): Promise<void> {
    const leaseIds = [...this.leaseIndex.entries()]
      .filter(([, connectionId]) => this.connections.get(connectionId)?.ownerWebContentsId === ownerWebContentsId)
      .map(([leaseId]) => leaseId)
    await Promise.all(leaseIds.map((leaseId) => this.release(leaseId)))
  }

  public async execOnConnection(connectionId: string, command: string): Promise<string> {
    if (!command || command.includes("\u0000") || command.length > 4_096) throw new Error("Invalid remote command")
    const client = this.getClientForConnection(connectionId)
    return new Promise<string>((resolve, reject) => {
      client.exec(command, (error, channel) => {
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

  public getClientForConnection(connectionId: string): Client {
    const record = this.getConnection(connectionId)
    if (record.state !== "ready" || !record.client) throw new Error("SSH connection is not ready")
    return record.client
  }

  private createRecord(request: ConnectionAcquireRequest, resolved: ResolvedConnectionRequest, identityKey: string): ConnectionRecord {
    return {
      connectionId: randomUUID(),
      ownerWebContentsId: request.ownerWebContentsId,
      hostId: request.hostId,
      identityKey,
      host: resolved.host,
      port: resolved.port,
      username: resolved.username,
      authMethod: resolved.authMethod,
      identityFile: resolved.identityFile,
      agent: resolved.agent,
      transportGeneration: 0,
      leases: new Map(),
      state: "connecting",
      retryAttempt: 0
    }
  }

  private async connect(record: ConnectionRecord, resolved: ResolvedConnectionRequest): Promise<void> {
    record.state = "connecting"
    const client = this.createClient()
    record.client = client
    const promise = new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        reject(error)
      }
      const isCurrentTransport = (): boolean => record.client === client && this.connections.has(record.connectionId)
      const ready = (): void => {
        if (settled || !isCurrentTransport()) return
        settled = true
        record.state = "ready"
        record.retryAttempt = 0
        record.transportGeneration += 1
        this.emit({
          kind: "ready",
          connectionId: record.connectionId,
          ownerWebContentsId: record.ownerWebContentsId,
          transportGeneration: record.transportGeneration
        })
        resolve()
      }
      client.once("ready", ready)
      client.on("error", (error: Error) => {
        if (!isCurrentTransport()) return
        if (!settled) fail(error)
        else this.handleLostTransport(record, failureReason(error))
      })
      client.on("close", () => {
        if (!isCurrentTransport()) return
        if (!settled) fail(new Error("SSH connection closed before it was ready"))
        else this.handleLostTransport(record, "network")
      })

      void this.connectConfig(record, resolved, fail).then((config) => {
        if (settled) return
        client.connect(config)
      }).catch((error: Error) => fail(error))
    })
    record.connectPromise = promise
    try {
      await promise
    } finally {
      record.connectPromise = undefined
    }
  }

  private async connectConfig(
    record: ConnectionRecord,
    resolved: ResolvedConnectionRequest,
    fail: (error: Error) => void
  ): Promise<ConnectConfig> {
    const hostVerifier = ((fingerprint: string, verify: (accepted: boolean) => void): void => {
      void this.verifyHostKey(record, resolved, fingerprint).then((accepted) => verify(accepted)).catch((error: unknown) => {
        verify(false)
        fail(error instanceof Error ? error : new Error("Host Key was rejected"))
      })
    }) as unknown as HostFingerprintVerifier
    const config: ConnectConfig = {
      host: resolved.host,
      port: resolved.port,
      username: resolved.username,
      readyTimeout: resolved.readyTimeoutMs,
      hostHash: "sha256",
      hostVerifier
    }
    if (resolved.authMethod === "password") {
      config.password = resolved.password
    } else if (resolved.authMethod === "privateKey") {
      if (!resolved.identityFile) throw new Error("Private key path is missing")
      config.privateKey = await readFile(resolved.identityFile)
      config.passphrase = resolved.passphrase
    } else {
      config.agent = resolved.agent ?? process.env.SSH_AUTH_SOCK ?? (process.platform === "win32" ? "pageant" : undefined)
    }
    return config
  }

  private async verifyHostKey(record: ConnectionRecord, resolved: ResolvedConnectionRequest, fingerprint: string): Promise<boolean> {
    const inspection = await this.inspectHostKey(resolved, fingerprint)
    if (inspection.status === "match") {
      record.verifiedFingerprint = normalizeFingerprint(inspection.fingerprint)
      return true
    }
    const approved = await this.options.promptForHostKey({
      ownerWebContentsId: record.ownerWebContentsId,
      host: resolved.host,
      port: resolved.port,
      inspection
    })
    if (!approved) {
      throw new HostKeyError(
        inspection.status === "changed" ? "Host Key changed" : "Host Key was rejected",
        inspection.status === "changed" ? "host-key-changed" : "host-key-rejected"
      )
    }
    if (inspection.status === "unknown") {
      const trust = this.options.trustHostKey ?? this.options.hostKeys?.trust.bind(this.options.hostKeys)
      if (!trust) throw new HostKeyError("Host Key was rejected", "host-key-rejected")
      await trust(resolved.host, resolved.port, inspection.fingerprint)
      record.verifiedFingerprint = normalizeFingerprint(inspection.fingerprint)
      return true
    }
    const replace = this.options.replaceHostKey ?? this.options.hostKeys?.replace?.bind(this.options.hostKeys)
    if (!replace) throw new HostKeyError("Host Key changed", "host-key-changed")
    await replace(resolved.host, resolved.port, inspection.storedFingerprint, inspection.receivedFingerprint)
    record.verifiedFingerprint = normalizeFingerprint(inspection.receivedFingerprint)
    return true
  }

  private async inspectHostKey(resolved: ResolvedConnectionRequest, fingerprint: string): Promise<HostKeyInspection> {
    if (this.options.inspectHostKey) return this.options.inspectHostKey(resolved, fingerprint)
    if (!this.options.hostKeys) throw new HostKeyError("Host Key was rejected", "host-key-rejected")
    return inspectStoredHostKey(this.options.hostKeys, resolved.host, resolved.port, fingerprint)
  }

  private handleLostTransport(record: ConnectionRecord, reason: TerminalFailureReason): void {
    if (record.state !== "ready" || !this.connections.has(record.connectionId)) return
    if (!isRetryable(reason) || record.leases.size === 0) {
      this.discard(record, reason)
      return
    }
    this.emit({ kind: "lost", connectionId: record.connectionId, ownerWebContentsId: record.ownerWebContentsId, reason })
    this.scheduleRetry(record, reason)
  }

  private scheduleRetry(record: ConnectionRecord, reason: TerminalFailureReason): void {
    if (record.retryTimer !== undefined || !this.connections.has(record.connectionId)) return
    if (record.retryAttempt >= this.maxRetryAttempts) {
      this.discard(record, reason)
      return
    }
    const attempt = record.retryAttempt + 1
    const delayMs = retryDelayMs(attempt, this.random)
    record.retryAttempt = attempt
    record.state = "retrying"
    record.retryTimer = this.scheduler.schedule(delayMs, () => {
      record.retryTimer = undefined
      void this.retry(record)
    })
    this.emit({
      kind: "retrying",
      connectionId: record.connectionId,
      ownerWebContentsId: record.ownerWebContentsId,
      attempt,
      nextRetryAt: new Date(Date.now() + delayMs).toISOString()
    })
  }

  private async retry(record: ConnectionRecord): Promise<void> {
    if (!this.connections.has(record.connectionId) || record.leases.size === 0) return
    let resolved: ResolvedConnectionRequest
    try {
      resolved = await this.options.resolve({ hostId: record.hostId, ownerWebContentsId: record.ownerWebContentsId, kind: "terminal" })
    } catch (error) {
      this.discard(record, resolutionFailureReason(error))
      return
    }
    try {
      if (connectionIdentity(record.hostId, resolved) !== record.identityKey) {
        throw new Error("Resolved connection security context changed during retry")
      }
      await this.connect(record, resolved)
    } catch (error) {
      const reason = failureReason(error)
      if (isRetryable(reason)) this.scheduleRetry(record, reason)
      else this.discard(record, reason)
    }
  }

  private addLease(record: ConnectionRecord, ownerWebContentsId: number, kind: ConnectionLease["kind"]): ConnectionLease {
    const lease: ConnectionLease = { id: randomUUID(), connectionId: record.connectionId, ownerWebContentsId, kind }
    record.leases.set(lease.id, lease)
    this.leaseIndex.set(lease.id, record.connectionId)
    return lease
  }

  private close(record: ConnectionRecord): void {
    record.state = "closed"
    if (record.retryTimer !== undefined) this.scheduler.cancel(record.retryTimer)
    record.retryTimer = undefined
    record.client?.end()
    this.connections.delete(record.connectionId)
  }

  private discard(record: ConnectionRecord, reason: TerminalFailureReason): void {
    if (!this.connections.has(record.connectionId)) return
    this.close(record)
    for (const leaseId of record.leases.keys()) this.leaseIndex.delete(leaseId)
    record.leases.clear()
    this.emit({ kind: "failed", connectionId: record.connectionId, ownerWebContentsId: record.ownerWebContentsId, reason })
  }

  private getConnection(connectionId: string): ConnectionRecord {
    const record = this.connections.get(connectionId)
    if (!record) throw new Error("SSH connection not found")
    return record
  }

  private emit(event: ConnectionEvent): void {
    this.options.onEvent?.(event)
    for (const listener of this.listeners) listener(event)
  }
}

function connectionIdentity(hostId: string, resolved: ResolvedConnectionRequest): string {
  return createHash("sha256").update(JSON.stringify({
    hostId,
    host: resolved.host,
    port: resolved.port,
    username: resolved.username,
    authMethod: resolved.authMethod,
    identityFile: resolved.identityFile,
    agent: resolved.agent,
    securityContextKey: resolved.securityContextKey
  })).digest("hex")
}

function failureReason(error: unknown): TerminalFailureReason {
  if (error instanceof HostKeyError) return error.reason
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  if (message.includes("authentication") || message.includes("auth failed")) return "authentication"
  if (message.includes("private key") || message.includes("security context") || message.includes("credential") || message.includes("configuration")) return "configuration"
  if (message.includes("cancelled") || message.includes("canceled")) return "cancelled"
  if (message.includes("timeout") || message.includes("timed out")) return "timeout"
  if (message.includes("dns") || message.includes("enotfound")) return "dns"
  return "network"
}

function resolutionFailureReason(error: unknown): ConnectionResolutionFailureReason {
  return error instanceof ConnectionResolutionError ? error.reason : "configuration"
}

function isRetryable(reason: TerminalFailureReason): boolean {
  return reason === "network" || reason === "timeout" || reason === "dns"
}
