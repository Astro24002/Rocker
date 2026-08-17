import type { CredentialValueStore } from "./credentials"
import { JsonStore } from "./json-store"

interface CredentialDocument {
  values: Record<string, string>
}

export class JsonCredentialValueStore implements CredentialValueStore {
  private readonly store: JsonStore<CredentialDocument>

  public constructor(filePath: string) {
    this.store = new JsonStore(filePath, { values: {} })
  }

  public async get(key: string): Promise<string | undefined> {
    const document = await this.readDocument()
    return document.values[key]
  }

  public async set(key: string, value: string): Promise<void> {
    const document = await this.readDocument()
    document.values[key] = value
    await this.store.write(document)
  }

  public async delete(key: string): Promise<void> {
    const document = await this.readDocument()
    delete document.values[key]
    await this.store.write(document)
  }

  private async readDocument(): Promise<CredentialDocument> {
    const document = await this.store.read()
    return {
      values: document.values && typeof document.values === "object" ? document.values : {}
    }
  }
}
