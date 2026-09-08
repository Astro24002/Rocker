import { describe, expect, it } from "vitest"
import { createVault, openVault } from "./vault-crypto"
import type { EncryptedVault } from "./vault-format"

describe("Vault crypto", () => {
  it("round-trips an encrypted credential map", async () => {
    const vault = await createVault("correct horse battery staple", {
      "host-1:password": "pāssword",
      "host-1:passphrase": "秘密"
    })

    expect(vault.version).toBe(1)
    expect(vault.cipher.name).toBe("aes-256-gcm")
    expect(vault.ciphertext).not.toContain("pāssword")
    await expect(openVault("correct horse battery staple", vault)).resolves.toEqual({
      "host-1:password": "pāssword",
      "host-1:passphrase": "秘密"
    })
  })

  it("rejects a wrong password and tampered authenticated metadata", async () => {
    const vault = await createVault("correct password", { "host:password": "secret" })

    await expect(openVault("wrong password", vault)).rejects.toThrow("Vault could not be opened")
    const tampered: EncryptedVault = {
      ...vault,
      cipher: { ...vault.cipher, nonce: "AAAAAAAAAAAAAAAA" }
    }
    await expect(openVault("correct password", tampered)).rejects.toThrow("Vault could not be opened")
  })

  it("rejects unsupported or malformed vault versions", async () => {
    const vault = await createVault("correct password", {})
    await expect(openVault("correct password", { ...vault, version: 99 })).rejects.toThrow("Unsupported Vault version")
    await expect(openVault("correct password", { ...vault, ciphertext: "not-base64" })).rejects.toThrow("Vault could not be opened")
  })
})
