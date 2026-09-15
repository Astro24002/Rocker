import { JsonStore } from "./json-store"
import { StorageBlockedError, type LoadResult, type StorageDiagnosticSink } from "./storage-result"
import type { ForwardingLocalAddress, ForwardingProfile, StoredForwardingDocument } from "./types"

const defaultDocument: StoredForwardingDocument = { version: 1, profiles: [] }

export class ForwardingProfileStore {
  private readonly store: JsonStore<StoredForwardingDocument>

  public constructor(filePath: string, onDiagnostic?: StorageDiagnosticSink) {
    this.store = new JsonStore({
      filePath,
      store: "forwarding",
      defaultValue: defaultDocument,
      recovery: "default",
      normalize: normalizeForwardingDocument,
      onDiagnostic
    })
  }

  public async loadWithStatus(options: { consumeHealth?: boolean } = {}): Promise<LoadResult<StoredForwardingDocument>> {
    return this.store.load(options)
  }

  public async load(): Promise<StoredForwardingDocument> {
    const result = await this.loadWithStatus()
    if (result.status === "blocked") throw new StorageBlockedError(result.issue)
    return structuredClone(result.value)
  }

  public async list(hostId?: string): Promise<ForwardingProfile[]> {
    const document = await this.load()
    return document.profiles
      .filter((profile) => hostId === undefined || profile.hostId === hostId)
      .map((profile) => ({ ...profile }))
  }

  public async get(id: string): Promise<ForwardingProfile | undefined> {
    const profile = (await this.load()).profiles.find((candidate) => candidate.id === id)
    return profile ? { ...profile } : undefined
  }

  public async save(profile: ForwardingProfile): Promise<void> {
    const normalized = normalizeForwardingProfile(profile)
    if (!normalized) throw new Error("Forwarding profile is invalid")
    await this.store.update((document) => {
      const next = normalizeForwardingDocument(document) ?? structuredClone(defaultDocument)
      const index = next.profiles.findIndex((candidate) => candidate.id === normalized.id)
      if (index === -1) next.profiles.push(normalized)
      else next.profiles[index] = normalized
      return next
    })
  }

  public async remove(id: string): Promise<void> {
    await this.store.update((document) => {
      const next = normalizeForwardingDocument(document) ?? structuredClone(defaultDocument)
      return {
        version: 1,
        profiles: next.profiles.filter((profile) => profile.id !== id)
      }
    })
  }

  public async replace(profiles: ForwardingProfile[]): Promise<void> {
    const normalized = profiles.map(normalizeForwardingProfile)
    if (normalized.some((profile): profile is undefined => profile === undefined)) {
      throw new Error("Forwarding profile is invalid")
    }
    await this.store.write({ version: 1, profiles: normalized as ForwardingProfile[] })
  }

  public async flush(): Promise<void> {
    return Promise.resolve()
  }
}

export function normalizeForwardingDocument(value: unknown): StoredForwardingDocument | undefined {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.profiles)) return undefined
  return {
    version: 1,
    profiles: value.profiles
      .map(normalizeForwardingProfile)
      .filter((profile): profile is ForwardingProfile => profile !== undefined)
  }
}

export function normalizeForwardingProfile(value: unknown): ForwardingProfile | undefined {
  if (!isRecord(value)) return undefined
  if (!isBoundedString(value.id, 128) || !isBoundedString(value.hostId, 128) || !isBoundedString(value.name, 256)) return undefined
  if (!isLocalAddress(value.localAddress) || !isPort(value.localPort) || !isBoundedString(value.remoteAddress, 512) || !isPort(value.remotePort)) return undefined
  if (typeof value.autoStart !== "boolean" || !isBoundedString(value.createdAt, 80) || !isBoundedString(value.updatedAt, 80)) return undefined
  if (value.description !== undefined && !isString(value.description, 10_000)) return undefined
  const description = typeof value.description === "string" ? value.description.trim() : ""
  return {
    id: value.id,
    hostId: value.hostId,
    name: value.name.trim(),
    ...(description ? { description } : {}),
    localAddress: value.localAddress,
    localPort: value.localPort,
    remoteAddress: value.remoteAddress.trim(),
    remotePort: value.remotePort,
    autoStart: value.autoStart,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength
}

function isString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length <= maximumLength
}

function isPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535
}

function isLocalAddress(value: unknown): value is ForwardingLocalAddress {
  return value === "127.0.0.1" || value === "::1" || value === "0.0.0.0"
}
