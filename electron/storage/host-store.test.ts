import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { HostStore, normalizeHostDocument, normalizeHostProfile } from "./host-store"

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("host profile platform metadata", () => {
  const profile = {
    id: "host-a",
    name: "G11",
    host: "g11.example.test",
    port: 22,
    username: "root",
    authMethod: "agent" as const,
    favorite: false,
    notes: ""
  }

  it("keeps known platform values and ignores unknown values for compatibility", () => {
    expect(normalizeHostProfile({ ...profile, platform: "ubuntu" })).toMatchObject({ platform: "ubuntu" })
    expect(normalizeHostProfile({ ...profile, platform: "plan9" })).not.toHaveProperty("platform")
    expect(normalizeHostProfile(profile)).not.toHaveProperty("platform")
  })

  it("disambiguates legacy duplicate names without changing Host ids", () => {
    const document = normalizeHostDocument({ hosts: [
      profile,
      { ...profile, id: "host-b", name: " g11 " }
    ] })

    expect(document?.hosts.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "host-a", name: "G11" },
      { id: "host-b", name: "g11 (2)" }
    ])
  })
})

describe("host profile editor metadata", () => {
  const profile = {
    id: "host-editor",
    name: "Editor host",
    host: "editor.example.test",
    port: 22,
    username: "root",
    authMethod: "password" as const,
    favorite: false,
    notes: ""
  }

  it("keeps valid optional editor values and applies explicit defaults", () => {
    expect(normalizeHostProfile({
      ...profile,
      publicKeyEnabled: true,
      authMethod: "privateKey",
      identityFile: "/keys/id_ed25519",
      snippetsEnabled: true,
      snippetCollection: "Deployment",
      charset: "gb18030",
      themeColor: "amber"
    })).toMatchObject({
      publicKeyEnabled: true,
      snippetsEnabled: true,
      snippetCollection: "Deployment",
      charset: "gb18030",
      themeColor: "amber"
    })

    expect(normalizeHostProfile(profile)).toMatchObject({ charset: "utf-8", themeColor: "rocker" })
  })

  it("infers public-key login for legacy private-key profiles", () => {
    expect(normalizeHostProfile({ ...profile, authMethod: "privateKey", identityFile: "/keys/id_ed25519" }))
      .toMatchObject({ publicKeyEnabled: true })
  })

  it("falls back to safe defaults and drops malformed optional values", () => {
    const normalized = normalizeHostProfile({
      ...profile,
      publicKeyEnabled: "yes",
      snippetsEnabled: "yes",
      snippetCollection: 42,
      charset: "cp500",
      themeColor: "neon"
    })

    expect(normalized).toMatchObject({ publicKeyEnabled: false, charset: "utf-8", themeColor: "rocker" })
    expect(normalized).not.toHaveProperty("snippetCollection")
  })

  it("drops a public-key flag that conflicts with a non-key authentication method", () => {
    expect(normalizeHostProfile({ ...profile, publicKeyEnabled: true }))
      .toMatchObject({ authMethod: "password", publicKeyEnabled: false })
  })

  it("treats a blank optional group as unset", () => {
    const normalized = normalizeHostProfile({ ...profile, group: "   " })

    expect(normalized).toMatchObject({ id: "host-editor", name: "Editor host" })
    expect(normalized).not.toHaveProperty("group")
  })

  it("treats an empty inactive identity path as unset", () => {
    const normalized = normalizeHostProfile({ ...profile, identityFile: "" })

    expect(normalized).toMatchObject({ authMethod: "password", publicKeyEnabled: false })
    expect(normalized).not.toHaveProperty("identityFile")
  })

  it("normalizes optional environment and tags without creating misleading metadata", () => {
    expect(normalizeHostProfile({
      ...profile,
      environment: "production",
      tags: [" ops ", "Ops", "Linux", ""]
    })).toMatchObject({ environment: "production", tags: ["ops", "Linux"] })

    expect(normalizeHostProfile({
      ...profile,
      environment: "unknown",
      tags: "ops"
    })).not.toHaveProperty("environment")
    expect(normalizeHostProfile({
      ...profile,
      environment: "unknown",
      tags: "ops"
    })).not.toHaveProperty("tags")
  })
})

