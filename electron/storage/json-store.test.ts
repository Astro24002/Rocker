import * as fs from "node:fs/promises"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { JsonStore } from "./json-store"
import { StorageBlockedError, type LoadResult } from "./storage-result"

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...original,
    rename: vi.fn(original.rename),
    writeFile: vi.fn(original.writeFile)
  }
})

interface Counter {
  count: number
}

const temporaryDirectories: string[] = []
const fixedDate = new Date("2026-08-31T14:25:30.123Z")
const writeFileMock = vi.mocked(fs.writeFile)
const renameMock = vi.mocked(fs.rename)
const defaultWriteFile = writeFileMock.getMockImplementation()!
const defaultRename = renameMock.getMockImplementation()!

afterEach(async () => {
  writeFileMock.mockClear().mockImplementation(defaultWriteFile)
  renameMock.mockClear().mockImplementation(defaultRename)
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("JsonStore", () => {
  it("serializes 25 concurrent updates without losing mutations", async () => {
    const filePath = await temporaryFilePath()
    const store = createCounterStore(filePath)

    await Promise.all(Array.from({ length: 25 }, () => store.update((current) => ({ count: current.count + 1 }))))

    expect(await store.read()).toEqual({ count: 25 })
  })

  it("uses unique same-directory temporary names for each atomic operation", async () => {
    const directory = await temporaryDirectory()
    const filePath = join(directory, "counter.json")
    const store = createCounterStore(filePath)

    await store.write({ count: 1 })
    await store.write({ count: 2 })

    const temporaryNames = writeFileMock.mock.calls
      .map(([candidate]) => candidate)
      .filter((candidate): candidate is string => typeof candidate === "string" && candidate.includes(".tmp."))
    expect(temporaryNames.length).toBeGreaterThanOrEqual(3)
    expect(new Set(temporaryNames).size).toBe(temporaryNames.length)
    expect(temporaryNames.every((path) => dirname(path) === directory)).toBe(true)
    expect((await readdir(directory)).filter((name) => name.includes(".tmp.")).length).toBe(0)
  })

  it("creates a backup on the first successful write", async () => {
    const filePath = await temporaryFilePath()
    const store = createCounterStore(filePath)

    await store.write({ count: 7 })

    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({ count: 7 })
    expect(JSON.parse(await readFile(`${filePath}.bak`, "utf8"))).toEqual({ count: 7 })
  })

  it("recovers a corrupt primary from a valid backup and latches health", async () => {
    const filePath = await temporaryFilePath()
    await writeFile(filePath, "{primary is corrupt", "utf8")
    await writeFile(`${filePath}.bak`, JSON.stringify({ count: 11 }), "utf8")
    const store = createCounterStore(filePath)

    const result = await store.load()

    expect(result).toEqual({ status: "recovered", value: { count: 11 }, source: "backup" })
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({ count: 11 })
    expect(store.health()).toEqual({ store: "settings", status: "recovered", source: "backup" })
    expect(await store.load({ consumeHealth: true })).toEqual(result)
    expect(store.health()).toEqual({ store: "settings", status: "ok" })
  })

  it("quarantines a corrupt primary and defaults an unprotected store", async () => {
    const filePath = await temporaryFilePath()
    const corruptContents = "{not valid json"
    await writeFile(filePath, corruptContents, "utf8")
    const store = createCounterStore(filePath)

    const result = await store.load()

    expect(result).toEqual({ status: "defaulted", value: { count: 0 }, reason: "corrupt" })
    const quarantinePath = await findQuarantine(filePath)
    expect(await readFile(quarantinePath, "utf8")).toBe(corruptContents)
    expect(store.health()).toEqual({ store: "settings", status: "defaulted", reason: "corrupt" })
  })

  it("preserves an invalid backup while defaulting a corrupt primary", async () => {
    const filePath = await temporaryFilePath()
    const invalidBackup = "{backup is also corrupt"
    await writeFile(filePath, "{primary is corrupt", "utf8")
    await writeFile(`${filePath}.bak`, invalidBackup, "utf8")
    const store = createCounterStore(filePath)

    expect(await store.load()).toEqual({ status: "defaulted", value: { count: 0 }, reason: "corrupt" })
    expect(await readFile(`${filePath}.bak`, "utf8")).toBe(invalidBackup)
  })

  it("blocks a protected corrupt store and keeps it blocked after recreation", async () => {
    const filePath = await temporaryFilePath()
    await writeFile(filePath, "{primary is corrupt", "utf8")
    const store = createCounterStore(filePath, "blocked")

    const firstResult = await store.load()

    expect(firstResult).toMatchObject({ status: "blocked", issue: { store: "settings", reason: "corrupt" } })
    expect(store.health()).toMatchObject({ store: "settings", status: "blocked", reason: "corrupt" })
    await expect(store.read()).rejects.toBeInstanceOf(StorageBlockedError)

    const recreated = createCounterStore(filePath, "blocked")
    expect(await recreated.load()).toMatchObject({ status: "blocked", issue: { reason: "corrupt" } })

    await writeFile(filePath, JSON.stringify({ count: 19 }), "utf8")
    expect(await recreated.load()).toEqual({ status: "ok", value: { count: 19 } })
    expect(recreated.health()).toEqual({ store: "settings", status: "ok" })
  })

  it("defaults a missing protected store only when no quarantine exists", async () => {
    const filePath = await temporaryFilePath()
    const store = createCounterStore(filePath, "blocked")

    expect(await store.load()).toEqual({ status: "defaulted", value: { count: 0 }, reason: "missing" })
    expect(store.health()).toEqual({ store: "settings", status: "ok" })
  })

  it("adds a suffix when a quarantine timestamp collides", async () => {
    const filePath = await temporaryFilePath()
    const stem = basename(filePath, ".json")
    const timestamp = "20260831T142530123Z"
    const firstQuarantine = join(dirname(filePath), `${stem}.${timestamp}.corrupt`)
    await writeFile(firstQuarantine, "older corrupt data", "utf8")
    await writeFile(filePath, "new corrupt data", "utf8")
    const store = createCounterStore(filePath)

    await store.load()

    const names = (await readdir(dirname(filePath))).filter((name) => name.startsWith(`${stem}.${timestamp}.corrupt`))
    expect(names).toContain(`${stem}.${timestamp}.corrupt`)
    expect(names).toContain(`${stem}.${timestamp}.corrupt.1`)
    expect(await readFile(join(dirname(filePath), `${stem}.${timestamp}.corrupt.1`), "utf8")).toBe("new corrupt data")
  })

  it("returns a safe blocked result when quarantining fails", async () => {
    const filePath = await temporaryFilePath()
    await writeFile(filePath, "{primary is corrupt", "utf8")
    renameMock.mockImplementation(async (source, destination) => {
      if (source === filePath && typeof destination === "string" && destination.endsWith(".corrupt")) {
        throw withCode("EACCES")
      }
      return defaultRename(source, destination)
    })
    const store = createCounterStore(filePath)

    const result = await store.load()

    expect(result).toMatchObject({ status: "blocked", issue: { store: "settings", reason: "permission" } })
    expect((result as Extract<LoadResult<Counter>, { status: "blocked" }>).issue.message).not.toContain(filePath)
    expect(await readFile(filePath, "utf8")).toBe("{primary is corrupt")
  })

  it("reports a safe blocked error when the final atomic rename fails", async () => {
    const filePath = await temporaryFilePath()
    await writeFile(filePath, JSON.stringify({ count: 1 }), "utf8")
    renameMock.mockImplementation(async (source, destination) => {
      if (destination === filePath && typeof source === "string" && source.includes(".tmp.")) {
        throw withCode("EIO")
      }
      return defaultRename(source, destination)
    })
    const store = createCounterStore(filePath)

    await expect(store.write({ count: 2 })).rejects.toMatchObject({
      name: "StorageBlockedError",
      issue: { store: "settings", reason: "unavailable" }
    })
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({ count: 1 })
  })
})

function createCounterStore(filePath: string, recovery: "default" | "blocked" = "default"): JsonStore<Counter> {
  let operation = 0
  return new JsonStore({
    filePath,
    store: "settings",
    defaultValue: { count: 0 },
    recovery,
    normalize: normalizeCounter,
    clock: () => fixedDate,
    nextOperationId: () => `test-${++operation}`
  })
}

function normalizeCounter(value: unknown): Counter | undefined {
  if (typeof value !== "object" || value === null || !("count" in value)) return undefined
  const count = value.count
  return typeof count === "number" && Number.isInteger(count) && count >= 0 ? { count } : undefined
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rocker-json-store-"))
  temporaryDirectories.push(directory)
  return directory
}

async function temporaryFilePath(): Promise<string> {
  return join(await temporaryDirectory(), "counter.json")
}

async function findQuarantine(filePath: string): Promise<string> {
  const stem = basename(filePath, ".json")
  const name = (await readdir(dirname(filePath))).find((candidate) => candidate.startsWith(`${stem}.`) && candidate.includes(".corrupt"))
  if (!name) throw new Error("expected quarantine file")
  return join(dirname(filePath), name)
}

function withCode(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException
  error.code = code
  return error
}
