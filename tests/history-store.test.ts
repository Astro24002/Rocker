import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { HistoryStore, normalizeHistoryDocument } from "../electron/storage/history-store"

const temporaryPaths: string[] = []

afterEach(async () => Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("connection history", () => {
  it.each([
    { timingVersion: 2 }, { endedAt: "not-a-date" }, { endReason: "invented" },
    { timingVersion: 1, connectedAt: "not-a-date" }
  ])("rejects malformed timing metadata %j", (metadata) => {
    expect(normalizeHistoryDocument({ items: [{ id: "item", hostId: "host", connectedAt: "2026-10-27T00:00:00Z", durationMs: 0, outcome: "connected", ...metadata }] })).toBeUndefined()
  })

  it("recovers timing fields from backup and preserves the recovery health report", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-history-backup-"))
    temporaryPaths.push(directory)
    const path = join(directory, "history.json")
    const item = { id: "item", hostId: "host", connectedAt: "2026-10-27T00:00:00Z", durationMs: 15_000, outcome: "connected", timingVersion: 1 }
    await writeFile(path, "invalid")
    await writeFile(`${path}.bak`, JSON.stringify({ items: [item] }))
    const store = new HistoryStore(path)
    await store.markInterrupted()
    expect(await store.loadWithStatus({ consumeHealth: true })).toMatchObject({ status: "recovered", value: [{ ...item, outcome: "disconnected", endReason: "interrupted" }] })
  })
  it("reports malformed top-level history as a defaulted load", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-history-"))
    temporaryPaths.push(directory)
    const path = join(directory, "history.json")
    await writeFile(path, JSON.stringify({ items: "invalid" }), "utf8")

    expect(await new HistoryStore(path).loadWithStatus()).toEqual({
      status: "defaulted",
      value: [],
      reason: "corrupt"
    })
  })

  it("serializes concurrent history additions without losing records", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-history-"))
    temporaryPaths.push(directory)
    const store = new HistoryStore(join(directory, "history.json"))
    const items = Array.from({ length: 25 }, (_, index) => ({
      id: `item-${index}`,
      hostId: "host",
      connectedAt: `2026-08-17T10:${String(index).padStart(2, "0")}:00.000Z`,
      durationMs: index,
      outcome: "connected" as const
    }))

    await Promise.all(items.map((item) => store.add(item)))

    const persistedIds = (await store.list()).map((item) => item.id)
    expect(persistedIds).toHaveLength(items.length)
    expect(new Set(persistedIds)).toEqual(new Set(items.map((item) => item.id)))
  })

  it("stores newest records first and clears them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-history-"))
    temporaryPaths.push(directory)
    const store = new HistoryStore(join(directory, "history.json"))
    await store.add({ id: "one", hostId: "a", connectedAt: "2026-08-17T10:00:00.000Z", durationMs: 10, outcome: "connected" })
    await store.add({ id: "two", hostId: "b", connectedAt: "2026-08-17T11:00:00.000Z", durationMs: 20, outcome: "failed" })

    expect((await store.list()).map((item) => item.id)).toEqual(["two", "one"])
    await store.clear()
    expect(await store.list()).toEqual([])
  })

  it("updates an existing record without reinserting an evicted or cleared row", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-history-"))
    temporaryPaths.push(directory)
    const store = new HistoryStore(join(directory, "history.json"))
    const item = { id: "one", hostId: "a", connectedAt: "2026-08-17T10:00:00.000Z", durationMs: 0, outcome: "connected" as const, timingVersion: 1 as const }

    expect(await store.updateExisting(item.id, { ...item, durationMs: 1_000 })).toBe(false)
    await store.upsert(item)
    expect(await store.updateExisting(item.id, { ...item, durationMs: 1_000 })).toBe(true)
    await store.clear()
    expect(await store.updateExisting(item.id, { ...item, durationMs: 2_000 })).toBe(false)
    expect(await store.list()).toEqual([])
  })

  it("reads new timing metadata and keeps legacy items compatible", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-history-"))
    temporaryPaths.push(directory)
    const store = new HistoryStore(join(directory, "history.json"))
    await store.add({ id: "legacy", hostId: "a", connectedAt: "2026-08-17T10:00:00.000Z", durationMs: 0, outcome: "connected" })
    await store.add({
      id: "timed",
      hostId: "a",
      connectedAt: "2026-08-17T11:00:00.000Z",
      durationMs: 1_000,
      outcome: "disconnected",
      timingVersion: 1,
      endReason: "closed",
      endedAt: "2026-08-17T11:00:01.000Z"
    })

    const items = await store.list()
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "timed", timingVersion: 1, endReason: "closed" }),
      expect.objectContaining({ id: "legacy", outcome: "connected" })
    ]))
    expect(items.find((candidate) => candidate.id === "legacy")).not.toHaveProperty("timingVersion")
  })
})
