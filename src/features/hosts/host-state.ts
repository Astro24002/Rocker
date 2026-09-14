import type { ConnectionHistoryItem, HostEnvironment, HostPlatform, HostProfile } from "../../app/types"

export type HostIconPlatform = HostPlatform | "rocker"

export interface DirectSshTarget {
  username?: string
  host: string
  port: number
}

export function hostForSshTarget(hosts: HostProfile[], target: DirectSshTarget): HostProfile | undefined {
  return hosts.find((host) => host.host === target.host && host.port === target.port && (target.username === undefined || host.username === target.username))
}

export function getHostPlatform(host: Pick<HostProfile, "platform">): HostIconPlatform {
  if (host.platform === "ubuntu" || host.platform === "debian" || host.platform === "linux") return host.platform
  return "rocker"
}

export function isCompleteSshCommand(value: string): boolean {
  return parseSshCommand(value) !== undefined
}

export function parseSshCommand(value: string): DirectSshTarget | undefined {
  const normalized = value.trim().replace(/\s+/g, " ")
  if (!/^ssh\s+/i.test(normalized)) return undefined
  const tokens = normalized.split(" ").slice(1)
  if (tokens.length < 1 || tokens.length > 3) return undefined
  const destination = tokens[0]
  if (!/^(?:[a-z0-9._-]+@)?(?:[a-z0-9._-]+|\[[0-9a-f:]+\])$/i.test(destination)) return undefined
  if (tokens.length === 2 || tokens.length > 1 && tokens[1] !== "-p") return undefined
  if (tokens.length === 3 && (!/^\d{1,5}$/.test(tokens[2]) || Number(tokens[2]) < 1 || Number(tokens[2]) > 65535)) return undefined
  const at = destination.lastIndexOf("@")
  const host = at === -1 ? destination : destination.slice(at + 1)
  return {
    ...(at === -1 ? {} : { username: destination.slice(0, at) }),
    host: host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host,
    port: tokens.length === 3 ? Number(tokens[2]) : 22
  }
}

export function upsertHost(hosts: HostProfile[], profile: HostProfile): HostProfile[] {
  const index = hosts.findIndex((host) => host.id === profile.id)
  if (index === -1) return [...hosts, profile]
  return hosts.map((host) => host.id === profile.id ? profile : host)
}

export function removeHost(hosts: HostProfile[], id: string): HostProfile[] {
  return hosts.filter((host) => host.id !== id)
}

export function toggleFavorite(hosts: HostProfile[], id: string): HostProfile[] {
  return hosts.map((host) => host.id === id ? { ...host, favorite: !host.favorite } : host)
}

export interface HostFilterOptions {
  group: string
  query: string
  recentOnly?: boolean
  recentHostIds?: ReadonlySet<string>
  environment?: HostEnvironment | "all"
  tag?: string
}

export function recentHostIds(
  items: Pick<ConnectionHistoryItem, "hostId" | "connectedAt" | "outcome">[],
  limit = 8
): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  const maximum = Math.max(0, Math.floor(limit))
  if (maximum === 0) return result
  for (const item of [...items]
    .filter((candidate) => candidate.outcome === "connected" || candidate.outcome === "disconnected")
    .sort((left, right) => right.connectedAt.localeCompare(left.connectedAt))) {
    if (seen.has(item.hostId)) continue
    seen.add(item.hostId)
    result.push(item.hostId)
    if (result.length >= maximum) break
  }
  return result
}

export function filterHosts(hosts: HostProfile[], options: HostFilterOptions): HostProfile[] {
  const normalizedGroup = options.group.trim().toLowerCase()
  const normalizedQuery = options.query.trim().toLowerCase()
  const normalizedEnvironment = options.environment?.trim().toLowerCase()
  const normalizedTag = options.tag?.trim().toLowerCase()
  return hosts.filter((host) => {
    const matchesGroup = normalizedGroup === "all" || host.group?.trim().toLowerCase() === normalizedGroup
    const matchesRecent = !options.recentOnly || options.recentHostIds?.has(host.id) === true
    const matchesEnvironment = !normalizedEnvironment || normalizedEnvironment === "all" || host.environment === normalizedEnvironment
    const matchesTag = !normalizedTag || normalizedTag === "all" || host.tags?.some((tag) => tag.trim().toLowerCase() === normalizedTag) === true
    const searchable = `${host.name} ${host.host} ${host.username} ${host.group ?? ""} ${host.environment ?? ""} ${(host.tags ?? []).join(" ")}`.toLowerCase()
    return matchesGroup && matchesRecent && matchesEnvironment && matchesTag && (!normalizedQuery || searchable.includes(normalizedQuery))
  })
}
