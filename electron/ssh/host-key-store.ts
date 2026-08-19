import { JsonStore } from "../storage/json-store"
import { normalizeFingerprint, type HostKeyStore } from "./host-keys"

interface HostKeyDocument {
  fingerprints: Record<string, string>
}

export class JsonHostKeyStore implements HostKeyStore {
  private static readonly mutationTails = new Map<string, Promise<void>>()
  private readonly store: JsonStore<HostKeyDocument>
  private readonly filePath: string

  public constructor(filePath: string) {
    this.filePath = filePath
    this.store = new JsonStore(filePath, { fingerprints: {} })
  }

  public async get(host: string, port: number): Promise<string | undefined> {
    const document = await this.readDocument()
    return document.fingerprints[this.key(host, port)]
  }

  public async trust(host: string, port: number, fingerprint: string): Promise<void> {
    await this.mutate(async () => {
      const document = await this.readDocument()
      const key = this.key(host, port)
      const stored = document.fingerprints[key]
      if (stored !== undefined && normalizeFingerprint(stored) !== normalizeFingerprint(fingerprint)) {
        throw new Error("Host Key changed; replacement confirmation is required")
      }
      document.fingerprints[key] = normalizeFingerprint(fingerprint)
      await this.store.write(document)
    })
  }

  public async replace(host: string, port: number, expectedFingerprint: string, replacementFingerprint: string): Promise<void> {
    await this.mutate(async () => {
      const document = await this.readDocument()
      const key = this.key(host, port)
      const stored = document.fingerprints[key]
      if (stored === undefined || normalizeFingerprint(stored) !== normalizeFingerprint(expectedFingerprint)) {
        throw new Error("Host Key changed while awaiting replacement confirmation")
      }
      document.fingerprints[key] = normalizeFingerprint(replacementFingerprint)
      await this.store.write(document)
    })
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

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = JsonHostKeyStore.mutationTails.get(this.filePath) ?? Promise.resolve()
    let release: (() => void) | undefined
    const current = new Promise<void>((resolve) => { release = resolve })
    JsonHostKeyStore.mutationTails.set(this.filePath, current)
    await previous
    try {
      return await operation()
    } finally {
      release?.()
      if (JsonHostKeyStore.mutationTails.get(this.filePath) === current) {
        JsonHostKeyStore.mutationTails.delete(this.filePath)
      }
    }
  }
}
