import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Client, type ConnectConfig, type HostFingerprintVerifier } from "ssh2"
import type { AuthMethod } from "../storage/types"
import { sameRuntimeOwner, type RuntimeOwner } from "../runtime/owner"
import type { TerminalFailureReason } from "./types"
import { inspectHostKey as inspectStoredHostKey, normalizeFingerprint, type HostKeyInspection, type HostKeyStore } from "./host-keys"
import { retryDelayMs } from "./reconnect-policy"

export interface ConnectionAcquireRequest {
  hostId: string
  owner: RuntimeOwner
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
  knownHostKeyFingerprint?: string
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
  owner: RuntimeOwner
  kind: "terminal" | "forward"
}

export type ConnectionEvent =
  | { kind: "ready"; connectionId: string; owner: RuntimeOwner; transportGeneration: number }
  | { kind: "lost"; connectionId: string; owner: RuntimeOwner; reason: TerminalFailureReason }
  | { kind: "retrying"; connectionId: string; owner: RuntimeOwner; attempt: number; nextRetryAt: string }
  | { kind: "failed"; connectionId: string; owner: RuntimeOwner; reason: TerminalFailureReason }

export interface ConnectionLeaseController {
  retain(connectionId: string, owner: RuntimeOwner, kind: "forward"): ConnectionLease
  release(leaseId: string): Promise<void>
  releaseOwner(owner: RuntimeOwner): Promise<void>
  releaseWebContents(webContentsId: number): Promise<void>
}

export interface ConnectionCommandExecutor {
  execOnConnection(connectionId: string, command: string): Promise<string>
  getClientForConnection(connectionId: string): Client
}

export interface HostKeyPromptRequest {
  owner: RuntimeOwner
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
  owner: RuntimeOwner
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
  connectFailureReason?: TerminalFailureReason
  connectPromise?: Promise<void>
  cancelConnect?: () => void
  readyWaiters: Set<ConnectionReadyWaiter>
}

interface ConnectionReadyWaiter {
  resolve(): void
  reject(error: Error): void
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
  private maxRetryAttempts: number

  public constructor(private readonly options: SshConnectionManagerOptions) {
    this.createClient = options.createClient ?? (() => new Client())
    this.scheduler = options.scheduler ?? defaultScheduler
    this.random = options.random ?? Math.random
    this.maxRetryAttempts = Math.max(0, Math.floor(options.maxRetryAttempts ?? 8))
  }

  public onEvent(listener: (event: ConnectionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public ownerForConnection(connectionId: string): RuntimeOwner | undefined {
    return this.connections.get(connectionId)?.owner
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
        owner: request.owner,
        reason: resolutionFailureReason(error)
      })
      throw error
    }
    const identityKey = connectionIdentity(request.hostId, resolved)
    if (!request.forceNewConnection) {
      const reusable = [...this.connections.values()].find((record) =>
        sameRuntimeOwner(record.owner, request.owner) &&
        record.identityKey === identityKey &&
        matchesKnownHostKey(record, resolved) &&
        ((record.verifiedFingerprint !== undefined && record.state === "ready") ||
          (record.state === "connecting" && record.connectPromise !== undefined) ||
          (record.verifiedFingerprint !== undefined && record.state === "retrying"))
      )
      if (reusable) {
        const lease = this.addLease(reusable, request.owner, "terminal")
        if (reusable.state === "retrying") this.retryNow(reusable.connectionId)
        try {
          await this.waitForReady(reusable)
          if (reusable.state === "ready" && reusable.verifiedFingerprint !== undefined) return lease
          throw new Error("SSH connection is not ready")
        } catch (error) {
          await this.release(lease.id)
          throw error
        }
      }
    }

