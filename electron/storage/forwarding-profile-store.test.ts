import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ForwardingProfileStore, normalizeForwardingDocument, normalizeForwardingProfile } from "./forwarding-profile-store"
import type { ForwardingProfile } from "./types"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const profileA: ForwardingProfile = {
  id: "profile-a",
  hostId: "host-a",
  name: "Dashboard",
  description: "Local dashboard",
  localAddress: "127.0.0.1",
  localPort: 3000,
  remoteAddress: "127.0.0.1",
  remotePort: 3000,
  autoStart: false,
  createdAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z"
}

const profileB: ForwardingProfile = {
  ...profileA,
  id: "profile-b",
  hostId: "host-b",
  name: "API",
  localPort: 8080,
  remotePort: 8080
}

describe("forwarding profile normalization", () => {
  it("normalizes valid fields and rejects malformed profiles", () => {
    expect(normalizeForwardingProfile({ ...profileA, description: "  Local dashboard  " })).toEqual({
      ...profileA,
      description: "Local dashboard"
    })
    expect(normalizeForwardingProfile({ ...profileA, localPort: 0 })).toBeUndefined()
    expect(normalizeForwardingProfile({ ...profileA, localAddress: "192.168.1.1" })).toBeUndefined()
    expect(normalizeForwardingProfile({ ...profileA, name: "" })).toBeUndefined()
  })

  it("keeps valid records while dropping malformed records", () => {
    expect(normalizeForwardingDocument({
      version: 1,
      profiles: [profileA, { hostId: "", localPort: 0 }]
    })).toEqual({ version: 1, profiles: [profileA] })
  })
})

describe("ForwardingProfileStore", () => {
  it("filters by Host and persists replacement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-forwarding-profiles-"))
    temporaryDirectories.push(directory)
    const filePath = join(directory, "forwarding-profiles.json")
    const store = new ForwardingProfileStore(filePath)

    await store.save(profileA)
    await store.save(profileB)

    await expect(store.list("host-a")).resolves.toEqual([profileA])
    await store.replace([profileB])
    await store.flush()
    await expect(new ForwardingProfileStore(filePath).list()).resolves.toEqual([profileB])
  })

  it("loads a document and exposes an idempotent remove", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-forwarding-profiles-load-"))
    temporaryDirectories.push(directory)
    const filePath = join(directory, "forwarding-profiles.json")
    await writeFile(filePath, JSON.stringify({ version: 1, profiles: [profileA] }), "utf8")
    const store = new ForwardingProfileStore(filePath)

    await expect(store.get("profile-a")).resolves.toEqual(profileA)
    await store.remove("profile-a")
    await store.remove("profile-a")
    await store.flush()
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({ version: 1, profiles: [] })
  })
})
