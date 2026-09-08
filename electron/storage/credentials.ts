import type { CredentialKind } from "./types"
import type { StorageHealth } from "./storage-result"
import { createVault, openVault } from "./vault-crypto"
import type { EncryptedVault } from "./vault-format"

export interface CredentialHealthOptions {
  consumeHealth?: boolean
}

export type CredentialValueMap = Record<string, string>

export interface CredentialImportResult {
  imported: string[]
  skippedExisting: string[]
}

export interface CredentialCipher {
  isAvailable?(): boolean
  encrypt(value: string): string
  decrypt(value: string): string
}

export interface CredentialValueStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  entries(): Promise<CredentialValueMap>
  replace(values: CredentialValueMap): Promise<void>
  health?(options?: CredentialHealthOptions): Promise<StorageHealth>
}

export interface EncryptedVaultStore {
  get(): Promise<EncryptedVault | undefined>
  set(vault: EncryptedVault): Promise<void>
  clear(): Promise<void>
  health?(options?: CredentialHealthOptions): Promise<StorageHealth>
}

export type CredentialProtectionMode = "keychain" | "vault"

export interface CredentialProtectionStatus {
  mode: CredentialProtectionMode
  keychainAvailable: boolean
  vaultState: "not-configured" | "locked" | "unlocked"
}

export class CredentialVault {
  private mode?: CredentialProtectionMode
  private vaultPassword?: string
  private vaultValues?: CredentialValueMap
  private operationQueue = Promise.resolve()

  public constructor(
    private readonly values: Map<string, string> | CredentialValueStore,
    private readonly cipher: CredentialCipher,
    private readonly vaultStore?: EncryptedVaultStore
  ) {}

  public get(hostId: string, kind: CredentialKind): Promise<string | undefined> {
    return this.run(async () => {
      const key = this.key(hostId, kind)
      if (await this.currentMode() === "vault") return this.requireUnlockedVault()[key]
      this.assertKeychainAvailable()
      const stored = await this.read(key)
      return stored === undefined ? undefined : this.cipher.decrypt(stored)
    })
  }

  public set(hostId: string, kind: CredentialKind, value: string): Promise<void> {
    return this.run(async () => {
      const key = this.key(hostId, kind)
      if (await this.currentMode() === "vault") {
        const current = this.requireUnlockedVault()
        const next = { ...current, [key]: value }
        await this.writeVault(next)
        return
      }
      this.assertKeychainAvailable()
      const encrypted = this.cipher.encrypt(value)
      if (this.values instanceof Map) {
        this.values.set(key, encrypted)
      } else {
        await this.values.set(key, encrypted)
      }
    })
  }

  public clear(hostId: string, kind: CredentialKind): Promise<void> {
    return this.run(async () => {
      const key = this.key(hostId, kind)
      if (await this.currentMode() === "vault") {
        const current = this.requireUnlockedVault()
        const next = { ...current }
        delete next[key]
        await this.writeVault(next)
        return
      }
      this.assertKeychainAvailable()
      if (this.values instanceof Map) {
        this.values.delete(key)
      } else {
        await this.values.delete(key)
      }
    })
  }

  public health(options: CredentialHealthOptions = {}): Promise<StorageHealth> {
    return this.run(async () => {
      if (await this.currentMode() === "vault" && this.vaultStore?.health) {
        return this.vaultStore.health(options)
      }
      if (this.values instanceof Map || this.values.health === undefined) {
        return { store: "credentials", status: "ok" }
      }
      return this.values.health(options)
    })
  }

  public protectionStatus(): Promise<CredentialProtectionStatus> {
    return this.run(async () => {
      const mode = await this.currentMode()
      return {
        mode,
        keychainAvailable: this.isKeychainAvailable(),
        vaultState: mode === "vault" ? this.vaultValues ? "unlocked" : "locked" : "not-configured"
      }
    })
  }

  public enableVault(password: string): Promise<void> {
    return this.run(async () => {
      if (!this.vaultStore) throw new Error("Credential Vault is unavailable")
      if (await this.currentMode() === "vault") throw new Error("Credential Vault is already enabled")
      const encryptedValues = await this.readEntries()
      const values = this.decryptEntries(encryptedValues)
      const encryptedVault = await createVault(password, values)
      await this.vaultStore.set(encryptedVault)
      this.mode = "vault"
      this.vaultPassword = password
      this.vaultValues = values
      await this.replaceEntries({})
    })
  }

  public unlockVault(password: string): Promise<void> {
    return this.run(async () => {
      if (!this.vaultStore || await this.currentMode() !== "vault") throw new Error("Credential Vault is not enabled")
      const encryptedVault = await this.vaultStore.get()
      if (!encryptedVault) throw new Error("Credential Vault is not enabled")
      this.vaultValues = await openVault(password, encryptedVault)
      this.vaultPassword = password
    })
  }

  public lockVault(): Promise<void> {
    return this.run(async () => {
      if (!this.vaultValues) return
      this.vaultValues = undefined
      this.vaultPassword = undefined
    })
  }

