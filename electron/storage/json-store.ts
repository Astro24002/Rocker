import * as fs from "node:fs/promises"
import { basename, dirname, extname, join, resolve } from "node:path"
import {
  StorageBlockedError,
  type LoadResult,
  type StorageFailureReason,
  type StorageHealth,
  type StorageIssue,
  type StorageKind
} from "./storage-result"

export interface JsonStoreOptions<T> {
  filePath: string
  store: StorageKind
  defaultValue: T
  recovery: "default" | "blocked"
  normalize(value: unknown): T | undefined
  sensitive?: boolean
  clock?: () => Date
  nextOperationId?: () => string
}

type ReadOutcome<T> =
  | { kind: "valid"; value: T }
  | { kind: "missing" }
  | { kind: "corrupt" }
  | { kind: "error"; error: unknown }

type PreparedValue<T> = {
  value: T
  serialized: string
}

const queues = new Map<string, Promise<void>>()
let operationSequence = 0

export class JsonStore<T> {
  private readonly filePath: string
  private readonly backupPath: string
  private readonly store: StorageKind
  private readonly defaultValue: T
  private readonly recovery: "default" | "blocked"
  private readonly normalize: (value: unknown) => T | undefined
  private readonly sensitive: boolean
  private readonly clock: () => Date
  private readonly nextOperationId: () => string
  private latchedHealth?: StorageHealth

  public constructor(options: JsonStoreOptions<T>)
  public constructor(filePath: string, defaultValue?: T)
  public constructor(optionsOrFilePath: JsonStoreOptions<T> | string, legacyDefaultValue?: T) {
    if (typeof optionsOrFilePath === "string") {
      this.filePath = resolve(optionsOrFilePath)
      this.backupPath = `${this.filePath}.bak`
      this.store = "settings"
      this.defaultValue = cloneValue(legacyDefaultValue === undefined ? ({} as T) : legacyDefaultValue)
      this.recovery = "default"
      this.normalize = (value) => value as T
      this.sensitive = false
      this.clock = () => new Date()
      this.nextOperationId = () => `${++operationSequence}`
      return
    }

    this.filePath = resolve(optionsOrFilePath.filePath)
    this.backupPath = `${this.filePath}.bak`
    this.store = optionsOrFilePath.store
    this.defaultValue = cloneValue(optionsOrFilePath.defaultValue)
    this.recovery = optionsOrFilePath.recovery
    this.normalize = optionsOrFilePath.normalize
    this.sensitive = optionsOrFilePath.sensitive === true
    this.clock = optionsOrFilePath.clock ?? (() => new Date())
    this.nextOperationId = optionsOrFilePath.nextOperationId ?? (() => `${++operationSequence}`)
  }

  public async load(options: { consumeHealth?: boolean } = {}): Promise<LoadResult<T>> {
    return this.enqueue(() => this.loadUnlocked(options.consumeHealth === true))
  }

  public async read(): Promise<T> {
    const result = await this.load()
    if (result.status === "blocked") throw new StorageBlockedError(result.issue)
    return cloneValue(result.value)
  }

  public async update(mutator: (current: T) => T): Promise<T> {
    return this.enqueue(async () => {
      const loaded = await this.loadUnlocked(false)
      if (loaded.status === "blocked") throw new StorageBlockedError(loaded.issue)
      const current = cloneValue(loaded.value)
      let next: T
      try {
        next = mutator(current)
      } catch (error) {
        throw error
      }
      const prepared = this.prepareValue(next)
      await this.writePrepared(prepared, loaded)
      return cloneValue(prepared.value)
    })
  }

  public async write(value: T): Promise<void> {
    return this.enqueue(async () => {
      const loaded = await this.loadUnlocked(false)
      if (loaded.status === "blocked") throw new StorageBlockedError(loaded.issue)
      const prepared = this.prepareValue(value)
      await this.writePrepared(prepared, loaded)
    })
  }

  public health(): StorageHealth {
    return this.latchedHealth ? cloneHealth(this.latchedHealth) : { store: this.store, status: "ok" }
  }

