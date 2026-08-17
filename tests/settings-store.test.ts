import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SettingsStore } from "../electron/storage/settings-store"

const temporaryPaths: string[] = []

afterEach(async () => Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("desktop settings", () => {
  it("provides defaults and persists bounded updates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-settings-"))
    temporaryPaths.push(directory)
    const store = new SettingsStore(join(directory, "settings.json"))
    expect((await store.get()).locale).toBe("en")
    await store.update({ locale: "zh-CN", sidebarWidth: 999 })
    expect(await store.get()).toMatchObject({ locale: "zh-CN", sidebarWidth: 360 })
  })
})
