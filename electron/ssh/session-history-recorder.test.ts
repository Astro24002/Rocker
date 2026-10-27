import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HistoryStore } from "../storage/history-store"
import type { RuntimeOwner } from "../runtime/owner"
import type { OwnedTerminalSessionEvent, TerminalStateEvent } from "./types"
import { SessionHistoryRecorder } from "./session-history-recorder"

const owner: RuntimeOwner = { webContentsId: 21, rendererGeneration: 1 }
const sessionId = "11111111-1111-4111-8111-111111111111"
const temporaryDirectories: string[] = []

afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("SessionHistoryRecorder", () => {
  it("ignores duplicate connected, final and stale generation events", async () => {
    const clock = createClock()
    const recorder = await createRecorder(clock)
    emit(recorder, sessionId, "connecting", 0)
    emit(recorder, sessionId, "connected", 1)
    clock.advance(10_000)
    emit(recorder, sessionId, "connected", 1)
    emit(recorder, sessionId, "reconnecting", 1)
    clock.advance(5_000)
    emit(recorder, sessionId, "connected", 2)
    emit(recorder, sessionId, "error", 1)
    clock.advance(10_000)
    emit(recorder, sessionId, "disconnected", 2, "channel-ended")
    emit(recorder, sessionId, "connected", 2)
    emit(recorder, sessionId, "closing", 2)
    emit(recorder, sessionId, "closing", 2)
    expect(await recorder.list()).toEqual([expect.objectContaining({ durationMs: 20_000, endReason: "remote-exit" })])
  })

  it("separates renderer generations even when session ids are identical", async () => {
    const recorder = await createRecorder(createClock())
    for (const rendererGeneration of [1, 2]) {
      for (const state of ["connecting", "connected", "closing"] as const) {
        recorder.recordSessionEvent({ owner: { ...owner, rendererGeneration }, event: { kind: "state", sessionId, state, channelGeneration: 1 } }, "host-a")
      }
    }
    expect(await recorder.list()).toHaveLength(2)
  })

  it("suppresses a connecting cycle cleared before its first connected event", async () => {
    const recorder = await createRecorder(createClock())
    emit(recorder, sessionId, "connecting", 0)
    const cleared = recorder.clear()
    emit(recorder, sessionId, "connected", 1)
    emit(recorder, sessionId, "closing", 1)
    await cleared
    expect(await recorder.list()).toEqual([])
  })

  it("records cancellation before authentication separately from a later manual retry", async () => {
    const recorder = await createRecorder(createClock())
    emit(recorder, sessionId, "connecting", 0)
    emit(recorder, sessionId, "disconnected", 0, "cancelled")
    emit(recorder, sessionId, "connecting", 0)
    emit(recorder, sessionId, "connected", 1)
    emit(recorder, sessionId, "closing", 1)
    const items = await recorder.list()
    expect(items).toHaveLength(2)
    expect(items).toContainEqual(expect.objectContaining({ endReason: "cancelled", durationMs: 0, outcome: "disconnected" }))
  })

  it("does not reinsert a still-active row evicted by the 200 item limit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-history-retention-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "history.json")
    const store = new HistoryStore(path)
    const recorder = new SessionHistoryRecorder(store, { checkpointIntervalMs: 0 })
    emit(recorder, sessionId, "connecting", 0)
    emit(recorder, sessionId, "connected", 1)
    const [active] = await recorder.list()
    const newer = Array.from({ length: 200 }, (_, index) => ({ ...active, id: `newer-${index}`, endedAt: active.connectedAt, endReason: "closed" }))
    await writeFile(path, JSON.stringify({ items: newer }))
    emit(recorder, sessionId, "reconnecting", 1)
    emit(recorder, sessionId, "connected", 2)
    expect((await recorder.list()).some((item) => item.id === active.id)).toBe(false)
    emit(recorder, sessionId, "closing", 2)
    expect(await store.list()).toHaveLength(200)
    expect((await store.list()).some((item) => item.id === active.id)).toBe(false)
  })

  it("writes one batched checkpoint while live reads do not write to disk", async () => {
    const store = await createStore()
    const clock = createClock()
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const recorder = new SessionHistoryRecorder(store, { now: clock.date, monotonicNow: clock.monotonic })
    try {
      emit(recorder, sessionId, "connecting", 0)
      emit(recorder, sessionId, "connected", 1)
      emit(recorder, "second", "connecting", 0)
      emit(recorder, "second", "connected", 1)
      await recorder.list()
      const checkpoint = vi.spyOn(store, "updateExistingBatch")
      clock.advance(15_000)
      await recorder.list()
      expect(checkpoint).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(15_000)
      await recorder.list()
      expect(checkpoint).toHaveBeenCalledTimes(1)
      expect(checkpoint.mock.calls[0][0]).toEqual([
        expect.objectContaining({ durationMs: 15_000 }), expect.objectContaining({ durationMs: 15_000 })
      ])
    } finally {
      await recorder.flush()
      vi.useRealTimers()
    }
  })

  it("reports Clear failure to its caller", async () => {
    const store = await createStore()
    vi.spyOn(store, "clear").mockRejectedValue(new Error("permission denied"))
    const recorder = new SessionHistoryRecorder(store)
    await expect(recorder.clear()).rejects.toThrow("permission denied")
  })
  it("counts only connected intervals across automatic reconnects", async () => {
    const clock = createClock()
    const recorder = await createRecorder(clock)
    emit(recorder, sessionId, "connecting", 0)
    emit(recorder, sessionId, "connected", 1)
    clock.advance(30_000)
    emit(recorder, sessionId, "reconnecting", 1)
    clock.advance(10_000)
    emit(recorder, sessionId, "connected", 2)
    clock.advance(20_000)
    emit(recorder, sessionId, "closing", 2)

    const [item] = await recorder.list()
    expect(item).toMatchObject({ durationMs: 50_000, outcome: "disconnected", endReason: "closed", timingVersion: 1 })
    expect(item.endedAt).toBe(clock.date().toISOString())
  })

  it("keeps two sessions on the same Host independent", async () => {
    const clock = createClock()
    const recorder = await createRecorder(clock)
    const secondSessionId = "22222222-2222-4222-8222-222222222222"
    emit(recorder, sessionId, "connecting", 0)
    emit(recorder, sessionId, "connected", 1)
    emit(recorder, secondSessionId, "connecting", 0)
    emit(recorder, secondSessionId, "connected", 1)
    clock.advance(5_000)
    emit(recorder, sessionId, "closing", 1)
    clock.advance(5_000)

    const running = await recorder.list()
    expect(running.find((item) => item.hostId === "host-a" && item.outcome === "connected"))
      .toMatchObject({ durationMs: 10_000, outcome: "connected" })
    emit(recorder, secondSessionId, "closing", 1)
    const finished = await recorder.list()
    expect(finished.map((item) => item.durationMs).sort((left, right) => left - right)).toEqual([5_000, 10_000])
    expect(new Set(finished.map((item) => item.id)).size).toBe(2)
  })

  it("records failed and cancelled attempts separately when a session is retried", async () => {
    const recorder = await createRecorder(createClock())
    emit(recorder, sessionId, "connecting", 0)
    emit(recorder, sessionId, "error", 0, "authentication")
    emit(recorder, sessionId, "connecting", 0)
    emit(recorder, sessionId, "connected", 1)
    emit(recorder, sessionId, "disconnected", 1, "cancelled")

    const items = await recorder.list()
    expect(items).toHaveLength(2)
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: "failed", endReason: "connection-error", durationMs: 0 }),
      expect.objectContaining({ outcome: "disconnected", endReason: "cancelled" })
    ]))
    expect(new Set(items.map((item) => item.id)).size).toBe(2)
  })

  it("does not restore active cycles after Clear and records later cycles", async () => {
    const recorder = await createRecorder(createClock())
    emit(recorder, sessionId, "connecting", 0)
    emit(recorder, sessionId, "connected", 1)
    await recorder.clear()
    emit(recorder, sessionId, "reconnecting", 1)
    emit(recorder, sessionId, "connected", 2)
    emit(recorder, sessionId, "closing", 2)
    expect(await recorder.list()).toEqual([])

    emit(recorder, sessionId, "connecting", 0)
    emit(recorder, sessionId, "connected", 1)
    emit(recorder, sessionId, "closing", 1)
    expect(await recorder.list()).toHaveLength(1)
  })

  it("marks incomplete versioned records interrupted without inventing an end time", async () => {
    const store = await createStore()
    await store.add({
      id: "incomplete",
      hostId: "host-a",
      connectedAt: "2026-10-27T10:00:00.000Z",
      durationMs: 15_000,
      outcome: "connected",
      timingVersion: 1
    })
    const recorder = new SessionHistoryRecorder(store, { checkpointIntervalMs: 0 })
    await recorder.recoverInterrupted()

    const [item] = await recorder.list()
    expect(item).toMatchObject({
      id: "incomplete",
      durationMs: 15_000,
      outcome: "disconnected",
      endReason: "interrupted"
    })
    expect(item).not.toHaveProperty("endedAt")
  })

  it("contains History write failures instead of throwing through session events", async () => {
    const onError = vi.fn()
    const store = {
      upsert: vi.fn().mockRejectedValue(new Error("read only")),
      updateExisting: vi.fn().mockResolvedValue(false),
      clear: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      loadWithStatus: vi.fn().mockResolvedValue({ status: "ok", value: [] }),
      markInterrupted: vi.fn()
    } as unknown as HistoryStore
    const recorder = new SessionHistoryRecorder(store, { checkpointIntervalMs: 0, onError })

    expect(() => emit(recorder, sessionId, "connecting", 0)).not.toThrow()
    expect(() => emit(recorder, sessionId, "connected", 1)).not.toThrow()
    await recorder.flush()
    expect(onError).toHaveBeenCalled()
  })
})

async function createRecorder(clock: ReturnType<typeof createClock>): Promise<SessionHistoryRecorder> {
  return new SessionHistoryRecorder(await createStore(), {
    now: clock.date,
    monotonicNow: clock.monotonic,
    checkpointIntervalMs: 0
  })
}

async function createStore(): Promise<HistoryStore> {
  const directory = await mkdtemp(join(tmpdir(), "rocker-session-history-"))
  temporaryDirectories.push(directory)
  return new HistoryStore(join(directory, "history.json"))
}

function emit(
  recorder: SessionHistoryRecorder,
  id: string,
  state: TerminalStateEvent["state"],
  channelGeneration: number,
  reason?: TerminalStateEvent["reason"]
): void {
  const event: TerminalStateEvent = { kind: "state", sessionId: id, channelGeneration, state, reason }
  const owned: OwnedTerminalSessionEvent = { owner, event }
  recorder.recordSessionEvent(owned, "host-a")
}

function createClock() {
  let wallTime = Date.parse("2026-10-27T10:00:00.000Z")
  let elapsed = 0
  return {
    advance(milliseconds: number): void {
      wallTime += milliseconds
      elapsed += milliseconds
    },
    date: () => new Date(wallTime),
    monotonic: () => elapsed
  }
}
