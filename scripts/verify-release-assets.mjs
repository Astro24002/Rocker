import { readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const RELEASE_ASSET_SUFFIXES = [
  "x64.exe",
  "arm64.exe",
  "x64.dmg",
  "arm64.dmg",
  "x64.zip",
  "arm64.zip"
]

export async function verifyReleaseAssets(version, directory = "release") {
  if (typeof version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${String(version)}`)
  }

  const expected = new Set(RELEASE_ASSET_SUFFIXES.map((suffix) => `Rocker-v${version}-${suffix}`))
  const entries = await readdir(directory, { withFileTypes: true })
  const unexpected = entries
    .filter((entry) => !entry.isFile() || !expected.has(entry.name))
    .map((entry) => entry.name)
  const missing = [...expected].filter((name) => !entries.some((entry) => entry.isFile() && entry.name === name))

  if (unexpected.length || missing.length) {
    const details = []
    if (missing.length) details.push(`missing: ${missing.join(", ")}`)
    if (unexpected.length) details.push(`unexpected: ${unexpected.join(", ")}`)
    throw new Error(`Release asset allow-list failed (${details.join("; ")})`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, directory = "release"] = process.argv.slice(2)
  verifyReleaseAssets(version, directory).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
