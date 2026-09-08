export const currentVaultVersion = 1 as const

export interface VaultKdf {
  name: "scrypt"
  salt: string
  cost: number
  blockSize: number
  parallelization: number
  keyLength: 32
}

export interface VaultCipher {
  name: "aes-256-gcm"
  nonce: string
  authTag: string
}

export interface EncryptedVault {
  version: typeof currentVaultVersion
  kdf: VaultKdf
  cipher: VaultCipher
  ciphertext: string
}

export interface VaultHeader {
  version: typeof currentVaultVersion
  kdf: VaultKdf
  cipher: Pick<VaultCipher, "name" | "nonce">
}

const maximumCiphertextLength = 8 * 1024 * 1024

export function createVaultHeader(vault: EncryptedVault): VaultHeader {
  return {
    version: vault.version,
    kdf: { ...vault.kdf },
    cipher: { name: vault.cipher.name, nonce: vault.cipher.nonce }
  }
}

export function serializeVaultHeader(vault: EncryptedVault): string {
  return JSON.stringify(createVaultHeader(vault))
}

export function validateEncryptedVault(value: unknown): EncryptedVault | undefined {
  if (!isRecord(value) || value.version !== currentVaultVersion) return undefined
  if (!isRecord(value.kdf) || value.kdf.name !== "scrypt") return undefined
  if (!isBase64(value.kdf.salt, 16, 64)) return undefined
  if (value.kdf.cost !== 16_384 || value.kdf.blockSize !== 8 || value.kdf.parallelization !== 1 || value.kdf.keyLength !== 32) {
    return undefined
  }
  if (!isRecord(value.cipher) || value.cipher.name !== "aes-256-gcm") return undefined
  if (!isBase64(value.cipher.nonce, 12, 12) || !isBase64(value.cipher.authTag, 16, 16)) return undefined
  if (!isBase64(value.ciphertext, 0, maximumCiphertextLength)) return undefined
  return {
    version: currentVaultVersion,
    kdf: {
      name: "scrypt",
      salt: value.kdf.salt,
      cost: 16_384,
      blockSize: 8,
      parallelization: 1,
      keyLength: 32
    },
    cipher: {
      name: "aes-256-gcm",
      nonce: value.cipher.nonce,
      authTag: value.cipher.authTag
    },
    ciphertext: value.ciphertext
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isBase64(value: unknown, minimumBytes: number, maximumBytes: number): value is string {
  if (typeof value !== "string" || value.length > Math.ceil(maximumBytes / 3) * 4 + 4) return false
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false
  const decoded = Buffer.from(value, "base64")
  return decoded.length >= minimumBytes
    && decoded.length <= maximumBytes
    && decoded.toString("base64") === value
}
