import type { CredentialKind } from "./types"
import type { StorageHealth } from "./storage-result"
import { createVault, openVault } from "./vault-crypto"
import type { EncryptedVault } from "./vault-format"

export interface CredentialHealthOptions {
  consumeHealth?: boolean
}

export type CredentialValueMap = Record<string, string>

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

  public constructor(
    private readonly values: Map<string, string> | CredentialValueStore,
    private readonly cipher: CredentialCipher,
    private readonly vaultStore?: EncryptedVaultStore
  ) {}

  public async get(hostId: string, kind: CredentialKind): Promise<string | undefined> {
    const key = this.key(hostId, kind)
    if (await this.currentMode() === "vault") return this.requireUnlockedVault()[key]
    this.assertKeychainAvailable()
    const stored = await this.read(key)
    return stored === undefined ? undefined : this.cipher.decrypt(stored)
  }

  public async set(hostId: string, kind: CredentialKind, value: string): Promise<void> {
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
  }

  public async clear(hostId: string, kind: CredentialKind): Promise<void> {
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
  }

  public async health(options: CredentialHealthOptions = {}): Promise<StorageHealth> {
    if (await this.currentMode() === "vault" && this.vaultStore?.health) {
      return this.vaultStore.health(options)
    }
    if (this.values instanceof Map || this.values.health === undefined) {
      return { store: "credentials", status: "ok" }
    }
    return this.values.health(options)
  }

  public async protectionStatus(): Promise<CredentialProtectionStatus> {
    const mode = await this.currentMode()
    return {
      mode,
      keychainAvailable: this.isKeychainAvailable(),
      vaultState: mode === "vault" ? this.vaultValues ? "unlocked" : "locked" : "not-configured"
    }
  }

  public async enableVault(password: string): Promise<void> {
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
  }

  public async unlockVault(password: string): Promise<void> {
    if (!this.vaultStore || await this.currentMode() !== "vault") throw new Error("Credential Vault is not enabled")
    const encryptedVault = await this.vaultStore.get()
    if (!encryptedVault) throw new Error("Credential Vault is not enabled")
    this.vaultValues = await openVault(password, encryptedVault)
    this.vaultPassword = password
  }

  public lockVault(): void {
    if (!this.vaultValues) return
    this.vaultValues = undefined
    this.vaultPassword = undefined
  }

  public async disableVault(): Promise<void> {
    if (await this.currentMode() !== "vault") throw new Error("Credential Vault is not enabled")
    this.assertKeychainAvailable()
    const values = this.requireUnlockedVault()
    const encryptedValues: CredentialValueMap = {}
    for (const [key, value] of Object.entries(values)) encryptedValues[key] = this.cipher.encrypt(value)
    await this.replaceEntries(encryptedValues)
    await this.vaultStore?.clear()
    this.mode = "keychain"
    this.lockVault()
  }

  public async exportValues(): Promise<CredentialValueMap> {
    if (await this.currentMode() === "vault") return { ...this.requireUnlockedVault() }
    this.assertKeychainAvailable()
    return this.decryptEntries(await this.readEntries())
  }

  public async assertWritable(): Promise<void> {
    if (await this.currentMode() === "vault") {
      this.requireUnlockedVault()
      return
    }
    this.assertKeychainAvailable()
  }

  public async importValues(values: CredentialValueMap): Promise<void> {
    await this.assertWritable()
    if (await this.currentMode() === "vault") {
      await this.writeVault({ ...this.requireUnlockedVault(), ...values })
      return
    }
    const current = await this.readEntries()
    const encrypted: CredentialValueMap = { ...current }
    for (const [key, value] of Object.entries(values)) encrypted[key] = this.cipher.encrypt(value)
    await this.replaceEntries(encrypted)
  }

  private key(hostId: string, kind: CredentialKind): string {
    return `${hostId}:${kind}`
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