  public disableVault(): Promise<void> {
    return this.run(async () => {
      if (await this.currentMode() !== "vault") throw new Error("Credential Vault is not enabled")
      this.assertKeychainAvailable()
      const values = this.requireUnlockedVault()
      const encryptedValues: CredentialValueMap = {}
      for (const [key, value] of Object.entries(values)) encryptedValues[key] = this.cipher.encrypt(value)
      await this.replaceEntries(encryptedValues)
      await this.vaultStore?.clear()
      this.mode = "keychain"
      this.vaultValues = undefined
      this.vaultPassword = undefined
    })
  }

  public exportValues(): Promise<CredentialValueMap> {
    return this.run(async () => {
      if (await this.currentMode() === "vault") return { ...this.requireUnlockedVault() }
      this.assertKeychainAvailable()
      return this.decryptEntries(await this.readEntries())
    })
  }

  public assertWritable(): Promise<void> {
    return this.run(async () => this.assertWritableUnlocked())
  }

  public importValues(values: CredentialValueMap): Promise<CredentialImportResult> {
    return this.run(async () => {
      assertCredentialValueMap(values)
      await this.assertWritableUnlocked()
      if (await this.currentMode() === "vault") {
        const current = this.requireUnlockedVault()
        const result = splitImportedValues(current, values)
        if (result.imported.length > 0) await this.writeVault({ ...current, ...result.values })
        return { imported: result.imported, skippedExisting: result.skippedExisting }
      }
      const current = await this.readEntries()
      const result = splitImportedValues(current, values)
      if (result.imported.length === 0) return { imported: [], skippedExisting: result.skippedExisting }
      const encrypted: CredentialValueMap = { ...current }
      for (const [key, value] of Object.entries(result.values)) encrypted[key] = this.cipher.encrypt(value)
      await this.replaceEntries(encrypted)
      return { imported: result.imported, skippedExisting: result.skippedExisting }
    })
  }

  private key(hostId: string, kind: CredentialKind): string {
    return `${hostId}:${kind}`
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async read(key: string): Promise<string | undefined> {
    return this.values instanceof Map ? this.values.get(key) : this.values.get(key)
  }

  private async currentMode(): Promise<CredentialProtectionMode> {
    if (this.mode) return this.mode
    if (!this.vaultStore) return "keychain"
    this.mode = await this.vaultStore.get() ? "vault" : "keychain"
    return this.mode
  }

  private async assertWritableUnlocked(): Promise<void> {
    if (await this.currentMode() === "vault") {
      this.requireUnlockedVault()
      return
    }
    this.assertKeychainAvailable()
  }

  private async readEntries(): Promise<CredentialValueMap> {
    if (this.values instanceof Map) return Object.fromEntries(this.values)
    return this.values.entries()
  }

  private async replaceEntries(values: CredentialValueMap): Promise<void> {
    if (this.values instanceof Map) {
      this.values.clear()
      for (const [key, value] of Object.entries(values)) this.values.set(key, value)
      return
    }
    await this.values.replace(values)
  }

  private decryptEntries(values: CredentialValueMap): CredentialValueMap {
    if (Object.keys(values).length > 0) this.assertKeychainAvailable()
    const decrypted: CredentialValueMap = {}
    for (const [key, value] of Object.entries(values)) decrypted[key] = this.cipher.decrypt(value)
    return decrypted
  }

  private requireUnlockedVault(): CredentialValueMap {
    if (!this.vaultValues || !this.vaultPassword) throw new Error("Credential Vault is locked")
    return this.vaultValues
  }

  private async writeVault(values: CredentialValueMap): Promise<void> {
    if (!this.vaultStore) throw new Error("Credential Vault is unavailable")
    const password = this.requireVaultPassword()
    await this.vaultStore.set(await createVault(password, values))
    this.vaultValues = values
  }

  private requireVaultPassword(): string {
    if (!this.vaultPassword) throw new Error("Credential Vault is locked")
    return this.vaultPassword
  }

  private isKeychainAvailable(): boolean {
    return this.cipher.isAvailable?.() ?? true
  }

  private assertKeychainAvailable(): void {
    if (!this.isKeychainAvailable()) throw new Error("Platform credential encryption is unavailable")
  }
}

function splitImportedValues(
  current: CredentialValueMap,
  incoming: CredentialValueMap
): { values: CredentialValueMap; imported: string[]; skippedExisting: string[] } {
  const values: CredentialValueMap = {}
  const imported: string[] = []
  const skippedExisting: string[] = []
  for (const [key, value] of Object.entries(incoming)) {
    if (Object.prototype.hasOwnProperty.call(current, key)) {
      skippedExisting.push(key)
      continue
    }
    values[key] = value
    imported.push(key)
  }
  return { values, imported, skippedExisting }
}

function assertCredentialValueMap(values: CredentialValueMap): void {
  if (typeof values !== "object" || values === null || Array.isArray(values)) throw new Error("Credential values are invalid")
  for (const [key, value] of Object.entries(values)) {
    if (key.length === 0 || key.length > 512 || key === "__proto__" || key === "constructor" || key === "prototype" || typeof value !== "string" || value.length > 2_000_000) {
      throw new Error("Credential values are invalid")
    }
  }
}
