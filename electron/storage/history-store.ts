import type { ConnectionHistoryItem } from "./types"
import { JsonStore } from "./json-store"
import { StorageBlockedError, type LoadResult } from "./storage-result"

interface HistoryDocument {
  items: ConnectionHistoryItem[]
}

export class HistoryStore {
  private readonly store: JsonStore<HistoryDocument>

  public constructor(filePath: string) {
    this.store = new JsonStore({
      filePath,
      store: "history",
      defaultValue: { items: [] },
      recovery: "default",
      normalize: normalizeHistoryDocument
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
    const normalized = normalizeHistoryItem(item)
    if (!normalized) return
    await this.store.update((document) => ({
      items: [normalized, ...document.items].slice(0, 200)
    }))
  }

  public async clear(): Promise<void> {
    await this.store.update(() => ({ items: [] }))
  }
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
  return {
    id: value.id,
    hostId: value.hostId,
    connectedAt: value.connectedAt,
    durationMs: value.durationMs,
    outcome: value.outcome
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
