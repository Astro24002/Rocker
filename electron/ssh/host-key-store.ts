import { resolve } from "node:path"
import { JsonStore } from "../storage/json-store"
import type { LoadResult, StorageHealth } from "../storage/storage-result"
import { normalizeFingerprint, type HostKeyAuditRecord, type HostKeyStore, type StoredHostKeyRecord } from "./host-keys"

interface HostKeyDocument {
  fingerprints: Record<string, string>
  history: HostKeyAuditRecord[]
}

const maximumAuditEntries = 500

export class JsonHostKeyStore implements HostKeyStore {
  private readonly store: JsonStore<HostKeyDocument>

  public constructor(filePath: string) {
    const resolvedPath = resolve(filePath)
    this.store = new JsonStore({
      filePath: resolvedPath,
      store: "hostKeys",
      defaultValue: { fingerprints: {}, history: [] },
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
      const fingerprints = { ...document.fingerprints, [key]: normalizedFingerprint }
      if (stored !== undefined) return { ...document, fingerprints }
      return appendAudit({ ...document, fingerprints }, {
        at: new Date().toISOString(),
        action: "trusted",
        host,
        port,
        fingerprint: normalizedFingerprint
      })
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
      return appendAudit({
        ...document,
        fingerprints: { ...document.fingerprints, [key]: normalizedReplacement }
      }, {
        at: new Date().toISOString(),
        action: "replaced",
        host,
        port,
        fingerprint: normalizedReplacement,
        previousFingerprint: normalizedExpected
      })
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
      return appendAudit({ ...document, fingerprints }, {
        at: new Date().toISOString(),
        action: "removed",
        host,
        port,
        fingerprint: normalizeFingerprint(stored)
      })
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

  public async auditEntries(): Promise<HostKeyAuditRecord[]> {
    const document = await this.store.read()
    return document.history.map((entry) => ({ ...entry }))
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
  const history = value.history === undefined ? [] : normalizeAuditEntries(value.history)
  if (history === undefined) return undefined
  return { fingerprints, history }
}

function normalizeAuditEntries(value: unknown): HostKeyAuditRecord[] | undefined {
  if (!Array.isArray(value) || value.length > maximumAuditEntries) return undefined
  const history: HostKeyAuditRecord[] = []
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.at !== "string" || !Number.isFinite(Date.parse(candidate.at))) return undefined
    if (candidate.action !== "trusted" && candidate.action !== "replaced" && candidate.action !== "removed") return undefined
    if (typeof candidate.host !== "string" || candidate.host.length === 0 || candidate.host.length > 512) return undefined
    if (typeof candidate.port !== "number" || !Number.isInteger(candidate.port) || candidate.port < 1 || candidate.port > 65_535) return undefined
    const fingerprint = normalizeStoredFingerprint(candidate.fingerprint)
    if (fingerprint === undefined) return undefined
    const previousFingerprint = candidate.previousFingerprint === undefined
      ? undefined
      : normalizeStoredFingerprint(candidate.previousFingerprint)
    if (candidate.previousFingerprint !== undefined && previousFingerprint === undefined) return undefined
    history.push({
      at: candidate.at,
      action: candidate.action,
      host: candidate.host,
      port: candidate.port,
      fingerprint,
      ...(previousFingerprint ? { previousFingerprint } : {})
    })
  }
  return history
}

function appendAudit(document: HostKeyDocument, entry: HostKeyAuditRecord): HostKeyDocument {
  const history = [...document.history, entry]
  return history.length > maximumAuditEntries
    ? { ...document, history: history.slice(history.length - maximumAuditEntries) }
    : { ...document, history }
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
