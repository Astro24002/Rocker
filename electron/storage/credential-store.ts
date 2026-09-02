import type { CredentialValueStore } from "./credentials"
import { JsonStore } from "./json-store"
import type { LoadResult, StorageHealth } from "./storage-result"

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

  public async health(options: { consumeHealth?: boolean } = {}): Promise<StorageHealth> {
    return healthFromLoad(await this.store.load(options))
  }

  private async readDocument(): Promise<CredentialDocument> {
    return this.store.read()
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

function healthFromLoad(result: LoadResult<CredentialDocument>): StorageHealth {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
}
