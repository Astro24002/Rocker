import { describe, expect, it } from "vitest"
import {
  collectProductionPackages,
  findOsvVulnerabilities,
  parseCurlResponse,
  runOsvAudit
} from "../scripts/audit-production.mjs"

describe("production audit fallback", () => {
  it("collects unique non-dev lockfile packages, including optional runtime packages", () => {
    const packages = collectProductionPackages({
      packages: {
        "": { version: "0.4.0" },
        "node_modules/ssh2": { version: "1.17.0" },
        "node_modules/cpu-features": { version: "0.0.10", optional: true },
        "node_modules/@scope/tool": { version: "2.0.0", dev: true },
        "node_modules/parent/node_modules/ssh2": { version: "1.17.0" }
      }
    })

    expect(packages).toEqual([
      { name: "cpu-features", version: "0.0.10" },
      { name: "ssh2", version: "1.17.0" }
    ])
  })

  it("reports only OSV advisories returned for queried packages", () => {
    const vulnerabilities = findOsvVulnerabilities({
      results: [
        {},
        { vulns: [{ id: "GHSA-test", summary: "test advisory" }] }
      ]
    })

    expect(vulnerabilities).toEqual([{ id: "GHSA-test", summary: "test advisory" }])
  })

  it("passes an empty OSV result and sends only package coordinates", async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    const fetchImpl = async (url: string, options: { body?: string }) => {
      requests.push({ url, body: JSON.parse(options.body ?? "{}") })
      return new Response(JSON.stringify({ results: [{}] }), { status: 200 })
    }

    await expect(runOsvAudit({
      lockfile: {
        packages: {
          "": { version: "0.4.0" },
          "node_modules/ssh2": { version: "1.17.0" },
          "node_modules/test-only": { version: "1.0.0", dev: true }
        }
      },
      fetchImpl
    })).resolves.toEqual([])

    expect(requests).toEqual([{
      url: "https://api.osv.dev/v1/querybatch",
      body: {
        queries: [{ package: { ecosystem: "npm", name: "ssh2" }, version: "1.17.0" }]
      }
    }])
  })

  it("fails when OSV reports a vulnerability or the service is unavailable", async () => {
    const vulnerableFetch = async () => new Response(JSON.stringify({
      results: [{ vulns: [{ id: "GHSA-test", summary: "test advisory" }] }]
    }), { status: 200 })
    const unavailableFetch = async () => new Response("unavailable", { status: 503 })
    const lockfile = {
      packages: {
        "": { version: "0.4.0" },
        "node_modules/ssh2": { version: "1.17.0" }
      }
    }

    await expect(runOsvAudit({ lockfile, fetchImpl: vulnerableFetch })).rejects.toThrow("GHSA-test")
    await expect(runOsvAudit({ lockfile, fetchImpl: unavailableFetch })).rejects.toThrow("503")
  })

  it("parses curl JSON output and rejects non-success HTTP statuses", () => {
    expect(parseCurlResponse('{"results":[]}\n200')).toEqual({
      body: { results: [] },
      status: 200
    })
    expect(() => parseCurlResponse("unavailable\n503")).toThrow("503")
  })
})