  private async loadUnlocked(consumeHealth: boolean): Promise<LoadResult<T>> {
    const blockedHealth = this.latchedHealth?.status === "blocked" ? {
      store: this.latchedHealth.store,
      reason: this.latchedHealth.reason,
      message: this.latchedHealth.message
    } satisfies StorageIssue : undefined
    const primary = await this.readDocument(this.filePath)
    if (primary.kind === "valid") return this.finishLoad({ status: "ok", value: primary.value }, consumeHealth)
    if (primary.kind === "error") {
      return this.block(blockedHealth ?? this.issueFromError(primary.error, "unavailable"))
    }

    if (primary.kind === "corrupt") {
      const quarantineIssue = await this.quarantinePrimary()
      if (quarantineIssue) return this.block(blockedHealth ?? quarantineIssue)
    }

    const backup = await this.readDocument(this.backupPath)
    if (backup.kind === "valid") {
      try {
        await this.restorePrimary(backup.value)
      } catch (error) {
        return this.block(this.issueFromError(error, "recovery-failed"))
      }
      return this.finishLoad({ status: "recovered", value: backup.value, source: "backup" }, consumeHealth)
    }
    if (backup.kind === "error") return this.block(blockedHealth ?? this.issueFromError(backup.error, "unavailable"))

    const hasQuarantine = await this.hasMatchingQuarantine()
    if ("kind" in hasQuarantine) return this.block(blockedHealth ?? this.issueFromError(hasQuarantine.error, "unavailable"))
    const corrupt = primary.kind === "corrupt" || backup.kind === "corrupt" || hasQuarantine.exists
    if (blockedHealth) return this.block(blockedHealth)
    if (corrupt && this.recovery === "blocked") {
      return this.block(this.issue("corrupt"))
    }
    if (corrupt) return this.finishLoad({ status: "defaulted", value: this.defaultValue, reason: "corrupt" }, consumeHealth)
    return this.finishLoad({ status: "defaulted", value: this.defaultValue, reason: "missing" }, consumeHealth)
  }

  private finishLoad(result: Exclude<LoadResult<T>, { status: "blocked" }>, consumeHealth: boolean): LoadResult<T> {
    if (result.status === "recovered") {
      this.latchedHealth = { store: this.store, status: "recovered", source: "backup" }
      const output = cloneLoadResult(result)
      if (consumeHealth) this.latchedHealth = undefined
      return output
    }
    if (result.status === "defaulted" && result.reason === "corrupt") {
      this.latchedHealth = { store: this.store, status: "defaulted", reason: "corrupt" }
      const output = cloneLoadResult(result)
      if (consumeHealth) this.latchedHealth = undefined
      return output
    }
    if (result.status === "ok") {
      if (this.latchedHealth?.status === "blocked") {
        this.latchedHealth = undefined
        return cloneLoadResult(result)
      }
      if (this.latchedHealth && this.latchedHealth.status !== "ok") {
        const output = loadResultFromHealth(this.latchedHealth, result.value)
        if (consumeHealth) this.latchedHealth = undefined
        return output
      }
    }
    return cloneLoadResult(result)
  }

  private block(issue: StorageIssue): LoadResult<T> {
    this.latchedHealth = {
      store: this.store,
      status: "blocked",
      reason: issue.reason,
      message: issue.message
    }
    return { status: "blocked", issue: { ...issue } }
  }

