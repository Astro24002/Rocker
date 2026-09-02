import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"
import { JsonStore } from "./json-store"
import { StorageBlockedError, type LoadResult } from "./storage-result"
import type { HostProfile, StoredHostDocument } from "./types"

const defaultDocument: StoredHostDocument = { hosts: [] }

export class HostStore {
  private readonly store: JsonStore<StoredHostDocument>

  public constructor(filePath: string) {
    this.store = createJsonStore(filePath)
  }

  public async loadWithStatus(options: { consumeHealth?: boolean } = {}): Promise<LoadResult<HostProfile[]>> {
    return mapLoadResult(await this.store.load(options), (document) => normalizeHostDocument(document)?.hosts ?? [])
  }

  public async list(): Promise<HostProfile[]> {
    const result = await this.loadWithStatus()
    if (result.status === "blocked") throw new StorageBlockedError(result.issue)
    return result.value.map((host) => ({ ...host }))
  }

  public async save(profile: HostProfile): Promise<void> {
    const normalized = normalizeHostProfile(profile)
    if (!normalized) return
    await this.store.update((document) => {
      const next = normalizeHostDocument(document) ?? structuredClone(defaultDocument)
      const index = next.hosts.findIndex((host) => host.id === normalized.id)
      if (index === -1) next.hosts.push(normalized)
      else next.hosts[index] = normalized
      return next
    })
  }

  public async remove(id: string): Promise<void> {
    await this.store.update((document) => {
      const next = normalizeHostDocument(document) ?? structuredClone(defaultDocument)
      return { hosts: next.hosts.filter((host) => host.id !== id) }
    })
  }

  public async importOpenSSHConfig(text: string, homeDirectory = homedir()): Promise<HostProfile[]> {
    const profiles = parseOpenSSHConfig(text, homeDirectory)
    await this.store.update((document) => {
      const next = normalizeHostDocument(document) ?? structuredClone(defaultDocument)
      const existingIds = new Set(next.hosts.map((host) => host.id))
      for (const profile of profiles) {
        if (!existingIds.has(profile.id)) {
          next.hosts.push(profile)
          existingIds.add(profile.id)
        }
      }
      return next
    })
    return profiles
  }
}

export function createHostStore(userDataPath: string): HostStore {
  return new HostStore(join(userDataPath, "rocker.json"))
}

function createJsonStore(filePath: string): JsonStore<StoredHostDocument> {
  return new JsonStore({
    filePath,
    store: "hosts",
    defaultValue: defaultDocument,
    recovery: "blocked",
    normalize: normalizeHostDocument
  })
}

export function normalizeHostDocument(value: unknown): StoredHostDocument | undefined {
  if (!isRecord(value) || !Array.isArray(value.hosts)) return undefined
  const hosts = value.hosts.map(normalizeHostProfile)
  if (hosts.some((host): host is undefined => host === undefined)) return undefined
  return { hosts: hosts.filter((host): host is HostProfile => host !== undefined) }
}

export function normalizeHostProfile(value: unknown): HostProfile | undefined {
  if (!isRecord(value)) return undefined
  if (!isBoundedString(value.id, 128) || !isBoundedString(value.name, 256) || !isBoundedString(value.host, 512)) return undefined
  if (!isPort(value.port) || !isString(value.username, 256) || !isString(value.notes, 10_000)) return undefined
  if (value.authMethod !== "password" && value.authMethod !== "privateKey" && value.authMethod !== "agent") return undefined
  if (typeof value.favorite !== "boolean") return undefined
  if (value.identityFile !== undefined && !isBoundedString(value.identityFile, 4_096)) return undefined
  if (value.group !== undefined && !isBoundedString(value.group, 256)) return undefined
  return {
    id: value.id,
    name: value.name,
    host: value.host,
    port: value.port,
    username: value.username,
    authMethod: value.authMethod,
    ...(value.identityFile === undefined ? {} : { identityFile: value.identityFile }),
    ...(value.group === undefined ? {} : { group: value.group }),
    favorite: value.favorite,
    notes: value.notes
  }
}

function mapLoadResult<T, U>(result: LoadResult<T>, map: (value: T) => U): LoadResult<U> {
  if (result.status === "blocked") return { status: "blocked", issue: { ...result.issue } }
  if (result.status === "ok") return { status: "ok", value: map(result.value) }
  if (result.status === "recovered") return { status: "recovered", value: map(result.value), source: "backup" }
  return { status: "defaulted", value: map(result.value), reason: result.reason }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
}

function isString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length <= maximumLength
}

function isPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535
}

export function parseOpenSSHConfig(text: string, homeDirectory = homedir()): HostProfile[] {
  const profiles: HostProfile[] = []
  let current: Partial<HostConfigBlock> | undefined

  const flush = (): void => {
    if (!current || !current.alias || current.alias.includes("*") || !current.host) {
      current = undefined
      return
    }
    const identityFile = current.identityFile ? expandHome(current.identityFile, homeDirectory) : undefined
    const username = current.username ?? ""
    const port = parsePort(current.port)
    profiles.push({
      id: stableHostId(current.alias, current.host, port, username),
      name: current.alias,
      host: current.host,
      port,
      username,
      authMethod: identityFile ? "privateKey" : "agent",
      identityFile,
      favorite: false,
      notes: ""
    })
    current = undefined
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim()
    if (!line || line.startsWith("#")) {
      continue
    }
    const separator = line.search(/\s+/)
    if (separator === -1) {
      continue
    }
    const key = line.slice(0, separator).toLowerCase()
    const value = line.slice(separator).trim()
    if (key === "host") {
      flush()
      current = { alias: value.split(/\s+/)[0] }
      continue
    }
    if (!current) {
      continue
    }
    if (key === "hostname") current.host = value
    if (key === "user") current.username = value
    if (key === "port") current.port = value
    if (key === "identityfile") current.identityFile = value.split(/\s+/)[0]
  }
  flush()
  return profiles
}

interface HostConfigBlock {
  alias: string
  host: string
  username?: string
  port?: string
  identityFile?: string
}

function expandHome(value: string, homeDirectory: string): string {
  if (value === "~") return homeDirectory
  if (value.startsWith("~/")) return join(homeDirectory, value.slice(2))
  return value
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? 22)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : 22
}

function stableHostId(alias: string, host: string, port: number, username: string): string {
  return createHash("sha256").update(`${alias}\0${host}\0${port}\0${username}`).digest("hex").slice(0, 20)
}
