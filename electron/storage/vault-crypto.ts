import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto"
import type { CredentialValueMap } from "./credentials"
import {
  currentVaultVersion,
  serializeVaultHeader,
  validateEncryptedVault,
  type EncryptedVault
} from "./vault-format"

const keyLength = 32
const saltLength = 16
const nonceLength = 12
const maximumPasswordLength = 4_096
const maximumValueCount = 10_000
const maximumValueLength = 2_000_000

export async function createVault(password: string, values: CredentialValueMap): Promise<EncryptedVault> {
  assertPassword(password)
  const normalized = normalizeValues(values)
  const vault: EncryptedVault = {
    version: currentVaultVersion,
    kdf: {
      name: "scrypt",
      salt: randomBytes(saltLength).toString("base64"),
      cost: 16_384,
      blockSize: 8,
      parallelization: 1,
      keyLength
    },
    cipher: {
      name: "aes-256-gcm",
      nonce: randomBytes(nonceLength).toString("base64"),
      authTag: ""
    },
    ciphertext: ""
  }
  const key = await deriveKey(password, Buffer.from(vault.kdf.salt, "base64"))
  try {
    const cipher = createCipheriv("aes-256-gcm", key, Buffer.from(vault.cipher.nonce, "base64"))
    cipher.setAAD(Buffer.from(serializeVaultHeader(vault), "utf8"))
    const plaintext = Buffer.from(JSON.stringify(normalized), "utf8")
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    vault.ciphertext = ciphertext.toString("base64")
    vault.cipher.authTag = cipher.getAuthTag().toString("base64")
    return vault
  } finally {
    key.fill(0)
  }
}

export async function openVault(password: string, input: unknown): Promise<CredentialValueMap> {
  assertPassword(password)
  if (isRecord(input) && input.version !== currentVaultVersion) {
    throw new Error("Unsupported Vault version")
  }
  const vault = validateEncryptedVault(input)
  if (!vault) throw new Error("Vault could not be opened")
  const key = await deriveKey(password, Buffer.from(vault.kdf.salt, "base64"))
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(vault.cipher.nonce, "base64"))
    decipher.setAAD(Buffer.from(serializeVaultHeader(vault), "utf8"))
    decipher.setAuthTag(Buffer.from(vault.cipher.authTag, "base64"))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(vault.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8")
    try {
      return normalizeValues(JSON.parse(plaintext))
    } catch {
      throw new Error("Vault could not be opened")
    }
  } catch {
    throw new Error("Vault could not be opened")
  } finally {
    key.fill(0)
  }
}

function assertPassword(password: string): void {
  if (typeof password !== "string" || password.length === 0 || password.length > maximumPasswordLength) {
    throw new Error("Vault password is required")
  }
}

function normalizeValues(value: unknown): CredentialValueMap {
  if (!isRecord(value)) throw new Error("Vault values are invalid")
  const entries = Object.entries(value)
  if (entries.length > maximumValueCount) throw new Error("Vault values are invalid")
  const normalized: CredentialValueMap = {}
  for (const [key, item] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (!isSafeKey(key) || typeof item !== "string" || item.length > maximumValueLength) {
      throw new Error("Vault values are invalid")
    }
    normalized[key] = item
  }
  return normalized
}

function isSafeKey(value: string): boolean {
  return value.length > 0 && value.length <= 512 && value !== "__proto__" && value !== "constructor" && value !== "prototype"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024
    }, (error, key) => {
      if (error) reject(new Error("Vault could not be opened"))
      else resolve(key)
    })
  })
}
