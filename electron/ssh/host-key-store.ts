import { JsonStore } from "../storage/json-store"
import type { HostKeyStore } from "./host-keys"

interface HostKeyDocument {
  fingerprints: Record<string, string>
}

export class JsonHostKeyStore implements HostKeyStore {
  private readonly store: JsonStore<HostKeyDocument>

  public constructor(filePath: string) {
    this.store = new JsonStore(filePath, { fingerprints: {} })
  }

  public async get(host: string, port: number): Promise<string | undefined> {
    const document = await this.readDocument()
    return document.fingerprints[this.key(host, port)]
  }

  public async trust(host: string, port: number, fingerprint: string): Promise<void> {
    const document = await this.readDocument()
    document.fingerprints[this.key(host, port)] = fingerprint
    await this.store.write(document)
  }

  private key(host: string, port: number): string {
    return `${host}:${port}`
  }

  private async readDocument(): Promise<HostKeyDocument> {
    const document = await this.store.read()
    return {
      fingerprints: document.fingerprints && typeof document.fingerprints === "object" ? document.fingerprints : {}
    }
  }
}
