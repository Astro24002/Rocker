import { JsonStore } from "./json-store"
import { StorageBlockedError, type LoadResult, type StorageHealth } from "./storage-result"
import type {
  StoredTerminalLayout,
  StoredWorkspaceDocument,
  StoredWorkspaceSession,
  StoredWorkspaceWindow
} from "./types"

const defaultDocument: StoredWorkspaceDocument = { version: 1, windows: [] }
const defaultWriteDelayMs = 100
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type PendingMutation = (document: StoredWorkspaceDocument) => void

export class WorkspaceSnapshotStore {
  private readonly store: JsonStore<StoredWorkspaceDocument>
  private readonly pendingMutations: PendingMutation[] = []
  private readonly writeDelayMs: number
  private document?: StoredWorkspaceDocument
  private loading?: Promise<LoadResult<StoredWorkspaceDocument>>
  private writeTimer?: ReturnType<typeof setTimeout>
  private writeChain: Promise<void> = Promise.resolve()
  private dirty = false

  public constructor(filePath: string, writeDelayMs = defaultWriteDelayMs) {
    this.store = new JsonStore({
      filePath,
      store: "workspace",
      defaultValue: defaultDocument,
      recovery: "default",
      normalize: normalizeDocument
    })
    this.writeDelayMs = Math.max(0, Math.floor(writeDelayMs))
  }

  public async load(): Promise<StoredWorkspaceDocument> {
    const result = await this.loadWithStatus()
    if (result.status === "blocked") throw new StorageBlockedError(result.issue)
    return structuredClone(result.value)
  }

  public async loadWithStatus(options: { consumeHealth?: boolean; reload?: boolean } = {}): Promise<LoadResult<StoredWorkspaceDocument>> {
    const result = await this.ensureLoaded(options.reload === true, true, options.consumeHealth === true)
    if (result.status === "blocked") return cloneLoadResult(result)
    const current = structuredClone(this.document ?? result.value)
    if (options.consumeHealth && result.status !== "ok" && options.reload !== true) {
      const consumed = await this.store.load({ consumeHealth: true })
      if (consumed.status === "blocked") return cloneLoadResult(consumed)
    }
    return withValue(result, current)
  }

  public saveWindow(window: StoredWorkspaceWindow): void {
    const normalized = normalizeWindow(window)
    if (!normalized) return
    this.mutate((document) => {
      const index = document.windows.findIndex((candidate) => candidate.workspaceId === normalized.workspaceId)
      if (index === -1) document.windows.push(normalized)
      else document.windows[index] = normalized
    })
  }

  public removeWindow(workspaceId: string): void {
    if (!isUuid(workspaceId)) return
    this.mutate((document) => {
      document.windows = document.windows.filter((window) => window.workspaceId !== workspaceId)
    })
  }

  public updateWindowBounds(
    workspaceId: string,
    update: Pick<StoredWorkspaceWindow, "bounds" | "maximized">
  ): void {
    if (!isUuid(workspaceId)) return
    const bounds = normalizeBounds(update.bounds)
    if (!bounds) return
    this.mutate((document) => {
      const index = document.windows.findIndex((window) => window.workspaceId === workspaceId)
      if (index === -1) return
      document.windows[index] = {
        ...document.windows[index],
        bounds,
        maximized: update.maximized === true
      }
    })
  }

  public async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = undefined
    }
    await this.writeNow()
    await this.writeChain
    if (this.dirty) await this.flush()
  }

  private mutate(mutation: PendingMutation): void {
    if (this.store.health().status === "blocked") return
    if (this.document) mutation(this.document)
    else this.pendingMutations.push(mutation)
    this.dirty = true
    this.scheduleWrite()
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined
      void this.writeNow().catch(() => undefined)
    }, this.writeDelayMs)
  }

  private async writeNow(): Promise<void> {
    const loaded = await this.ensureLoaded(false, false)
    if (loaded.status === "blocked") throw new StorageBlockedError(loaded.issue)
    if (!this.dirty) return
    const document = structuredClone(this.document!)
    this.dirty = false
    const nextWrite = this.writeChain.catch(() => undefined).then(() => this.store.write(document))
    this.writeChain = nextWrite
    await nextWrite
  }

  private async ensureLoaded(
    reload = false,
    schedulePendingWrite = true,
    consumeHealth = false
  ): Promise<LoadResult<StoredWorkspaceDocument>> {
    if (!reload && this.document) return loadResultFromHealth(this.store.health(), this.document)
    if (reload) this.loading = undefined
    if (!this.loading) this.loading = this.readDocument(reload, consumeHealth)
    const loading = this.loading
    const result = await loading
    if (result.status === "blocked") {
      if (this.loading === loading) this.loading = undefined
      return result
    }
    this.document = structuredClone(result.value)
    for (const mutation of this.pendingMutations.splice(0)) mutation(this.document)
    if (schedulePendingWrite && this.dirty) this.scheduleWrite()
    return withValue(result, this.document)
  }

  private async readDocument(reload: boolean, consumeHealth: boolean): Promise<LoadResult<StoredWorkspaceDocument>> {
    if (!reload) return this.store.load()
    const first = await this.store.load({ consumeHealth })
    if (first.status !== "defaulted" || first.reason !== "corrupt") return first
    const refreshed = await this.store.load({ consumeHealth })
    return refreshed
  }
}

