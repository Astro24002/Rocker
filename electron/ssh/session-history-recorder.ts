import { randomUUID } from "node:crypto"
import { runtimeOwnerKey } from "../runtime/owner"
import type { LoadResult } from "../storage/storage-result"
import type { ConnectionHistoryItem } from "../storage/types"
import type { HistoryStore } from "../storage/history-store"
import type { OwnedTerminalSessionEvent } from "./types"

interface HistoryCycle {
  key: string
  sessionId: string
  hostId: string
  id: string
  startedAt: string
  connectedAt?: string
  durationMs: number
  activeSince?: number
  lastChannelGeneration: number
  outcome: ConnectionHistoryItem["outcome"]
  endedAt?: string
  endReason?: ConnectionHistoryItem["endReason"]
  suppressed: boolean
  persisted: boolean
  evicted: boolean
}

export interface SessionHistoryRecorderOptions {
  now?: () => Date
  monotonicNow?: () => number
  checkpointIntervalMs?: number
  onError?: (error: unknown) => void
}

export class SessionHistoryRecorder {
  private readonly cycles = new Map<string, HistoryCycle>()
  private readonly now: () => Date
  private readonly monotonicNow: () => number
  private readonly checkpointIntervalMs: number
  private readonly onError?: (error: unknown) => void
  private writeTail: Promise<void> = Promise.resolve()
  private checkpointTimer?: ReturnType<typeof setInterval>

  public constructor(private readonly store: HistoryStore, options: SessionHistoryRecorderOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.monotonicNow = options.monotonicNow ?? (() => performance.now())
    this.checkpointIntervalMs = options.checkpointIntervalMs ?? 15_000
    this.onError = options.onError
  }

  public recordSessionEvent(owned: OwnedTerminalSessionEvent, hostId: string | undefined): void {
    const event = owned.event
    if (event.kind !== "state" || !hostId) return
    const key = `${runtimeOwnerKey(owned.owner)}\u0000${event.sessionId}`
    let cycle = this.cycles.get(key)

    if (cycle && event.channelGeneration < cycle.lastChannelGeneration) return
    const beginsCycle = event.state === "connecting" || event.state === "restoring" || event.state === "reconnecting" ||
      (event.state === "connected" && cycle !== undefined && event.channelGeneration > cycle.lastChannelGeneration)
    if ((!cycle || cycle.endedAt) && beginsCycle) {
      cycle = this.createCycle(key, event.sessionId, hostId, event.channelGeneration)
      this.cycles.set(key, cycle)
    }
    if (!cycle) return
    if (cycle.endedAt) {
      if (event.state === "closing") this.cycles.delete(key)
      return
    }

    cycle.lastChannelGeneration = Math.max(cycle.lastChannelGeneration, event.channelGeneration)
    switch (event.state) {
      case "connecting":
      case "restoring":
        break
      case "connected":
        this.markConnected(cycle)
        break
      case "reconnecting":
        this.pauseConnectedInterval(cycle)
        if (cycle.connectedAt) {
          cycle.outcome = "disconnected"
          this.persistCycle(cycle)
        }
        this.updateCheckpointTimer()
        break
      case "error":
        this.finishCycle(cycle, "failed", "connection-error")
        break
      case "disconnected":
        this.finishCycle(cycle, "disconnected", event.reason === "cancelled"
          ? "cancelled"
          : event.reason === "channel-ended" ? "remote-exit" : "closed")
        break
      case "closing":
        this.finishCycle(cycle, "disconnected", cycle.connectedAt ? "closed" : "cancelled")
        this.cycles.delete(key)
        break
      case "idle":
        break
    }
  }

  public list(): Promise<ConnectionHistoryItem[]> {
    return this.enqueue(async () => overlayActiveCycles(await this.store.list(), this.activeItems()))
  }

  public async loadWithStatus(options: { consumeHealth?: boolean } = {}): Promise<LoadResult<ConnectionHistoryItem[]>> {
    return this.enqueue(async () => overlayLoadResult(await this.store.loadWithStatus(options), this.activeItems()))
  }

  public clear(): Promise<void> {
    for (const cycle of this.cycles.values()) cycle.suppressed = true
    this.updateCheckpointTimer()
    return this.enqueue(() => this.store.clear())
  }

  public async recoverInterrupted(): Promise<void> {
    await this.store.markInterrupted()
  }

  public async flush(): Promise<void> {
    this.checkpoint()
    await this.writeTail
    this.stopCheckpointTimer()
  }

  private createCycle(key: string, sessionId: string, hostId: string, channelGeneration: number): HistoryCycle {
    return {
      key,
      sessionId,
      hostId,
      id: randomUUID(),
      startedAt: this.now().toISOString(),
      durationMs: 0,
      lastChannelGeneration: channelGeneration,
      outcome: "connected",
      suppressed: false,
      persisted: false,
      evicted: false
    }
  }

  private markConnected(cycle: HistoryCycle): void {
    if (cycle.activeSince !== undefined) return
    cycle.connectedAt ??= this.now().toISOString()
    cycle.activeSince = this.monotonicNow()
    cycle.outcome = "connected"
    cycle.endedAt = undefined
    cycle.endReason = undefined
    this.persistCycle(cycle)
    this.updateCheckpointTimer()
  }

