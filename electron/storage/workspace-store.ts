import { JsonStore } from "./json-store"
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
  private readonly store: JsonStore<unknown>
  private readonly pendingMutations: PendingMutation[] = []
  private readonly writeDelayMs: number
  private document?: StoredWorkspaceDocument
  private loading?: Promise<void>
  private writeTimer?: ReturnType<typeof setTimeout>
  private writeChain: Promise<void> = Promise.resolve()
  private dirty = false

  public constructor(filePath: string, writeDelayMs = defaultWriteDelayMs) {
    this.store = new JsonStore<unknown>(filePath, defaultDocument)
    this.writeDelayMs = Math.max(0, Math.floor(writeDelayMs))
  }

  public async load(): Promise<StoredWorkspaceDocument> {
    await this.ensureLoaded()
    return structuredClone(this.document!)
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
    await this.ensureLoaded()
    if (!this.dirty) return
    const document = structuredClone(this.document!)
    this.dirty = false
    const nextWrite = this.writeChain.catch(() => undefined).then(() => this.store.write(document))
    this.writeChain = nextWrite
    await nextWrite
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loading) {
      this.loading = this.readDocument()
    }
    await this.loading
  }

  private async readDocument(): Promise<void> {
    try {
      this.document = normalizeDocument(await this.store.read())
    } catch {
      this.document = structuredClone(defaultDocument)
    }
    for (const mutation of this.pendingMutations.splice(0)) mutation(this.document)
  }
}

function normalizeDocument(value: unknown): StoredWorkspaceDocument {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.windows)) return structuredClone(defaultDocument)
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
