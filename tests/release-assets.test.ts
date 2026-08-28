import { execFile as execFileCallback } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"

const execFile = promisify(execFileCallback)
const assetSuffixes = ["x64.exe", "arm64.exe", "x64.dmg", "arm64.dmg", "x64.zip", "arm64.zip"]
const scriptPath = resolve(process.cwd(), "scripts/verify-release-assets.mjs")

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("release asset allow-list", () => {
  it("accepts exactly the six versioned installer and archive assets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-release-assets-"))
    directories.push(directory)
    await Promise.all(assetSuffixes.map((suffix: string) => writeFile(join(directory, `Rocker-v0.3.1-${suffix}`), "asset")))

    await expect(execFile(process.execPath, [scriptPath, "0.3.1", directory])).resolves.toBeTruthy()
  })

  it("accepts installers nested under downloaded artifact directories", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-release-assets-"))
    directories.push(directory)
    await Promise.all(
      assetSuffixes.map(async (suffix: string) => {
        const artifactDirectory = suffix.endsWith(".exe") ? "rocker-Windows" : "rocker-macOS"
        const nestedDirectory = join(directory, artifactDirectory)
        await mkdir(nestedDirectory, { recursive: true })
        await writeFile(join(nestedDirectory, `Rocker-v0.3.1-${suffix}`), "asset")
      })
    )

    await expect(execFile(process.execPath, [scriptPath, "0.3.1", directory])).resolves.toBeTruthy()
  })

  it("rejects debug metadata, blockmaps, and unpacked application directories", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-release-assets-"))
    directories.push(directory)
    await Promise.all(assetSuffixes.map((suffix: string) => writeFile(join(directory, `Rocker-v0.3.1-${suffix}`), "asset")))
    await writeFile(join(directory, "builder-debug.yml"), "debug")
    await writeFile(join(directory, "Rocker-v0.3.1-x64.dmg.blockmap"), "blockmap")
    await mkdir(join(directory, "Rocker.app"))

    await expect(execFile(process.execPath, [scriptPath, "0.3.1", directory])).rejects.toThrow("allow-list failed")
  })
})
