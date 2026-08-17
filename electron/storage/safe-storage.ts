import { safeStorage } from "electron"
import type { CredentialCipher } from "./credentials"

export function createSafeStorageCipher(): CredentialCipher {
  return {
    encrypt(value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Platform credential encryption is unavailable")
      }
      return safeStorage.encryptString(value).toString("base64")
    },
    decrypt(value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Platform credential encryption is unavailable")
      }
      return safeStorage.decryptString(Buffer.from(value, "base64"))
    }
  }
}
