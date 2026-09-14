import { describe, expect, it } from "vitest"
import type { HostProfile } from "../../app/types"
import { filterHosts, getHostPlatform, hostForSshTarget, isCompleteSshCommand, parseSshCommand, recentHostIds, removeHost, toggleFavorite, upsertHost } from "./host-state"

const host: HostProfile = {
  id: "one",
  name: "G11",
  host: "10.0.0.11",
  port: 22,
  username: "rock",
  authMethod: "agent",
  group: "Personal",
  favorite: false,
  notes: ""
}

describe("host state", () => {
  it("creates, updates, removes, and favorites hosts", () => {
    const created = upsertHost([], host)
    expect(created).toHaveLength(1)
    expect(upsertHost(created, { ...host, name: "G11 prod" })[0].name).toBe("G11 prod")
    expect(toggleFavorite(created, host.id)[0].favorite).toBe(true)
    expect(removeHost(created, host.id)).toHaveLength(0)
  })

  it("filters by group and search query", () => {
    const other = { ...host, id: "two", name: "Database", group: "Production", host: "db.internal" }
    expect(filterHosts([host, other], { group: "prod", query: "" })).toEqual([])
    expect(filterHosts([host, other], { group: "Production", query: "" })).toEqual([other])
    expect(filterHosts([host, other], { group: "all", query: "g11" })).toEqual([host])
  })

  it("filters by exact environment and tag while searching tag text", () => {
    const production = { ...host, id: "production", environment: "production" as const, tags: ["Core", "Linux"] }
    const staging = { ...host, id: "staging", environment: "staging" as const, tags: ["Database"] }

    expect(filterHosts([production, staging], { group: "all", query: "", environment: "production" })).toEqual([production])
    expect(filterHosts([production, staging], { group: "all", query: "", tag: "linux" })).toEqual([production])
    expect(filterHosts([production, staging], { group: "all", query: "database" })).toEqual([staging])
  })

  it("derives unique recent hosts from successful history in newest-first order", () => {
    const recent = recentHostIds([
      { hostId: "old", connectedAt: "2026-01-01T00:00:00.000Z", outcome: "connected" },
      { hostId: "new", connectedAt: "2026-01-03T00:00:00.000Z", outcome: "disconnected" },
      { hostId: "failed", connectedAt: "2026-01-04T00:00:00.000Z", outcome: "failed" },
      { hostId: "new", connectedAt: "2026-01-02T00:00:00.000Z", outcome: "connected" },
      { hostId: "middle", connectedAt: "2026-01-02T12:00:00.000Z", outcome: "connected" }
    ], 2)

    expect(recent).toEqual(["new", "middle"])
    expect(filterHosts([
      { ...host, id: "old" },
      { ...host, id: "new", name: "New host" },
      { ...host, id: "middle", name: "Middle host" }
    ], { group: "all", query: "", recentOnly: true, recentHostIds: new Set(recent) })).toHaveLength(2)
  })

  it("uses Rocker as the fallback icon and preserves known Linux platforms", () => {
    expect(getHostPlatform(host)).toBe("rocker")
    expect(getHostPlatform({ ...host, platform: "ubuntu" } as never)).toBe("ubuntu")
    expect(getHostPlatform({ ...host, platform: "debian" } as never)).toBe("debian")
    expect(getHostPlatform({ ...host, platform: "unknown" } as never)).toBe("rocker")
  })

  it("recognizes only complete direct SSH commands", () => {
    expect(isCompleteSshCommand("ssh root@127.0.0.1")).toBe(true)
    expect(isCompleteSshCommand("ssh root@127.0.0.1 -p 27001")).toBe(true)
    expect(isCompleteSshCommand("ssh 127.0.0.1 -p 65535")).toBe(true)
    expect(isCompleteSshCommand("ssh root@127.0.0.1 -p")).toBe(false)
    expect(isCompleteSshCommand("ssh root@127.0.0.1 -p 0")).toBe(false)
    expect(isCompleteSshCommand("ssh root@127.0.0.1 -p 65536")).toBe(false)
    expect(isCompleteSshCommand("Find a host")).toBe(false)
    expect(parseSshCommand("ssh root@127.0.0.1 -p 27001")).toEqual({ username: "root", host: "127.0.0.1", port: 27001 })
    expect(parseSshCommand("ssh 127.0.0.1")).toEqual({ host: "127.0.0.1", port: 22 })
    expect(hostForSshTarget([host], { username: "rock", host: "10.0.0.11", port: 22 })).toBe(host)
  })
})
