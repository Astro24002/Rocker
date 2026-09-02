import { chmod, readFile, readdir, writeFile } from "node:fs/promises"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { CredentialVault, type CredentialCipher } from "../electron/storage/credentials"
import { JsonCredentialValueStore } from "../electron/storage/credential-store"
import { HostStore } from "../electron/storage/host-store"
import { StorageBlockedError } from "../electron/storage/storage-result"
import { WorkspaceSnapshotStore } from "../electron/storage/workspace-store"
import type { HostProfile, StoredWorkspaceWindow } from "../electron/storage/types"

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("local host storage", () => {
  it("blocks malformed protected host storage without creating an empty primary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-storage-"))
    temporaryPaths.push(directory)
    const filePath = join(directory, "rocker.json")
    await writeFile(filePath, JSON.stringify({ hosts: "invalid" }), "utf8")

    const store = new HostStore(filePath)
    const result = await store.loadWithStatus()

    expect(result).toMatchObject({ status: "blocked", issue: { store: "hosts", reason: "corrupt" } })
    await expect(store.remove("host-1")).rejects.toBeInstanceOf(StorageBlockedError)
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("serializes concurrent host saves without losing profiles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-storage-"))
    temporaryPaths.push(directory)
    const store = new HostStore(join(directory, "rocker.json"))
    const profiles = Array.from({ length: 10 }, (_, index) => ({
      id: `host-${index}`,
      name: `Host ${index}`,
      host: `10.0.0.${index + 1}`,
      port: 22,
      username: "deploy",
      authMethod: "agent" as const,
      favorite: false,
      notes: ""
    }))

    await Promise.all(profiles.map((profile) => store.save(profile)))

    expect(await store.list()).toHaveLength(profiles.length)
  })

  it("does not serialize password or private-key contents into host metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-storage-"))
    temporaryPaths.push(directory)
    const filePath = join(directory, "rocker.json")
    const store = new HostStore(filePath)
    const profile: HostProfile = {
      id: "host-1",
      name: "Production",
      host: "10.0.0.8",
      port: 22,
      username: "deploy",
      authMethod: "privateKey",
      identityFile: "/Users/alex/.ssh/id_ed25519",
      group: "Personal",
      favorite: true,
      notes: "Primary app host"
    }

    await store.save(profile)
    const serialized = await readFile(filePath, "utf8")

    expect(serialized).toContain("id_ed25519")
    expect(serialized).not.toContain("password")
    expect(serialized).not.toContain("BEGIN OPENSSH PRIVATE KEY")
    expect(serialized).not.toContain("hunter2")
  })

  it("blocks corrupt protected host storage when no valid backup exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-storage-"))
    temporaryPaths.push(directory)
    const filePath = join(directory, "rocker.json")
    await writeFile(filePath, "{not valid json", "utf8")

    const result = await new HostStore(filePath).loadWithStatus()

    expect(result).toMatchObject({ status: "blocked", issue: { store: "hosts", reason: "corrupt" } })
    expect(await readdir(directory)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^rocker\..+\.corrupt$/)
    ]))
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  })
})

describe("workspace recovery", () => {
  it("recovers a corrupt workspace primary from its backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-storage-"))
    temporaryPaths.push(directory)
    const filePath = join(directory, "workspace.json")
    const window = workspaceWindow()
    await writeFile(filePath, "{not valid json", "utf8")
    await writeFile(`${filePath}.bak`, JSON.stringify({ version: 1, windows: [window] }), "utf8")

    const result = await new WorkspaceSnapshotStore(filePath).loadWithStatus()

    expect(result).toEqual({ status: "recovered", value: { version: 1, windows: [window] }, source: "backup" })
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({ version: 1, windows: [window] })
  })

  it("defaults a corrupt workspace without a backup and quarantines the primary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-storage-"))
    temporaryPaths.push(directory)
    const filePath = join(directory, "workspace.json")
    await writeFile(filePath, "{not valid json", "utf8")

    const result = await new WorkspaceSnapshotStore(filePath).loadWithStatus()

    expect(result).toEqual({ status: "defaulted", value: { version: 1, windows: [] }, reason: "corrupt" })
    expect(await readdir(directory)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^workspace\..+\.corrupt$/)
    ]))
  })

  it("reports a permission-blocked workspace without replacing the file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-storage-"))
    temporaryPaths.push(directory)
    const filePath = join(directory, "workspace.json")
    await writeFile(filePath, JSON.stringify({ version: 1, windows: [] }), "utf8")
    await chmod(directory, 0o000)

    try {
      const result = await new WorkspaceSnapshotStore(filePath).loadWithStatus()
      expect(result).toMatchObject({ status: "blocked", issue: { store: "workspace", reason: "permission" } })
    } finally {
      await chmod(directory, 0o700)
    }
  })
})

describe("credential vault", () => {
  it("blocks malformed protected credential storage without exposing values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-storage-"))
    temporaryPaths.push(directory)
    const filePath = join(directory, "credentials.json")
    await writeFile(filePath, JSON.stringify({ values: "invalid" }), "utf8")

    const store = new JsonCredentialValueStore(filePath)
    const health = await store.health()

    expect(health).toMatchObject({ store: "credentials", status: "blocked", reason: "corrupt" })
    expect(JSON.stringify(health)).not.toContain("invalid")
    await expect(store.set("host-1:password", "encrypted:value")).rejects.toBeInstanceOf(StorageBlockedError)
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("round-trips through the injected cipher and returns undefined for missing values", async () => {
    const values = new Map<string, string>()
    const cipher: CredentialCipher = {
      encrypt: (value) => `encrypted:${value}`,
      decrypt: (value) => value.replace(/^encrypted:/, "")
    }
    const vault = new CredentialVault(values, cipher)

    expect(await vault.get("host-1", "password")).toBeUndefined()
    await vault.set("host-1", "password", "hunter2")
    expect(values.get("host-1:password")).toBe("encrypted:hunter2")
    expect(await vault.get("host-1", "password")).toBe("hunter2")
    await vault.clear("host-1", "password")
    expect(await vault.get("host-1", "password")).toBeUndefined()
  })
})

function workspaceWindow(): StoredWorkspaceWindow {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    maximized: false,
    sessions: []
  }
}
