import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"
import { JsonStore } from "./json-store"
import type { HostProfile, StoredHostDocument } from "./types"

const defaultDocument: StoredHostDocument = { hosts: [] }

export class HostStore {
  public constructor(private readonly store: JsonStore<StoredHostDocument>) {}

  public async list(): Promise<HostProfile[]> {
    const document = await this.readDocument()
    return document.hosts.map((host) => ({ ...host }))
  }

  public async save(profile: HostProfile): Promise<void> {
    const document = await this.readDocument()
    const index = document.hosts.findIndex((host) => host.id === profile.id)
    if (index === -1) {
      document.hosts.push({ ...profile })
    } else {
      document.hosts[index] = { ...profile }
    }
    await this.store.write(document)
  }

  public async remove(id: string): Promise<void> {
    const document = await this.readDocument()
    document.hosts = document.hosts.filter((host) => host.id !== id)
    await this.store.write(document)
  }

  public async importOpenSSHConfig(text: string, homeDirectory = homedir()): Promise<HostProfile[]> {
    const profiles = parseOpenSSHConfig(text, homeDirectory)
    const document = await this.readDocument()
    const existingIds = new Set(document.hosts.map((host) => host.id))
    for (const profile of profiles) {
      if (!existingIds.has(profile.id)) {
        document.hosts.push(profile)
      }
    }
    await this.store.write(document)
    return profiles
  }

  private async readDocument(): Promise<StoredHostDocument> {
    const document = await this.store.read()
    return {
      hosts: Array.isArray(document.hosts) ? document.hosts : []
    }
  }
}

export function createHostStore(userDataPath: string): HostStore {
  return new HostStore(new JsonStore(join(userDataPath, "rocker.json"), defaultDocument))
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
