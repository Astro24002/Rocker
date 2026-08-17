import { describe, expect, it } from "vitest"
import type { HostProfile } from "../../app/types"
import { duplicateHost, filterHosts, removeHost, toggleFavorite, upsertHost } from "./host-state"

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

  it("duplicates with a distinct identifier and copy label", () => {
    const duplicate = duplicateHost(host, "two")
    expect(duplicate).toMatchObject({ id: "two", name: "G11 copy", favorite: false })
  })

  it("filters by group and search query", () => {
    const other = { ...host, id: "two", name: "Database", group: "Production", host: "db.internal" }
    expect(filterHosts([host, other], "prod", "")).toEqual([other])
    expect(filterHosts([host, other], "all", "g11")).toEqual([host])
  })
})