  private async writePrepared(prepared: PreparedValue<T>, loaded: Exclude<LoadResult<T>, { status: "blocked" }>): Promise<void> {
    const operationId = this.operationId()
    const temporaryPaths: string[] = []
    const primaryTemporaryPath = this.temporaryPath(operationId, "primary")
    temporaryPaths.push(primaryTemporaryPath)
    try {
      await fs.mkdir(dirname(this.filePath), { recursive: true, mode: this.sensitive ? 0o700 : 0o755 })
      await writeTemporaryFile(primaryTemporaryPath, prepared.serialized, this.sensitive ? 0o600 : 0o644)

      const hadValidPrimary = loaded.status === "ok" || loaded.status === "recovered"
      if (hadValidPrimary) {
        const current = this.prepareValue(loaded.value)
        const backupTemporaryPath = this.temporaryPath(operationId, "backup")
        temporaryPaths.push(backupTemporaryPath)
        await writeTemporaryFile(backupTemporaryPath, current.serialized, this.sensitive ? 0o600 : 0o644)
        await fs.rename(backupTemporaryPath, this.backupPath)
        temporaryPaths.splice(temporaryPaths.indexOf(backupTemporaryPath), 1)
      }

      await fs.rename(primaryTemporaryPath, this.filePath)
      temporaryPaths.splice(temporaryPaths.indexOf(primaryTemporaryPath), 1)
      if (this.sensitive) await bestEffortChmod(this.filePath, 0o600)

      if (!hadValidPrimary) {
        const backupTemporaryPath = this.temporaryPath(operationId, "backup")
        temporaryPaths.push(backupTemporaryPath)
        await writeTemporaryFile(backupTemporaryPath, prepared.serialized, this.sensitive ? 0o600 : 0o644)
        await fs.rename(backupTemporaryPath, this.backupPath)
        temporaryPaths.splice(temporaryPaths.indexOf(backupTemporaryPath), 1)
      }
      if (this.sensitive) await bestEffortChmod(this.backupPath, 0o600)
    } catch (error) {
      const issue = error instanceof StorageBlockedError ? error.issue : this.issueFromError(error, "unavailable")
      this.latchedHealth = {
        store: this.store,
        status: "blocked",
        reason: issue.reason,
        message: issue.message
      }
      throw new StorageBlockedError(issue)
    } finally {
      await Promise.all(temporaryPaths.map((path) => fs.rm(path, { force: true }).catch(() => undefined)))
    }
  }

  private async restorePrimary(value: T): Promise<void> {
    const prepared = this.prepareValue(value)
    const temporaryPath = this.temporaryPath(this.operationId(), "restore")
    try {
      await fs.mkdir(dirname(this.filePath), { recursive: true, mode: this.sensitive ? 0o700 : 0o755 })
      await writeTemporaryFile(temporaryPath, prepared.serialized, this.sensitive ? 0o600 : 0o644)
      await fs.rename(temporaryPath, this.filePath)
      if (this.sensitive) await bestEffortChmod(this.filePath, 0o600)
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }

  private async quarantinePrimary(): Promise<StorageIssue | undefined> {
    try {
      const quarantinePath = await this.nextQuarantinePath()
      await fs.rename(this.filePath, quarantinePath)
      if (this.sensitive) await bestEffortChmod(quarantinePath, 0o600)
      return undefined
    } catch (error) {
      return this.issueFromError(error, "unavailable")
    }
  }

  private async nextQuarantinePath(): Promise<string> {
    const base = basename(this.filePath)
    const extension = extname(base)
    const stem = extension ? base.slice(0, -extension.length) : base
    const timestamp = formatTimestamp(this.clock())
    const prefix = join(dirname(this.filePath), `${stem}.${timestamp}.corrupt`)
    for (let suffix = 0; ; suffix += 1) {
      const candidate = suffix === 0 ? prefix : `${prefix}.${suffix}`
      try {
        await fs.access(candidate)
      } catch (error) {
        if (isFileMissing(error)) return candidate
        throw error
      }
    }
  }

  private async hasMatchingQuarantine(): Promise<{ exists: true } | { exists: false } | { kind: "error"; error: unknown }> {
    try {
      const base = basename(this.filePath)
      const extension = extname(base)
      const stem = extension ? base.slice(0, -extension.length) : base
      const escapedStem = escapeRegExp(stem)
      const pattern = new RegExp(`^${escapedStem}\\.\\d{8}T\\d{9}Z\\.corrupt(?:\\.\\d+)?$`)
      const entries = await fs.readdir(dirname(this.filePath))
      return { exists: entries.some((entry) => pattern.test(entry)) }
    } catch (error) {
      if (isFileMissing(error)) return { exists: false }
      return { kind: "error", error }
    }
  }

  private async readDocument(path: string): Promise<ReadOutcome<T>> {
    let serialized: string
    try {
      serialized = await fs.readFile(path, "utf8")
    } catch (error) {
      if (isFileMissing(error)) return { kind: "missing" }
      return { kind: "error", error }
    }
    try {
      const parsed: unknown = JSON.parse(serialized)
      const normalized = this.normalize(parsed)
      if (normalized === undefined) return { kind: "corrupt" }
      return { kind: "valid", value: cloneValue(normalized) }
    } catch {
      return { kind: "corrupt" }
    }
  }

  private prepareValue(value: unknown): PreparedValue<T> {
    let normalized: T | undefined
    try {
      normalized = this.normalize(value)
    } catch {
      normalized = undefined
    }
    if (normalized === undefined) throw new StorageBlockedError(this.issue("corrupt"))

    let cloned: T
    try {
      cloned = cloneValue(normalized)
    } catch {
      throw new StorageBlockedError(this.issue("corrupt"))
    }
    let serialized: string
    try {
      const json = JSON.stringify(cloned, null, 2)
      if (typeof json !== "string") throw new Error("not serializable")
      const reparsed: unknown = JSON.parse(json)
      const validated = this.normalize(reparsed)
      if (validated === undefined) throw new Error("not valid")
      const canonical = JSON.stringify(cloneValue(validated), null, 2)
      if (typeof canonical !== "string") throw new Error("not serializable")
      serialized = `${canonical}\n`
      cloned = cloneValue(validated)
    } catch {
      throw new StorageBlockedError(this.issue("corrupt"))
    }
    return { value: cloned, serialized }
  }

  private issue(reason: StorageFailureReason): StorageIssue {
    return { store: this.store, reason, message: safeMessage(reason) }
  }

  private issueFromError(error: unknown, fallback: StorageFailureReason): StorageIssue {
    const code = errorCode(error)
    const reason: StorageFailureReason = code === "EACCES" || code === "EPERM"
      ? "permission"
      : fallback
    return this.issue(reason)
  }

  private operationId(): string {
    let value: string
    try {
      value = String(this.nextOperationId())
    } catch {
      value = `${++operationSequence}`
    }
    const safe = value.replace(/[^a-zA-Z0-9_.-]/g, "-")
    return safe || `${++operationSequence}`
  }

  private temporaryPath(operationId: string, role: string): string {
    return `${this.filePath}.tmp.${process.pid}.${operationId}.${role}`
  }

  private enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const previous = queues.get(this.filePath) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolveCurrent) => { release = resolveCurrent })
    queues.set(this.filePath, current)
    return previous.then(operation).finally(() => {
      release()
      if (queues.get(this.filePath) === current) queues.delete(this.filePath)
    })
  }
}

