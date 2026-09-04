import { execFile as execFileCallback } from "node:child_process"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { promisify } from "node:util"

export const OSV_AUDIT_ENDPOINT = "https://api.osv.dev/v1/querybatch"
const execFile = promisify(execFileCallback)

function packageNameFromLockPath(path) {
  const marker = "node_modules/"
  const markerIndex = path.lastIndexOf(marker)
  return markerIndex < 0 ? undefined : path.slice(markerIndex + marker.length)
}

export function collectProductionPackages(lockfile) {
  const packages = new Map()
  for (const [path, metadata] of Object.entries(lockfile?.packages ?? {})) {
    if (!path || metadata?.dev === true || typeof metadata?.version !== "string") continue
    const name = packageNameFromLockPath(path)
    if (!name) continue
    packages.set(`${name}@${metadata.version}`, { name, version: metadata.version })
  }

  return [...packages.values()].sort((left, right) =>
    left.name.localeCompare(right.name) || left.version.localeCompare(right.version)
  )
}

export function findOsvVulnerabilities(report) {
  if (!Array.isArray(report?.results)) return []
  return report.results.flatMap((result) =>
    Array.isArray(result?.vulns) ? result.vulns.filter((vulnerability) => vulnerability && typeof vulnerability === "object") : []
  )
}

export function parseCurlResponse(output) {
  const separatorIndex = output.lastIndexOf("\n")
  if (separatorIndex < 0) throw new Error("OSV audit response did not include an HTTP status")

  const status = Number(output.slice(separatorIndex + 1).trim())
  if (!Number.isInteger(status)) throw new Error("OSV audit response included an invalid HTTP status")
  if (status < 200 || status >= 300) throw new Error(`OSV audit request failed with HTTP ${status}`)

  try {
    return { body: JSON.parse(output.slice(0, separatorIndex)), status }
  } catch (error) {
    throw new Error(`OSV audit response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function requestWithCurl(endpoint, payload, timeoutMs) {
  let stdout
  try {
    ({ stdout } = await execFile("curl", [
      "--silent",
      "--show-error",
      "--connect-timeout",
      String(Math.max(1, Math.ceil(timeoutMs / 3_000))),
      "--max-time",
      String(Math.max(1, Math.ceil(timeoutMs / 1_000))),
      "--output",
      "-",
      "--write-out",
      "\n%{http_code}",
      "--request",
      "POST",
      "--header",
      "content-type: application/json",
      "--data-binary",
      payload,
      endpoint
    ], { maxBuffer: 16 * 1024 * 1024 }))
  } catch (error) {
    throw new Error(`OSV audit curl request failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseCurlResponse(stdout)
}

export async function runOsvAudit({
  lockfile,
  fetchImpl,
  endpoint = OSV_AUDIT_ENDPOINT,
  timeoutMs = 30_000
} = {}) {
  const packages = collectProductionPackages(lockfile)
  const payload = JSON.stringify({
    queries: packages.map(({ name, version }) => ({
      package: { ecosystem: "npm", name },
      version
    }))
  })
  let report
  if (typeof fetchImpl === "function") {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok) throw new Error(`OSV audit request failed with HTTP ${response.status}`)
    report = await response.json()
  } else {
    report = (await requestWithCurl(endpoint, payload, timeoutMs)).body
  }
  if (!Array.isArray(report?.results) || report.results.length !== packages.length) {
    const resultCount = Array.isArray(report?.results) ? report.results.length : 0
    throw new Error(`OSV audit returned ${resultCount} results for ${packages.length} queries`)
  }

  const vulnerabilities = findOsvVulnerabilities(report)
  if (vulnerabilities.length) {
    const identifiers = vulnerabilities.map((vulnerability) => vulnerability.id ?? "unknown-advisory")
    throw new Error(`OSV audit found vulnerabilities: ${identifiers.join(", ")}`)
  }
  return vulnerabilities
}

async function runCli() {
  const lockfilePath = resolve("package-lock.json")
  const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"))
  const packages = collectProductionPackages(lockfile)
  await runOsvAudit({
    lockfile,
    endpoint: process.env.ROCKER_OSV_AUDIT_ENDPOINT || OSV_AUDIT_ENDPOINT
  })
  console.log(`OSV production fallback audit passed for ${packages.length} lockfile packages`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
