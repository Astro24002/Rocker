import type { HostProfile } from "../../app/types"

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

export function duplicateHost(host: HostProfile, id: string): HostProfile {
  return {
    ...host,
    id,
    name: `${host.name} copy`,
    favorite: false
  }
}

export function filterHosts(hosts: HostProfile[], group: string, query: string): HostProfile[] {
  const normalizedQuery = query.trim().toLowerCase()
  return hosts.filter((host) => {
    const matchesGroup = group === "all" || host.group?.toLowerCase().includes(group.toLowerCase())
    const searchable = `${host.name} ${host.host} ${host.username} ${host.group ?? ""}`.toLowerCase()
    return matchesGroup && (!normalizedQuery || searchable.includes(normalizedQuery))
  })
}
