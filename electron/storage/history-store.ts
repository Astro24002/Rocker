import type { ConnectionHistoryItem } from "./types"
import { JsonStore } from "./json-store"

interface HistoryDocument {
  items: ConnectionHistoryItem[]
}

export class HistoryStore {
  private readonly store: JsonStore<HistoryDocument>

  public constructor(filePath: string) {
    this.store = new JsonStore(filePath, { items: [] })
  }

  public async list(): Promise<ConnectionHistoryItem[]> {
    const document = await this.readDocument()
    return [...document.items].sort((left, right) => right.connectedAt.localeCompare(left.connectedAt))
  }

  public async add(item: ConnectionHistoryItem): Promise<void> {
    const document = await this.readDocument()
    document.items = [item, ...document.items].slice(0, 200)
    await this.store.write(document)
  }

  public async clear(): Promise<void> {
    await this.store.write({ items: [] })
  }

  private async readDocument(): Promise<HistoryDocument> {
    const document = await this.store.read()
    return { items: Array.isArray(document.items) ? document.items : [] }
  }
}
