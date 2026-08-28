import { readdir } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const RELEASE_ASSET_SUFFIXES = [
  "x64.exe",
  "arm64.exe",
  "x64.dmg",
  "arm64.dmg",
  "x64.zip",
  "arm64.zip"
]

async function collectEntries(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  const directories = []

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name)
    const relativePath = relative(root, absolutePath)
    if (entry.isDirectory()) {
      directories.push(relativePath)
      const nested = await collectEntries(absolutePath, root)
      files.push(...nested.files)
      directories.push(...nested.directories)
    } else {
      files.push(relativePath)
    }
  }

  return { files, directories }
}

export async function verifyReleaseAssets(version, directory = "release") {
  if (typeof version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${String(version)}`)
  }

  const expected = new Set(RELEASE_ASSET_SUFFIXES.map((suffix) => `Rocker-v${version}-${suffix}`))
  const entries = await collectEntries(directory)
  const fileNames = entries.files.map((entry) => entry.split(/[\\/]/).pop())
  const counts = new Map()
  for (const fileName of fileNames) counts.set(fileName, (counts.get(fileName) ?? 0) + 1)

  const unexpected = entries.files.filter((entry) => !expected.has(entry.split(/[\\/]/).pop()))
  const unpackedDirectories = entries.directories.filter((entry) => entry.endsWith(".app"))
  const duplicates = [...counts.entries()].filter(([name, count]) => expected.has(name) && count > 1).map(([name]) => name)
  const missing = [...expected].filter((name) => !counts.has(name))

  if (unexpected.length || unpackedDirectories.length || duplicates.length || missing.length) {
    const details = []
    if (missing.length) details.push(`missing: ${missing.join(", ")}`)
    if (duplicates.length) details.push(`duplicates: ${duplicates.join(", ")}`)
    if (unexpected.length) details.push(`unexpected: ${unexpected.join(", ")}`)
    if (unpackedDirectories.length) details.push(`unexpected directories: ${unpackedDirectories.join(", ")}`)
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