export function normalizeDocument(value: unknown): StoredWorkspaceDocument | undefined {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.windows)) return undefined
  return {
    version: 1,
    windows: value.windows.map(normalizeWindow).filter((window): window is StoredWorkspaceWindow => window !== undefined)
  }
}

function normalizeWindow(value: unknown): StoredWorkspaceWindow | undefined {
  if (!isRecord(value) || !isUuid(value.workspaceId) || !Array.isArray(value.sessions)) return undefined
  const sessions = value.sessions
    .map(normalizeSession)
    .filter((session): session is StoredWorkspaceSession => session !== undefined)
  const sessionIds = new Set(sessions.map((session) => session.sessionId))
  const activeSessionId = isUuid(value.activeSessionId) && sessionIds.has(value.activeSessionId) ? value.activeSessionId : undefined
  const layout = normalizeLayout(value.layout, sessionIds)
  if (value.layout !== undefined && !layout) return undefined
  const window: StoredWorkspaceWindow = {
    workspaceId: value.workspaceId,
    maximized: value.maximized === true,
    sessions
  }
  const bounds = normalizeBounds(value.bounds)
  if (bounds) window.bounds = bounds
  if (activeSessionId) window.activeSessionId = activeSessionId
  if (layout) window.layout = layout
  return window
}

function normalizeSession(value: unknown): StoredWorkspaceSession | undefined {
  if (!isRecord(value) || !isUuid(value.sessionId) || !isBoundedString(value.hostId, 128) || !isBoundedString(value.label, 128)) {
    return undefined
  }
  if (!isDimension(value.cols) || !isDimension(value.rows)) return undefined
  return {
    sessionId: value.sessionId,
    hostId: value.hostId,
    label: value.label,
    cols: value.cols,
    rows: value.rows
  }
}

function normalizeLayout(value: unknown, sessionIds: Set<string>): StoredTerminalLayout | undefined {
  if (!isRecord(value)) return undefined
  if (value.kind === "leaf") {
    return isUuid(value.sessionId) && sessionIds.has(value.sessionId)
      ? { kind: "leaf", sessionId: value.sessionId }
      : undefined
  }
  if (value.kind !== "split" || value.direction !== "horizontal") return undefined
  const first = normalizeLayout(value.first, sessionIds)
  const second = normalizeLayout(value.second, sessionIds)
  if (!first || !second) return undefined
  return {
    kind: "split",
    direction: "horizontal",
    ratio: clampRatio(value.ratio),
    first,
    second
  }
}

function normalizeBounds(value: unknown): StoredWorkspaceWindow["bounds"] | undefined {
  if (!isRecord(value) || !isFiniteInteger(value.x) || !isFiniteInteger(value.y) || !isFiniteInteger(value.width) || !isFiniteInteger(value.height)) {
    return undefined
  }
  if (value.width < 1 || value.height < 1 || value.width > 10_000 || value.height > 10_000) return undefined
  return { x: value.x, y: value.y, width: value.width, height: value.height }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value)
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
}

function isDimension(value: unknown): value is number {
  return isFiniteInteger(value) && value > 0 && value <= 1_000
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value)
}

function clampRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.5
  return Math.max(0.2, Math.min(0.8, value))
}

function withValue<T>(result: LoadResult<T>, value: T): LoadResult<T> {
  if (result.status === "ok") return { status: "ok", value: structuredClone(value) }
  if (result.status === "recovered") return { status: "recovered", value: structuredClone(value), source: "backup" }
  if (result.status === "defaulted") return { status: "defaulted", value: structuredClone(value), reason: result.reason }
  return { status: "blocked", issue: { ...result.issue } }
}

function cloneLoadResult<T>(result: LoadResult<T>): LoadResult<T> {
  if (result.status === "blocked") return { status: "blocked", issue: { ...result.issue } }
  return withValue(result, result.value)
}

function loadResultFromHealth<T>(health: StorageHealth, value: T): LoadResult<T> {
  if (health.status === "blocked") {
    return { status: "blocked", issue: { store: health.store, reason: health.reason, message: health.message } }
  }
  if (health.status === "recovered") return { status: "recovered", value: structuredClone(value), source: "backup" }
  if (health.status === "defaulted") return { status: "defaulted", value: structuredClone(value), reason: health.reason }
  return { status: "ok", value: structuredClone(value) }
}
