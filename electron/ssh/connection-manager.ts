import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Client, type ConnectConfig, type HostFingerprintVerifier } from "ssh2"
import type { AuthMethod } from "../storage/types"
import { sameRuntimeOwner, type RuntimeOwner } from "../runtime/owner"
import {
  ConnectionFailureError,
  type ConnectionFailureReason
} from "./types"
import { inspectHostKey as inspectStoredHostKey, normalizeFingerprint, type HostKeyInspection, type HostKeyStore } from "./host-keys"
import { retryDelayMs } from "./reconnect-policy"

export { ConnectionFailureError, type ConnectionFailureReason } from "./types"

export interface ConnectionAcquireRequest {
  hostId: string
  owner: RuntimeOwner
  kind: "terminal" | "forward"
  forceNewConnection?: boolean
  signal?: AbortSignal
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

export type ConnectionResolutionFailureReason = Extract<ConnectionFailureReason, "authentication" | "configuration" | "cancelled">

export class ConnectionResolutionError extends ConnectionFailureError {
  public constructor(message: string, public readonly reason: ConnectionResolutionFailureReason = "configuration") {
    super(message, reason)
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
  | { kind: "lost"; connectionId: string; owner: RuntimeOwner; reason: ConnectionFailureReason }
  | { kind: "retrying"; connectionId: string; owner: RuntimeOwner; attempt: number; nextRetryAt: string }
  | { kind: "failed"; connectionId: string; owner: RuntimeOwner; reason: ConnectionFailureReason }

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
  readPrivateKey?: typeof readFile
  keepalivePolicy?: KeepalivePolicy
  resolve(request: ConnectionAcquireRequest): Promise<ResolvedConnectionRequest>
  inspectHostKey?: (request: ResolvedConnectionRequest, fingerprint: string) => Promise<HostKeyInspection>
  hostKeys?: HostKeyStore
  promptForHostKey(request: HostKeyPromptRequest): Promise<boolean>
  trustHostKey?: (host: string, port: number, fingerprint: string) => Promise<void>
  replaceHostKey?: (host: string, port: number, expectedFingerprint: string, replacementFingerprint: string) => Promise<void>
  onEvent?: (event: ConnectionEvent) => void
}

export interface KeepalivePolicy {
  intervalMs: number
  countMax: number
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
  connectFailureReason?: ConnectionFailureReason
  connectPromise?: Promise<void>
  cancelConnect?: () => void
  readyWaiters: Set<ConnectionReadyWaiter>
}

interface ConnectionReadyWaiter {
  leaseId: string
  resolve(): void
  reject(error: Error): void
  disposeAbort(): void
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
  private readonly keepalivePolicy: KeepalivePolicy
  private maxRetryAttempts: number

  public constructor(private readonly options: SshConnectionManagerOptions) {
    this.createClient = options.createClient ?? (() => new Client())
    this.scheduler = options.scheduler ?? defaultScheduler
    this.random = options.random ?? Math.random
    this.keepalivePolicy = options.keepalivePolicy ?? { intervalMs: 15_000, countMax: 3 }
    this.maxRetryAttempts = Math.max(0, Math.floor(options.maxRetryAttempts ?? 8))
  }

  public onEvent(listener: (event: ConnectionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public ownerForConnection(connectionId: string): RuntimeOwner | undefined {
    return this.connections.get(connectionId)?.owner
  }

  private resolveRequest(request: ConnectionAcquireRequest): Promise<ResolvedConnectionRequest> {
    const signal = request.signal
    if (!signal) return this.options.resolve(request)
    if (signal.aborted) return Promise.reject(cancelledFailure())
    return new Promise<ResolvedConnectionRequest>((resolve, reject) => {
      let settled = false
      const disposeAbort = (): void => signal.removeEventListener("abort", onAbort)
      const settle = (action: () => void): void => {
        if (settled) return
        settled = true
        disposeAbort()
        action()
      }
      const onAbort = (): void => settle(() => reject(cancelledFailure()))
      signal.addEventListener("abort", onAbort, { once: true })

      let resolution: Promise<ResolvedConnectionRequest>
      try {
        resolution = this.options.resolve(request)
      } catch (error) {
        settle(() => reject(error))
        return
      }
      void resolution.then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error))
      )
      if (signal.aborted) onAbort()
    })
  }

