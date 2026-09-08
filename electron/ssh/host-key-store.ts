import { resolve } from "node:path"
import { JsonStore } from "../storage/json-store"
import type { LoadResult, StorageHealth } from "../storage/storage-result"
import { normalizeFingerprint, type HostKeyStore, type StoredHostKeyRecord } from "./host-keys"

interface HostKeyDocument {
  fingerprints: Record<string, string>
}

export class JsonHostKeyStore implements HostKeyStore {
  private readonly store: JsonStore<HostKeyDocument>

  public constructor(filePath: string) {
    const resolvedPath = resolve(filePath)
    this.store = new JsonStore({
      filePath: resolvedPath,
      store: "hostKeys",
      defaultValue: { fingerprints: {} },
      recovery: "blocked",
      normalize: normalizeHostKeyDocument,
      sensitive: true
    })
  }

  public async get(host: string, port: number): Promise<string | undefined> {
    const document = await this.store.read()
    return document.fingerprints[this.key(host, port)]
  }

  public async trust(host: string, port: number, fingerprint: string): Promise<void> {
    const normalizedFingerprint = normalizeStoredFingerprint(fingerprint)
    if (normalizedFingerprint === undefined) return
    await this.store.update((document) => {
      const key = this.key(host, port)
      const stored = document.fingerprints[key]
      if (stored !== undefined && normalizeFingerprint(stored) !== normalizedFingerprint) {
        throw new Error("Host Key changed; replacement confirmation is required")
      }
      document.fingerprints[key] = normalizedFingerprint
      return document
    })
  }

  public async replace(host: string, port: number, expectedFingerprint: string, replacementFingerprint: string): Promise<void> {
    const normalizedExpected = normalizeStoredFingerprint(expectedFingerprint)
    const normalizedReplacement = normalizeStoredFingerprint(replacementFingerprint)
    if (normalizedExpected === undefined || normalizedReplacement === undefined) return
    await this.store.update((document) => {
      const key = this.key(host, port)
      const stored = document.fingerprints[key]
      if (stored === undefined || normalizeFingerprint(stored) !== normalizedExpected) {
        throw new Error("Host Key changed while awaiting replacement confirmation")
      }
      document.fingerprints[key] = normalizedReplacement
      return document
    })
  }

  public async remove(host: string, port: number, expectedFingerprint?: string): Promise<void> {
    const normalizedExpected = expectedFingerprint === undefined
      ? undefined
      : normalizeStoredFingerprint(expectedFingerprint)
    if (expectedFingerprint !== undefined && normalizedExpected === undefined) return
    await this.store.update((document) => {
      const key = this.key(host, port)
      const stored = document.fingerprints[key]
      if (stored === undefined) return document
      if (normalizedExpected !== undefined && normalizeFingerprint(stored) !== normalizedExpected) {
        throw new Error("Host Key changed while awaiting removal confirmation")
      }
      const fingerprints = { ...document.fingerprints }
      delete fingerprints[key]
      return { fingerprints }
    })
  }

  public async entries(): Promise<StoredHostKeyRecord[]> {
    const document = await this.store.read()
    return Object.entries(document.fingerprints).map(([key, fingerprint]) => {
      const parsed = parseHostKeyStorageKey(key)
      if (!parsed) throw new Error("Stored Host Key is invalid")
      return { ...parsed, fingerprint }
    })
  }

  public async health(options: { consumeHealth?: boolean } = {}): Promise<StorageHealth> {
    return healthFromLoad(await this.store.load(options))
  }

  private key(host: string, port: number): string {
    return `${host}:${port}`
  }

}

export function normalizeHostKeyDocument(value: unknown): HostKeyDocument | undefined {
  if (!isRecord(value) || !isRecord(value.fingerprints)) return undefined
  const fingerprints: Record<string, string> = {}
  for (const [key, fingerprint] of Object.entries(value.fingerprints)) {
    if (!parseHostKeyStorageKey(key)) return undefined
    const normalized = normalizeStoredFingerprint(fingerprint)
    if (normalized === undefined) return undefined
    fingerprints[key] = normalized
  }
  return { fingerprints }
}

function parseHostKeyStorageKey(value: string): Pick<StoredHostKeyRecord, "host" | "port"> | undefined {
  const separator = value.lastIndexOf(":")
  if (separator <= 0) return undefined
  const host = value.slice(0, separator)
  const port = Number(value.slice(separator + 1))
  if (host.length === 0 || host.length > 512 || !Number.isInteger(port) || port < 1 || port > 65_535) return undefined
  return { host, port }
}

function normalizeStoredFingerprint(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = normalizeFingerprint(value).trim()
  return normalized.length > 0 && normalized.length <= 512 ? normalized : undefined
}

function healthFromLoad(result: LoadResult<HostKeyDocument>): StorageHealth {
  if (result.status === "blocked") {
    return {
      store: result.issue.store,
      status: "blocked",
      reason: result.issue.reason,
      message: result.issue.message
    }
  }
  if (result.status === "recovered") return { store: "hostKeys", status: "recovered", source: "backup" }
  if (result.status === "defaulted" && result.reason === "corrupt") {
    return { store: "hostKeys", status: "defaulted", reason: "corrupt" }
  }
  return { store: "hostKeys", status: "ok" }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