async function writeTemporaryFile(path: string, serialized: string, mode: number): Promise<void> {
  await fs.writeFile(path, serialized, { encoding: "utf8", mode })
}

async function bestEffortChmod(path: string, mode: number): Promise<void> {
  await fs.chmod(path, mode).catch(() => undefined)
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function cloneLoadResult<T>(result: Exclude<LoadResult<T>, { status: "blocked" }>): Exclude<LoadResult<T>, { status: "blocked" }> {
  if (result.status === "ok") return { status: "ok", value: cloneValue(result.value) }
  if (result.status === "recovered") return { status: "recovered", value: cloneValue(result.value), source: "backup" }
  return { status: "defaulted", value: cloneValue(result.value), reason: result.reason }
}

function loadResultFromHealth<T>(health: Exclude<StorageHealth, { status: "ok" } | { status: "blocked" }>, value: T): Exclude<LoadResult<T>, { status: "blocked" }> {
  if (health.status === "recovered") return { status: "recovered", value: cloneValue(value), source: "backup" }
  return { status: "defaulted", value: cloneValue(value), reason: health.reason }
}

function cloneHealth(health: StorageHealth): StorageHealth {
  if (health.status === "ok") return { store: health.store, status: "ok" }
  if (health.status === "recovered") return { store: health.store, status: "recovered", source: "backup" }
  if (health.status === "defaulted") return { store: health.store, status: "defaulted", reason: health.reason }
  return { store: health.store, status: "blocked", reason: health.reason, message: health.message }
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(".", "").replace("Z", "Z")
}

function safeMessage(reason: StorageFailureReason): string {
  if (reason === "corrupt") return "Stored data is corrupt."
  if (reason === "permission") return "Stored data cannot be accessed due to permissions."
  if (reason === "recovery-failed") return "Stored data recovery failed."
  return "Stored data is unavailable."
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}

function isFileMissing(error: unknown): boolean {
  return errorCode(error) === "ENOENT"
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\[\]\\]/g, "\\$&")
}