    const record = this.createRecord(request, resolved, identityKey)
    this.connections.set(record.connectionId, record)
    try {
      await this.connect(record, resolved)
      return this.addLease(record, request.owner, "terminal")
    } catch (error) {
      const reason = failureReason(error, record.connectFailureReason)
      this.discard(record, reason)
      throw withFailureReason(error, reason)
    }
  }

  public retain(connectionId: string, owner: RuntimeOwner, kind: "forward"): ConnectionLease {
    if (kind !== "forward") throw new Error("Only forwarding leases may be retained")
    const record = this.getConnection(connectionId)
    if (!sameRuntimeOwner(record.owner, owner) || record.state !== "ready") {
      throw new Error("SSH connection is not owned by this window")
    }
    return this.addLease(record, owner, kind)
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

  public async releaseOwner(owner: RuntimeOwner): Promise<void> {
    const leaseIds = [...this.leaseIndex.entries()]
      .filter(([, connectionId]) => {
        const connection = this.connections.get(connectionId)
        return connection !== undefined && sameRuntimeOwner(connection.owner, owner)
      })
      .map(([leaseId]) => leaseId)
    await Promise.all(leaseIds.map((leaseId) => this.release(leaseId)))
  }

  public async releaseWebContents(webContentsId: number): Promise<void> {
    const leaseIds = [...this.leaseIndex.entries()]
      .filter(([, connectionId]) => this.connections.get(connectionId)?.owner.webContentsId === webContentsId)
      .map(([leaseId]) => leaseId)
    await Promise.all(leaseIds.map((leaseId) => this.release(leaseId)))
  }

  public retryNow(connectionId?: string): void {
    for (const record of this.connections.values()) {
      if (connectionId !== undefined && record.connectionId !== connectionId) continue
      if (record.state !== "retrying" || record.retryTimer === undefined || record.leases.size === 0) continue
      this.scheduler.cancel(record.retryTimer)
      record.retryTimer = undefined
      void this.retry(record)
    }
  }

  public updateRetryPolicy(policy: { autoReconnect: boolean; reconnectMode: "limited" | "continuous" }): void {
    const maxRetryAttempts = !policy.autoReconnect
      ? 0
      : policy.reconnectMode === "continuous"
        ? Number.POSITIVE_INFINITY
        : 8
    this.maxRetryAttempts = maxRetryAttempts
    if (maxRetryAttempts > 0) return
    for (const record of [...this.connections.values()]) {
      if (record.state !== "retrying") continue
      if (record.retryTimer !== undefined) this.scheduler.cancel(record.retryTimer)
      record.retryTimer = undefined
      this.discard(record, "cancelled")
    }
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
      owner: request.owner,
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
      retryAttempt: 0,
      readyWaiters: new Set()
    }
  }

  private async connect(record: ConnectionRecord, resolved: ResolvedConnectionRequest): Promise<void> {
    if (!this.isCurrent(record)) throw new Error("SSH connection was closed")
    record.state = "connecting"
    record.connectFailureReason = undefined
    const client = this.createClient()
    record.client = client
    const promise = new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        reject(error)
      }
      record.cancelConnect = () => fail(new Error("SSH connection was closed"))
      const isCurrentTransport = (): boolean => record.client === client && this.isCurrent(record)
      const ready = (): void => {
        if (settled || !isCurrentTransport()) return
        settled = true
        record.state = "ready"
        record.retryAttempt = 0
        record.transportGeneration += 1
        this.resolveReadyWaiters(record)
        this.emit({
          kind: "ready",
          connectionId: record.connectionId,
          owner: record.owner,
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
        if (!isCurrentTransport()) {
          fail(new Error("SSH connection was closed"))
          return
        }
        client.connect(config)
      }).catch((error: Error) => fail(error))
    })
    record.connectPromise = promise
    try {
      await promise
    } finally {
      if (record.connectPromise === promise) {
        record.connectPromise = undefined
        record.cancelConnect = undefined
      }
    }
  }

  private async connectConfig(
    record: ConnectionRecord,
    resolved: ResolvedConnectionRequest,
    fail: (error: Error) => void
  ): Promise<ConnectConfig> {
    const hostVerifier = ((fingerprint: string, verify: (accepted: boolean) => void): void => {
      void this.verifyHostKey(record, resolved, fingerprint).then((accepted) => verify(accepted)).catch((error: unknown) => {
        if (error instanceof HostKeyError) record.connectFailureReason = error.reason
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
    try {
      const inspection = await this.inspectHostKey(resolved, fingerprint)
      if (inspection.status === "match") {
        record.verifiedFingerprint = normalizeFingerprint(inspection.fingerprint)
        return true
      }
      const approved = await this.options.promptForHostKey({
        owner: record.owner,
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
        try {
          await trust(resolved.host, resolved.port, inspection.fingerprint)
        } catch {
          throw new HostKeyError("Host Key could not be trusted", "host-key-rejected")
        }
        record.verifiedFingerprint = normalizeFingerprint(inspection.fingerprint)
        return true
      }
      const replace = this.options.replaceHostKey ?? this.options.hostKeys?.replace?.bind(this.options.hostKeys)
      if (!replace) throw new HostKeyError("Host Key changed", "host-key-changed")
      try {
        await replace(resolved.host, resolved.port, inspection.storedFingerprint, inspection.receivedFingerprint)
      } catch {
        throw new HostKeyError("Host Key changed while saving replacement", "host-key-changed")
      }
      record.verifiedFingerprint = normalizeFingerprint(inspection.receivedFingerprint)
      return true
    } catch (error) {
      if (error instanceof HostKeyError) throw error
      throw new HostKeyError("Host Key verification failed", "host-key-rejected")
    }
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
    this.emit({ kind: "lost", connectionId: record.connectionId, owner: record.owner, reason })
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
    let timerId = 0
    timerId = this.scheduler.schedule(delayMs, () => {
      if (record.retryTimer !== timerId) return
      record.retryTimer = undefined
      void this.retry(record)
    })
    record.retryTimer = timerId
    this.emit({
      kind: "retrying",
      connectionId: record.connectionId,
      owner: record.owner,
      attempt,
      nextRetryAt: new Date(Date.now() + delayMs).toISOString()
    })
  }

  private async retry(record: ConnectionRecord): Promise<void> {
    if (!this.connections.has(record.connectionId) || record.leases.size === 0) return
    let resolved: ResolvedConnectionRequest
    try {
      resolved = await this.options.resolve({ hostId: record.hostId, owner: record.owner, kind: "terminal" })
    } catch (error) {
      this.discard(record, resolutionFailureReason(error))
      return
    }
    if (!this.isCurrent(record) || record.leases.size === 0) return
    try {
      if (connectionIdentity(record.hostId, resolved) !== record.identityKey) {
        throw new Error("Resolved connection security context changed during retry")
      }
      await this.connect(record, resolved)
    } catch (error) {
      const reason = failureReason(error, record.connectFailureReason)
      if (isRetryable(reason)) this.scheduleRetry(record, reason)
      else this.discard(record, reason)
    }
  }

  private addLease(record: ConnectionRecord, owner: RuntimeOwner, kind: ConnectionLease["kind"]): ConnectionLease {
    const lease: ConnectionLease = { id: randomUUID(), connectionId: record.connectionId, owner, kind }
    record.leases.set(lease.id, lease)
    this.leaseIndex.set(lease.id, record.connectionId)
    return lease
  }

  private close(record: ConnectionRecord): void {
    record.state = "closed"
    if (record.retryTimer !== undefined) this.scheduler.cancel(record.retryTimer)
    record.retryTimer = undefined
    record.cancelConnect?.()
    record.client?.end()
    this.connections.delete(record.connectionId)
    this.rejectReadyWaiters(record, new Error("SSH connection was closed"))
  }

  private discard(record: ConnectionRecord, reason: TerminalFailureReason): void {
    if (!this.connections.has(record.connectionId)) return
    this.close(record)
    for (const leaseId of record.leases.keys()) this.leaseIndex.delete(leaseId)
    record.leases.clear()
    this.emit({ kind: "failed", connectionId: record.connectionId, owner: record.owner, reason })
  }

  private getConnection(connectionId: string): ConnectionRecord {
    const record = this.connections.get(connectionId)
    if (!record) throw new Error("SSH connection not found")
    return record
  }

  private isCurrent(record: ConnectionRecord): boolean {
    return this.connections.get(record.connectionId) === record
  }

  private waitForReady(record: ConnectionRecord): Promise<void> {
    if (record.state === "ready" && record.verifiedFingerprint !== undefined) return Promise.resolve()
    if (!this.isCurrent(record)) return Promise.reject(new Error("SSH connection was closed"))
    return new Promise<void>((resolve, reject) => record.readyWaiters.add({ resolve, reject }))
  }

  private resolveReadyWaiters(record: ConnectionRecord): void {
    for (const waiter of record.readyWaiters) waiter.resolve()
    record.readyWaiters.clear()
  }

  private rejectReadyWaiters(record: ConnectionRecord, error: Error): void {
    for (const waiter of record.readyWaiters) waiter.reject(error)
    record.readyWaiters.clear()
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

function matchesKnownHostKey(record: ConnectionRecord, resolved: ResolvedConnectionRequest): boolean {
  return resolved.knownHostKeyFingerprint === undefined ||
    record.verifiedFingerprint === normalizeFingerprint(resolved.knownHostKeyFingerprint)
}

function failureReason(error: unknown, fallback?: TerminalFailureReason): TerminalFailureReason {
  if (fallback !== undefined) return fallback
  if (error instanceof HostKeyError) return error.reason
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code).toLowerCase()
    : ""
  if (message.includes("authentication") || message.includes("auth failed")) return "authentication"
  if (message.includes("private key") || message.includes("security context") || message.includes("credential") || message.includes("configuration")) return "configuration"
  if (message.includes("cancelled") || message.includes("canceled")) return "cancelled"
  if (message.includes("timeout") || message.includes("timed out") || message.includes("etimedout") || code === "etimedout") return "timeout"
  if (message.includes("dns") || message.includes("enotfound") || code === "enotfound" || code === "eai_again" || code === "eai_fail") return "dns"
  return "network"
}

function withFailureReason(error: unknown, reason: TerminalFailureReason): Error {
  const normalized = error instanceof Error ? error : new Error("SSH connection failed")
  if ("reason" in normalized) return normalized
  Object.defineProperty(normalized, "reason", { configurable: true, enumerable: false, value: reason })
  return normalized
}

function resolutionFailureReason(error: unknown): ConnectionResolutionFailureReason {
  return error instanceof ConnectionResolutionError ? error.reason : "configuration"
}

function isRetryable(reason: TerminalFailureReason): boolean {
  return reason === "network" || reason === "timeout" || reason === "dns"
}