describe("host profile mutations", () => {
  it("duplicates a host without carrying authentication material or optional Snippets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-host-store-mutations-"))
    temporaryPaths.push(directory)
    const store = new HostStore(join(directory, "rocker.json"))
    await store.save({
      id: "host-a",
      name: "G11",
      host: "g11.example.test",
      port: 22,
      username: "root",
      authMethod: "privateKey",
      identityFile: "/private/keys/id_ed25519",
      group: "Production",
      platform: "ubuntu",
      environment: "production",
      tags: ["core", "linux"],
      snippetsEnabled: true,
      snippetCollection: "Release",
      charset: "gb18030",
      themeColor: "amber",
      favorite: true,
      notes: "production host"
    })

    const duplicate = await store.duplicate("host-a")
    const secondDuplicate = await store.duplicate("host-a")

    expect(duplicate).toMatchObject({
      name: "G11 copy",
      host: "g11.example.test",
      port: 22,
      username: "root",
      authMethod: "agent",
      platform: "ubuntu",
      charset: "gb18030",
      themeColor: "amber",
      favorite: false,
      notes: "production host"
    })
    expect(duplicate.id).not.toBe("host-a")
    expect(duplicate).not.toHaveProperty("identityFile")
    expect(duplicate).not.toHaveProperty("snippetCollection")
    expect(duplicate).not.toHaveProperty("group")
    expect(duplicate).not.toHaveProperty("environment")
    expect(duplicate).not.toHaveProperty("tags")
    expect(duplicate.snippetsEnabled).toBe(false)
    expect(duplicate.publicKeyEnabled).toBe(false)
    expect(secondDuplicate.name).toBe("G11 copy (2)")
  })

  it("enforces trimmed case-insensitive unique names while allowing the same Host to be edited", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-host-store-unique-name-"))
    temporaryPaths.push(directory)
    const store = new HostStore(join(directory, "rocker.json"))
    const profile = { id: "host-a", name: "G11", host: "g11.example.test", port: 22, username: "root", authMethod: "agent" as const, favorite: false, notes: "" }
    await store.save(profile)

    await expect(store.save({ ...profile, id: "host-b", name: "  g11  ", host: "other.example.test" }))
      .rejects.toThrow("Host name already exists")
    await expect(store.save({ ...profile, name: "  g11  " })).resolves.toBeUndefined()
    await expect(store.list()).resolves.toMatchObject([{ id: "host-a", name: "g11" }])
  })

  it("assigns unique names to Hosts imported from OpenSSH config", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-host-store-ssh-import-"))
    temporaryPaths.push(directory)
    const store = new HostStore(join(directory, "rocker.json"))
    const imported = await store.importOpenSSHConfig([
      "Host G11",
      "  HostName g11.example.test",
      "  User root",
      "Host g11",
      "  HostName g11-alt.example.test",
      "  User root"
    ].join("\n"), "/home/test")

    expect(imported.map((host) => host.name)).toEqual(["G11", "g11 (2)"])
    await expect(store.list()).resolves.toMatchObject([
      { id: imported[0]?.id, name: "G11" },
      { id: imported[1]?.id, name: "g11 (2)" }
    ])
  })

  it("updates only the requested host favorite state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-host-store-favorites-"))
    temporaryPaths.push(directory)
    const store = new HostStore(join(directory, "rocker.json"))
    await store.save({ id: "host-a", name: "A", host: "a.example.test", port: 22, username: "root", authMethod: "agent", favorite: false, notes: "" })
    await store.save({ id: "host-b", name: "B", host: "b.example.test", port: 22, username: "root", authMethod: "agent", favorite: false, notes: "" })

    await expect(store.setFavorite("host-b", true)).resolves.toMatchObject({ id: "host-b", favorite: true })
    await expect(store.list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "host-a", favorite: false }),
      expect.objectContaining({ id: "host-b", favorite: true })
    ]))
  })

  it("rejects mutations for an unknown host without changing stored profiles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-host-store-missing-"))
    temporaryPaths.push(directory)
    const store = new HostStore(join(directory, "rocker.json"))
    await store.save({ id: "host-a", name: "A", host: "a.example.test", port: 22, username: "root", authMethod: "agent", favorite: false, notes: "" })

    await expect(store.duplicate("missing")).rejects.toThrow("Host profile was not found")
    await expect(store.setFavorite("missing", true)).rejects.toThrow("Host profile was not found")
    await expect(store.list()).resolves.toHaveLength(1)
  })
})
