import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { JsonHostKeyStore } from "./host-key-store"

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("JsonHostKeyStore", () => {
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
