import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { HistoryStore } from "../electron/storage/history-store"

const temporaryPaths: string[] = []

afterEach(async () => Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("connection history", () => {
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
})
