import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { HistoryStore } from "../electron/storage/history-store"

const temporaryPaths: string[] = []

afterEach(async () => Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("connection history", () => {
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
