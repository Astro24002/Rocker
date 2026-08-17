import { readFile } from "node:fs/promises"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { CredentialVault, type CredentialCipher } from "../electron/storage/credentials"
import { HostStore } from "../electron/storage/host-store"
import { JsonStore } from "../electron/storage/json-store"
import type { HostProfile } from "../electron/storage/types"

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("local host storage", () => {
  it("does not serialize password or private-key contents into host metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-storage-"))
    temporaryPaths.push(directory)
    const filePath = join(directory, "rocker.json")
    const store = new HostStore(new JsonStore(filePath))
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
})

describe("credential vault", () => {
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