  public async acquire(request: ConnectionAcquireRequest): Promise<ConnectionLease> {
    if (request.kind !== "terminal") throw new Error("Connection acquisition is only available for terminal leases")
    let resolved: ResolvedConnectionRequest
    try {
      resolved = await this.resolveRequest(request)
      if (request.signal?.aborted) throw cancelledFailure()
    } catch (error) {
      const normalized = request.signal?.aborted ? cancelledFailure() : error
      const reason = resolutionFailureReason(normalized)
      this.emit({
        kind: "failed",
        connectionId: randomUUID(),
        owner: request.owner,
        reason
      })
      throw withFailureReason(normalized, reason)
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
        const ready = this.waitForReady(reusable, lease, request.signal)
        if (reusable.state === "retrying") this.retryNow(reusable.connectionId)
        try {
          await ready
          if (reusable.state === "ready" && reusable.verifiedFingerprint !== undefined) return lease
          throw new Error("SSH connection is not ready")
        } catch (error) {
          await this.release(lease.id)
          throw withFailureReason(error, failureReason(error, reusable.connectFailureReason))
        }
      }
    }

    const record = this.createRecord(request, resolved, identityKey)
    this.connections.set(record.connectionId, record)
    const lease = this.addLease(record, request.owner, "terminal")
    const ready = this.waitForReady(record, lease, request.signal)
    if (this.isCurrent(record) && record.leases.has(lease.id)) {
      void this.connect(record, resolved).catch((error: unknown) => {
        const reason = failureReason(error, record.connectFailureReason)
        this.discard(record, reason, error)
      })
    }
    try {
      await ready
      if (record.state === "ready" && record.verifiedFingerprint !== undefined) return lease
      throw new Error("SSH connection is not ready")
    } catch (error) {
      await this.release(lease.id)
      throw withFailureReason(error, failureReason(error, record.connectFailureReason))
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
    for (const waiter of [...record.readyWaiters]) {
      if (waiter.leaseId === leaseId) waiter.reject(cancelledFailure())
    }
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
      record.cancelConnect = () => fail(cancelledFailure())
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
      keepaliveInterval: this.keepalivePolicy.intervalMs,
      keepaliveCountMax: this.keepalivePolicy.countMax,
      hostHash: "sha256",
      hostVerifier
    }
    if (resolved.authMethod === "password") {
      config.password = resolved.password
    } else if (resolved.authMethod === "privateKey") {
      if (!resolved.identityFile) throw new Error("Private key path is missing")
      try {
        config.privateKey = await (this.options.readPrivateKey ?? readFile)(resolved.identityFile)
      } catch {
        throw new ConnectionFailureError("SSH private key could not be loaded", "configuration")
      }
      config.passphrase = resolved.passphrase
    } else {
      try {
        config.agent = resolved.agent ?? process.env.SSH_AUTH_SOCK ?? (process.platform === "win32" ? "pageant" : undefined)
      } catch {
        throw new ConnectionFailureError("SSH agent could not be configured", "configuration")
      }
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

  private handleLostTransport(record: ConnectionRecord, reason: ConnectionFailureReason): void {
    if (record.state !== "ready" || !this.connections.has(record.connectionId)) return
    if (!isRetryable(reason) || record.leases.size === 0) {
      this.discard(record, reason)
      return
    }
    this.emit({ kind: "lost", connectionId: record.connectionId, owner: record.owner, reason })
    this.scheduleRetry(record, reason)
  }

  private scheduleRetry(record: ConnectionRecord, reason: ConnectionFailureReason): void {
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
      this.discard(record, resolutionFailureReason(error), error)
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
      else this.discard(record, reason, error)
    }
  }

