export type ProductionPackage = {
  name: string
  version: string
}

export type Lockfile = {
  packages?: Record<string, {
    version?: string
    dev?: boolean
    optional?: boolean
  }>
}

export type OsvVulnerability = {
  id?: string
  summary?: string
  [key: string]: unknown
}

export function collectProductionPackages(lockfile: Lockfile): ProductionPackage[]
export function findOsvVulnerabilities(report: { results?: Array<{ vulns?: OsvVulnerability[] }> }): OsvVulnerability[]
export function parseCurlResponse(output: string): { body: unknown; status: number }
export function runOsvAudit(options: {
  lockfile: Lockfile
  fetchImpl?: (input: string, init: {
    method: string
    headers: Record<string, string>
    body: string
    signal: AbortSignal
  }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
  endpoint?: string
  timeoutMs?: number
}): Promise<OsvVulnerability[]>
