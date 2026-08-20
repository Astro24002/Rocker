import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SettingsStore } from "./settings-store"

const temporaryPaths: string[] = []

afterEach(async () => Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("SettingsStore", () => {
  it("drops the obsolete scan interval while normalizing a legacy document", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-settings-"))
    temporaryPaths.push(directory)
    const settingsPath = join(directory, "settings.json")
    await writeFile(settingsPath, JSON.stringify({
      locale: "en",
      sidebarWidth: 220,
      terminalFont: "JetBrains Mono",
      terminalFontSize: 13,
      connectionTimeout: 15,
      autoReconnect: true,
      portScanInterval: 15,
      bindAddress: "127.0.0.1"
    }), "utf8")

    const store = new SettingsStore(settingsPath)
    const settings = await store.get()

    expect(settings).not.toHaveProperty("portScanInterval")
    await store.update({})
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).not.toHaveProperty("portScanInterval")
  })
})