  private addLease(record: ConnectionRecord, owner: RuntimeOwner, kind: ConnectionLease["kind"]): ConnectionLease {
    const lease: ConnectionLease = { id: randomUUID(), connectionId: record.connectionId, owner, kind }
    record.leases.set(lease.id, lease)
    this.leaseIndex.set(lease.id, record.connectionId)
    return lease
  }

  private close(record: ConnectionRecord, error: Error = cancelledFailure()): void {
    if (!this.isCurrent(record) || record.state === "closed") return
    record.state = "closed"
    if (record.retryTimer !== undefined) this.scheduler.cancel(record.retryTimer)
    record.retryTimer = undefined
    const cancelConnect = record.cancelConnect
    record.cancelConnect = undefined
    cancelConnect?.()
    this.connections.delete(record.connectionId)
    this.rejectReadyWaiters(record, error)
    try {
      record.client?.end()
    } catch {
      // Transport cleanup must not replace the connection failure.
    }
  }

  private discard(record: ConnectionRecord, reason: ConnectionFailureReason, error?: unknown): void {
    if (!this.isCurrent(record)) return
    this.close(record, withFailureReason(error ?? new Error("SSH connection failed"), reason))
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

  private waitForReady(record: ConnectionRecord, lease: ConnectionLease, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      void this.release(lease.id)
      return Promise.reject(cancelledFailure())
    }
    if (record.state === "ready" && record.verifiedFingerprint !== undefined) return Promise.resolve()
    if (!this.isCurrent(record)) return Promise.reject(connectionClosedFailure())
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let abortListener: (() => void) | undefined
      const disposeAbort = (): void => {
        if (abortListener) signal?.removeEventListener("abort", abortListener)
      }
      const waiter: ConnectionReadyWaiter = {
        leaseId: lease.id,
        resolve: () => {
          if (settled) return
          settled = true
          record.readyWaiters.delete(waiter)
          disposeAbort()
          resolve()
        },
        reject: (error: Error) => {
          if (settled) return
          settled = true
          record.readyWaiters.delete(waiter)
          disposeAbort()
          reject(error)
        },
        disposeAbort
      }
      abortListener = (): void => {
        if (settled) return
        settled = true
        record.readyWaiters.delete(waiter)
        disposeAbort()
        reject(cancelledFailure())
        void this.release(lease.id)
      }
      record.readyWaiters.add(waiter)
      if (signal) {
        signal.addEventListener("abort", abortListener, { once: true })
        if (signal.aborted) abortListener()
      }
    })
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

function failureReason(error: unknown, fallback?: ConnectionFailureReason): ConnectionFailureReason {
  if (error instanceof ConnectionFailureError) return error.reason
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

function withFailureReason(error: unknown, reason: ConnectionFailureReason): Error {
  const normalized = error instanceof Error ? error : new Error("SSH connection failed")
  if ("reason" in normalized) return normalized
  Object.defineProperty(normalized, "reason", { configurable: true, enumerable: false, value: reason })
  return normalized
}

function resolutionFailureReason(error: unknown): ConnectionResolutionFailureReason {
  if (error instanceof ConnectionFailureError &&
    (error.reason === "authentication" || error.reason === "configuration" || error.reason === "cancelled")) {
    return error.reason
  }
  return error instanceof ConnectionResolutionError ? error.reason : "configuration"
}

function isRetryable(reason: ConnectionFailureReason): boolean {
  return reason === "network" || reason === "timeout" || reason === "dns"
}

function cancelledFailure(): ConnectionFailureError {
  return new ConnectionFailureError("SSH connection acquisition was cancelled", "cancelled")
}

function connectionClosedFailure(): ConnectionFailureError {
  return new ConnectionFailureError("SSH connection was closed", "cancelled")
}
