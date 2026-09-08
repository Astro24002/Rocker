import type { CredentialValueMap, CredentialValueStore, EncryptedVaultStore } from "./credentials"
import { JsonStore } from "./json-store"
import { StorageBlockedError, type LoadResult, type StorageHealth } from "./storage-result"
import { validateEncryptedVault, type EncryptedVault } from "./vault-format"

interface CredentialDocument {
  values: Record<string, string>
}

export class JsonCredentialValueStore implements CredentialValueStore {
  private readonly store: JsonStore<CredentialDocument>

  public constructor(filePath: string) {
    this.store = new JsonStore({
      filePath,
      store: "credentials",
      defaultValue: { values: {} },
      recovery: "blocked",
      normalize: normalizeCredentialDocument,
      sensitive: true
    })
  }

  public async get(key: string): Promise<string | undefined> {
    const document = await this.readDocument()
    return document.values[key]
  }

  public async set(key: string, value: string): Promise<void> {
    await this.store.update((document) => ({
      values: { ...document.values, [key]: value }
    }))
  }

  public async delete(key: string): Promise<void> {
    await this.store.update((document) => {
      const values = { ...document.values }
      delete values[key]
      return { values }
    })
  }

  public async entries(): Promise<CredentialValueMap> {
    return { ...(await this.readDocument()).values }
  }

  public async replace(values: CredentialValueMap): Promise<void> {
    const normalized = normalizeCredentialDocument({ values })
    if (!normalized) throw new Error("Credential values are invalid")
    await this.store.write(normalized)
  }

  public async health(options: { consumeHealth?: boolean } = {}): Promise<StorageHealth> {
    return healthFromLoad(await this.store.load(options))
  }

  private async readDocument(): Promise<CredentialDocument> {
    return this.store.read()
  }
}

interface VaultDocument {
  vault?: EncryptedVault
}

export class JsonVaultStore implements EncryptedVaultStore {
  private readonly store: JsonStore<VaultDocument>

  public constructor(filePath: string) {
    this.store = new JsonStore({
      filePath,
      store: "credentials",
      defaultValue: {},
      recovery: "blocked",
      normalize: normalizeVaultDocument,
      sensitive: true
    })
  }

  public async get(): Promise<EncryptedVault | undefined> {
    const result = await this.store.load()
    if (result.status === "blocked") throw new StorageBlockedError(result.issue)
    return result.value.vault ? structuredClone(result.value.vault) : undefined
  }

  public async set(vault: EncryptedVault): Promise<void> {
    const normalized = validateEncryptedVault(vault)
    if (!normalized) throw new Error("Credential Vault is invalid")
    await this.store.write({ vault: normalized })
  }

  public async clear(): Promise<void> {
    await this.store.write({})
  }

  public async health(options: { consumeHealth?: boolean } = {}): Promise<StorageHealth> {
    return healthFromLoad(await this.store.load(options))
  }
}

export function normalizeCredentialDocument(value: unknown): CredentialDocument | undefined {
  if (!isRecord(value) || !isRecord(value.values)) return undefined
  const values: Record<string, string> = {}
  for (const [key, storedValue] of Object.entries(value.values)) {
    if (!isBoundedString(key, 512) || !isBoundedString(storedValue, 2_000_000)) return undefined
    values[key] = storedValue
  }
  return { values }
}

function healthFromLoad<T>(result: LoadResult<T>): StorageHealth {
  if (result.status === "blocked") {
    return {
      store: result.issue.store,
      status: "blocked",
      reason: result.issue.reason,
      message: result.issue.message
    }
  }
  if (result.status === "recovered") return { store: "credentials", status: "recovered", source: "backup" }
  if (result.status === "defaulted" && result.reason === "corrupt") {
    return { store: "credentials", status: "defaulted", reason: "corrupt" }
  }
  return { store: "credentials", status: "ok" }
}

function normalizeVaultDocument(value: unknown): VaultDocument | undefined {
  if (!isRecord(value)) return undefined
  if (value.vault === undefined) return {}
  const vault = validateEncryptedVault(value.vault)
  return vault ? { vault } : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
}
