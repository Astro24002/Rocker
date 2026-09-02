import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { JsonHostKeyStore } from "./host-key-store"
import type { HostKeyStore } from "./host-keys"

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("JsonHostKeyStore", () => {
  it("blocks malformed protected Host Key storage and exposes health without values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-host-key-store-"))
    temporaryPaths.push(directory)
    const filePath = join(directory, "host-keys.json")
    await writeFile(filePath, JSON.stringify({ fingerprints: "invalid" }), "utf8")

    const store: HostKeyStore = new JsonHostKeyStore(filePath)
    if (!store.health) throw new Error("Host Key store health API is missing")
    const health = await store.health()

    expect(health).toMatchObject({ store: "hostKeys", status: "blocked", reason: "corrupt" })
    expect(JSON.stringify(health)).not.toContain("fingerprint")
  })

  it("serializes concurrent replacement confirmations against the stored fingerprint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-host-key-store-"))
    temporaryPaths.push(directory)
    const store = new JsonHostKeyStore(join(directory, "host-keys.json"))
    await store.trust("host.example", 22, "old-fingerprint")

    const firstReplacement = store.replace("host.example", 22, "old-fingerprint", "new-fingerprint-a")
    const secondReplacement = store.replace("host.example", 22, "old-fingerprint", "new-fingerprint-b")

    await expect(firstReplacement).resolves.toBeUndefined()
    await expect(secondReplacement).rejects.toThrow("Host Key changed while awaiting replacement confirmation")
    await expect(store.get("host.example", 22)).resolves.toBe("new-fingerprint-a")
  })

  it("serializes replacements from equivalent backing-file paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-host-key-store-"))
    temporaryPaths.push(directory)
    const filePath = join(directory, "host-keys.json")
    const absoluteStore = new JsonHostKeyStore(filePath)
    const relativeStore = new JsonHostKeyStore(relative(process.cwd(), filePath))
    await absoluteStore.trust("host.example", 22, "old-fingerprint")

    const firstReplacement = absoluteStore.replace("host.example", 22, "old-fingerprint", "new-fingerprint-a")
    const secondReplacement = relativeStore.replace("host.example", 22, "old-fingerprint", "new-fingerprint-b")

    await expect(firstReplacement).resolves.toBeUndefined()
    await expect(secondReplacement).rejects.toThrow("Host Key changed while awaiting replacement confirmation")
    await expect(absoluteStore.get("host.example", 22)).resolves.toBe("new-fingerprint-a")
  })
})
