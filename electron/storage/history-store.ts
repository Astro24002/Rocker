import type { ConnectionHistoryItem } from "./types"
import { JsonStore } from "./json-store"
import { StorageBlockedError, type LoadResult, type StorageDiagnosticSink } from "./storage-result"

interface HistoryDocument {
  items: ConnectionHistoryItem[]
}

export class HistoryStore {
  private readonly store: JsonStore<HistoryDocument>

  public constructor(filePath: string, onDiagnostic?: StorageDiagnosticSink) {
    this.store = new JsonStore({
      filePath,
      store: "history",
      defaultValue: { items: [] },
      recovery: "default",
      normalize: normalizeHistoryDocument,
      onDiagnostic
    })
  }

  public async loadWithStatus(options: { consumeHealth?: boolean } = {}): Promise<LoadResult<ConnectionHistoryItem[]>> {
    return mapLoadResult(await this.store.load(options), (document) => document.items)
  }

  public async list(): Promise<ConnectionHistoryItem[]> {
    const result = await this.loadWithStatus()
    if (result.status === "blocked") throw new StorageBlockedError(result.issue)
    return [...result.value].sort((left, right) => right.connectedAt.localeCompare(left.connectedAt))
  }

  public async add(item: ConnectionHistoryItem): Promise<void> {
    await this.upsert(item)
  }

  public async upsert(item: ConnectionHistoryItem): Promise<void> {
    const normalized = normalizeHistoryItem(item)
    if (!normalized) return
    await this.store.update((document) => ({
      items: [normalized, ...document.items.filter((candidate) => candidate.id !== normalized.id)]
        .sort((left, right) => right.connectedAt.localeCompare(left.connectedAt))
        .slice(0, 200)
    }))
  }

  public async updateExisting(id: string, item: ConnectionHistoryItem): Promise<boolean> {
    if (item.id !== id) return false
    return (await this.updateExistingBatch([item])).includes(id)
  }

  public async updateExistingBatch(items: ConnectionHistoryItem[]): Promise<string[]> {
    const replacements = new Map(items.flatMap((item) => {
      const normalized = normalizeHistoryItem(item)
      return normalized ? [[normalized.id, normalized] as const] : []
    }))
    const updated: string[] = []
    await this.store.update((document) => ({
      items: document.items.map((item) => {
        const replacement = replacements.get(item.id)
        if (!replacement) return item
        updated.push(item.id)
        return replacement
      })
    }))
    return updated
  }

  public async markInterrupted(): Promise<void> {
    if (!(await this.list()).some(isIncomplete)) return
    await this.store.update((document) => ({
      items: document.items.map((item) => isIncomplete(item)
        ? { ...item, outcome: "disconnected", endReason: "interrupted" }
        : item)
    }))
  }

  public async clear(): Promise<void> {
    await this.store.update(() => ({ items: [] }))
  }
}

function isIncomplete(item: ConnectionHistoryItem): boolean {
  return item.timingVersion === 1 && item.endedAt === undefined && item.endReason === undefined && item.outcome !== "failed"
}

export function normalizeHistoryDocument(value: unknown): HistoryDocument | undefined {
  if (!isRecord(value) || !Array.isArray(value.items)) return undefined
  const items = value.items.map(normalizeHistoryItem)
  if (items.some((item): item is undefined => item === undefined)) return undefined
  return { items: items.filter((item): item is ConnectionHistoryItem => item !== undefined).slice(0, 200) }
}

function normalizeHistoryItem(value: unknown): ConnectionHistoryItem | undefined {
  if (!isRecord(value)) return undefined
  if (!isBoundedString(value.id, 128) || !isBoundedString(value.hostId, 128) || !isBoundedString(value.connectedAt, 80)) return undefined
  if (!isFiniteNumber(value.durationMs) || value.durationMs < 0) return undefined
  if (value.outcome !== "connected" && value.outcome !== "failed" && value.outcome !== "disconnected") return undefined
  if (value.timingVersion !== undefined && value.timingVersion !== 1) return undefined
  if (value.timingVersion === 1 && !Number.isFinite(Date.parse(value.connectedAt))) return undefined
  if (value.endedAt !== undefined && (!isBoundedString(value.endedAt, 80) || !Number.isFinite(Date.parse(value.endedAt)))) return undefined
  if (value.endReason !== undefined && value.endReason !== "closed" && value.endReason !== "remote-exit" &&
    value.endReason !== "connection-error" && value.endReason !== "cancelled" && value.endReason !== "interrupted") return undefined
  return {
    id: value.id,
    hostId: value.hostId,
    connectedAt: value.connectedAt,
    durationMs: value.durationMs,
    outcome: value.outcome,
    ...(value.timingVersion === 1 ? { timingVersion: 1 as const } : {}),
    ...(typeof value.endedAt === "string" ? { endedAt: value.endedAt } : {}),
    ...(typeof value.endReason === "string" ? { endReason: value.endReason as ConnectionHistoryItem["endReason"] } : {})
  }
}

function mapLoadResult<T, U>(result: LoadResult<T>, map: (value: T) => U): LoadResult<U> {
  if (result.status === "blocked") return { status: "blocked", issue: { ...result.issue } }
  if (result.status === "ok") return { status: "ok", value: map(result.value) }
  if (result.status === "recovered") return { status: "recovered", value: map(result.value), source: "backup" }
  return { status: "defaulted", value: map(result.value), reason: result.reason }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}
