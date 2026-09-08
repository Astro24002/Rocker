import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { JsonCredentialValueStore, JsonVaultStore } from "./credential-store"
import { CredentialVault, type CredentialCipher } from "./credentials"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("CredentialVault protection modes", () => {
  it("uses keychain encryption by default", async () => {
    const directory = await temporaryDirectory()
    const values = new JsonCredentialValueStore(join(directory, "credentials.json"))
    const vault = new CredentialVault(values, reversibleCipher(), new JsonVaultStore(join(directory, "vault.json")))

    await vault.set("host-a", "password", "secret")

    await expect(vault.get("host-a", "password")).resolves.toBe("secret")
    await expect(vault.protectionStatus()).resolves.toMatchObject({ mode: "keychain", keychainAvailable: true })
    await expect(values.entries()).resolves.toEqual({ "host-a:password": "cipher:secret" })
  })

  it("rejects default-mode writes when platform encryption is unavailable", async () => {
    const directory = await temporaryDirectory()
    const vault = new CredentialVault(
      new JsonCredentialValueStore(join(directory, "credentials.json")),
      unavailableCipher(),
      new JsonVaultStore(join(directory, "vault.json"))
    )

    await expect(vault.set("host-a", "password", "secret")).rejects.toThrow("Platform credential encryption is unavailable")
    await expect(vault.protectionStatus()).resolves.toMatchObject({ mode: "keychain", keychainAvailable: false })
  })

  it("moves stable credential references into an unlocked Vault and back to keychain", async () => {
    const directory = await temporaryDirectory()
    const values = new JsonCredentialValueStore(join(directory, "credentials.json"))
    const vault = new CredentialVault(values, reversibleCipher(), new JsonVaultStore(join(directory, "vault.json")))
    await vault.set("host-a", "password", "secret")
    await vault.set("host-b", "passphrase", "phrase")

    await vault.enableVault("vault password")

    await expect(vault.protectionStatus()).resolves.toMatchObject({ mode: "vault", vaultState: "unlocked" })
    await expect(vault.get("host-a", "password")).resolves.toBe("secret")
    await expect(vault.get("host-b", "passphrase")).resolves.toBe("phrase")
    await expect(values.entries()).resolves.toEqual({})

    vault.lockVault()
    await expect(vault.get("host-a", "password")).rejects.toThrow("Credential Vault is locked")
    await vault.unlockVault("vault password")
    await vault.disableVault()

    await expect(vault.protectionStatus()).resolves.toMatchObject({ mode: "keychain", keychainAvailable: true })
    await expect(vault.get("host-a", "password")).resolves.toBe("secret")
    await expect(values.entries()).resolves.toEqual({
      "host-a:password": "cipher:secret",
      "host-b:passphrase": "cipher:phrase"
    })
  })

  it("imports only missing credential references and preserves existing local values", async () => {
    const directory = await temporaryDirectory()
    const vault = new CredentialVault(
      new JsonCredentialValueStore(join(directory, "credentials.json")),
      reversibleCipher(),
      new JsonVaultStore(join(directory, "vault.json"))
    )
    await vault.set("host-a", "password", "local-password")

    await expect(vault.importValues({
      "host-a:password": "imported-password",
      "host-b:passphrase": "imported-passphrase"
    })).resolves.toEqual({
      imported: ["host-b:passphrase"],
      skippedExisting: ["host-a:password"]
    })
    await expect(vault.get("host-a", "password")).resolves.toBe("local-password")
    await expect(vault.get("host-b", "passphrase")).resolves.toBe("imported-passphrase")
  })

  it("serializes a Vault transition with a concurrent credential import", async () => {
    const directory = await temporaryDirectory()
    const vault = new CredentialVault(
      new JsonCredentialValueStore(join(directory, "credentials.json")),
      reversibleCipher(),
      new JsonVaultStore(join(directory, "vault.json"))
    )
    await vault.set("host-a", "password", "existing")

    const enabling = vault.enableVault("vault password")
    const importing = vault.importValues({ "host-b:passphrase": "imported" })
    await expect(Promise.all([enabling, importing])).resolves.toEqual([
      undefined,
      { imported: ["host-b:passphrase"], skippedExisting: [] }
    ])

    await expect(vault.protectionStatus()).resolves.toMatchObject({ mode: "vault", vaultState: "unlocked" })
    await expect(vault.get("host-a", "password")).resolves.toBe("existing")
    await expect(vault.get("host-b", "passphrase")).resolves.toBe("imported")
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rocker-credentials-"))
  directories.push(directory)
  return directory
}

function reversibleCipher(): CredentialCipher {
  return {
    isAvailable: () => true,
    encrypt: (value) => `cipher:${value}`,
    decrypt: (value) => value.startsWith("cipher:") ? value.slice("cipher:".length) : (() => { throw new Error("invalid cipher") })()
  }
}

function unavailableCipher(): CredentialCipher {
  return {
    isAvailable: () => false,
    encrypt: () => { throw new Error("Platform credential encryption is unavailable") },
    decrypt: () => { throw new Error("Platform credential encryption is unavailable") }
  }
}