  private pauseConnectedInterval(cycle: HistoryCycle): void {
    if (cycle.activeSince === undefined) return
    cycle.durationMs += Math.max(0, this.monotonicNow() - cycle.activeSince)
    cycle.activeSince = undefined
  }

  private finishCycle(cycle: HistoryCycle, outcome: ConnectionHistoryItem["outcome"], endReason: NonNullable<ConnectionHistoryItem["endReason"]>): void {
    this.pauseConnectedInterval(cycle)
    cycle.outcome = outcome
    cycle.endedAt = this.now().toISOString()
    cycle.endReason = endReason
    if (!cycle.connectedAt) cycle.connectedAt = cycle.startedAt
    this.persistCycle(cycle)
    this.updateCheckpointTimer()
  }

  private checkpoint(): void {
    const cycles = [...this.cycles.values()].filter((cycle) => cycle.activeSince !== undefined && !cycle.suppressed && !cycle.evicted)
    if (cycles.length === 0) return
    const snapshots = cycles.map((cycle) => ({ cycle, item: this.toItem(cycle) }))
    void this.enqueue(async () => {
      const writable = snapshots.filter(({ cycle }) => !cycle.suppressed && !cycle.evicted)
      for (const { cycle, item } of writable.filter(({ cycle }) => !cycle.persisted)) {
        await this.store.upsert(item)
        cycle.persisted = true
      }
      if (writable.length === 0) return
      const updated = new Set(await this.store.updateExistingBatch(writable.map(({ item }) => item)))
      for (const { cycle } of writable) if (!updated.has(cycle.id)) cycle.evicted = true
    }).catch((error: unknown) => this.reportError(error))
  }

  private persistCycle(cycle: HistoryCycle): void {
    if (cycle.suppressed || !cycle.connectedAt || cycle.evicted) return
    const item = this.toItem(cycle)
    void this.enqueue(async () => {
      if (cycle.suppressed || cycle.evicted) return
      if (!cycle.persisted) {
        await this.store.upsert(item)
        cycle.persisted = true
      } else {
        cycle.evicted = !await this.store.updateExisting(cycle.id, item)
      }
    }).catch((error: unknown) => this.reportError(error))
  }

  private toItem(cycle: HistoryCycle): ConnectionHistoryItem {
    return {
      id: cycle.id,
      hostId: cycle.hostId,
      connectedAt: cycle.connectedAt ?? cycle.startedAt,
      durationMs: this.durationMs(cycle),
      outcome: cycle.outcome,
      timingVersion: 1,
      ...(cycle.endedAt ? { endedAt: cycle.endedAt } : {}),
      ...(cycle.endReason ? { endReason: cycle.endReason } : {})
    }
  }

  private durationMs(cycle: HistoryCycle): number {
    const activeDuration = cycle.activeSince === undefined ? 0 : Math.max(0, this.monotonicNow() - cycle.activeSince)
    return Math.round(cycle.durationMs + activeDuration)
  }

  private activeItems(): ConnectionHistoryItem[] {
    return [...this.cycles.values()]
      .filter((cycle) => !cycle.suppressed && !cycle.evicted && cycle.connectedAt !== undefined)
      .map((cycle) => this.toItem(cycle))
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(operation)
    this.writeTail = result.then(() => undefined, () => undefined)
    return result
  }

  private ensureCheckpointTimer(): void {
    if (this.checkpointTimer || this.checkpointIntervalMs <= 0) return
    this.checkpointTimer = setInterval(() => this.checkpoint(), this.checkpointIntervalMs)
    this.checkpointTimer.unref?.()
  }

  private updateCheckpointTimer(): void {
    if ([...this.cycles.values()].some((cycle) => !cycle.suppressed && cycle.activeSince !== undefined)) {
      this.ensureCheckpointTimer()
    } else {
      this.stopCheckpointTimer()
    }
  }

  private stopCheckpointTimer(): void {
    if (!this.checkpointTimer) return
    clearInterval(this.checkpointTimer)
    this.checkpointTimer = undefined
  }

  private reportError(error: unknown): void {
    try {
      this.onError?.(error)
    } catch {
      // History diagnostics must not interrupt SSH session events.
    }
  }
}

function overlayActiveCycles(items: ConnectionHistoryItem[], activeItems: ConnectionHistoryItem[]): ConnectionHistoryItem[] {
  const activeById = new Map(activeItems.map((item) => [item.id, item]))
  const merged = items.map((item) => activeById.get(item.id) ?? item)
  return merged.sort((left, right) => right.connectedAt.localeCompare(left.connectedAt)).slice(0, 200)
}

function overlayLoadResult(
  result: LoadResult<ConnectionHistoryItem[]>,
  activeItems: ConnectionHistoryItem[]
): LoadResult<ConnectionHistoryItem[]> {
  if (result.status === "blocked") return { status: "blocked", issue: { ...result.issue } }
  const value = overlayActiveCycles(result.value, activeItems)
  if (result.status === "recovered") return { status: "recovered", value, source: "backup" }
  if (result.status === "defaulted") return { status: "defaulted", value, reason: result.reason }
  return { status: "ok", value }
}
