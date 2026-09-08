import { randomUUID } from "node:crypto"
import { normalizeHostProfile } from "./host-store"
import { normalizeSettings } from "./settings-store"
import type { CredentialKind, AppSettings, HostProfile } from "./types"
import { createVault, openVault } from "./vault-crypto"
import { validateEncryptedVault, type EncryptedVault } from "./vault-format"

const templateFormat = "rocker-config" as const
const bundleFormat = "rocker-config-bundle" as const
const payloadFormat = "rocker-config-payload" as const
const currentVersion = 1 as const
const maximumBundleBytes = 12 * 1024 * 1024
const maximumHosts = 10_000
const maximumHostKeys = 10_000
const maximumCredentials = 20_000

export interface HostKeyRecord {
  host: string
  port: number
  fingerprint: string
}

export interface BundleCredential {
  hostId: string
  kind: CredentialKind
  value: string
}

export interface ExportSnapshot {
  createdAt?: string
  hosts: HostProfile[]
  settings: AppSettings
  hostKeys?: HostKeyRecord[]
  credentials?: BundleCredential[]
}

export interface ConfigTemplate {
  format: typeof templateFormat
  version: typeof currentVersion
  containsSecrets: false
  createdAt: string
  hosts: HostProfile[]
  settings: AppSettings
}

export interface EncryptedConfigBundle {
  format: typeof bundleFormat
  version: typeof currentVersion
  encrypted: true
  vault: EncryptedVault
}

export interface BundleCounts {
  total: number
  new: number
  matching: number
  conflicts: number
}

export interface ImportPreview {
  format: typeof templateFormat | typeof bundleFormat
  encrypted: boolean
  requiresPassword: boolean
  createdAt?: string
  hosts: BundleCounts
  hostKeys: BundleCounts
  credentials: { total: number }
  hasSettings: boolean
}

export type HostConflictResolution = "keep-local" | "use-imported" | "create-copy" | "skip"
export type HostKeyConflictResolution = "keep-local" | "replace-host-key" | "skip"

export interface ConflictResolution {
  hosts?: Record<string, HostConflictResolution>
  hostKeys?: Record<string, HostKeyConflictResolution>
  applySettings?: boolean
  importCredentials?: boolean
}

export interface ImportResult {
  importedHosts: number
  replacedHosts: number
  copiedHosts: number
  importedHostKeys: number
  replacedHostKeys: number
  importedCredentials: number
  settingsApplied: boolean
}

export interface ConfigImportTarget {
  listHosts(): Promise<HostProfile[]>
  saveHost(profile: HostProfile): Promise<void>
  getSettings(): Promise<AppSettings>
  updateSettings(settings: AppSettings): Promise<void>
  getHostKey(host: string, port: number): Promise<string | undefined>
  trustHostKey(host: string, port: number, fingerprint: string): Promise<void>
  replaceHostKey(host: string, port: number, expected: string, replacement: string): Promise<void>
  assertCredentialsWritable(): Promise<void>
  importCredentials(values: Record<string, string>): Promise<void>
}

interface ConfigPayload {
  format: typeof payloadFormat
  version: typeof currentVersion
  createdAt: string
  hosts: HostProfile[]
  settings: AppSettings
  hostKeys: HostKeyRecord[]
  credentials: BundleCredential[]
}

interface DecodedBundle {
  payload: ConfigPayload
  encrypted: boolean
}

interface HostPlan {
  imported: HostProfile
  profile?: HostProfile
  action: "new" | "matching" | "replace" | "copy" | "skip"
}

interface HostKeyPlan {
  imported: HostKeyRecord
  action: "new" | "matching" | "replace" | "skip"
  expectedFingerprint?: string
}

export function exportTemplate(input: ExportSnapshot): ConfigTemplate {
  const snapshot = normalizeExportSnapshot(input)
  return {
    format: templateFormat,
    version: currentVersion,
    containsSecrets: false,
    createdAt: snapshot.createdAt,
    hosts: snapshot.hosts,
    settings: snapshot.settings
  }
}

export async function exportEncryptedBundle(input: ExportSnapshot, password: string): Promise<Uint8Array> {
  const snapshot = normalizeExportSnapshot(input)
  const payload: ConfigPayload = {
    format: payloadFormat,
    version: currentVersion,
    createdAt: snapshot.createdAt,
    hosts: snapshot.hosts,
    settings: snapshot.settings,
    hostKeys: snapshot.hostKeys,
    credentials: snapshot.credentials
  }
  const vault = await createVault(password, { payload: JSON.stringify(payload) })
  return encode({ format: bundleFormat, version: currentVersion, encrypted: true, vault })
}

export async function inspectBundle(input: Uint8Array, password?: string): Promise<ImportPreview> {
  const document = parseDocument(input)
  if (isEncryptedBundle(document) && password === undefined) {
    return emptyEncryptedPreview()
  }
  const decoded = await decodeDocument(document, password)
  return previewForPayload(decoded.payload, decoded.encrypted)
}

export class ConfigBundleService {
  public constructor(
    private readonly target: ConfigImportTarget,
    private readonly nextHostId: () => string = randomUUID
  ) {}

  public async preview(input: Uint8Array, password?: string): Promise<ImportPreview> {
    const document = parseDocument(input)
    if (isEncryptedBundle(document) && password === undefined) return emptyEncryptedPreview()
    const decoded = await decodeDocument(document, password)
    const localHosts = await this.target.listHosts()
    const hostPlans = planHosts(decoded.payload.hosts, localHosts, {}, this.nextHostId, false)
    const hostKeyPlans = await this.planHostKeys(decoded.payload.hostKeys, {}, false)
    return {
      ...previewForPayload(decoded.payload, decoded.encrypted),
      hosts: countsForHostPlans(hostPlans),
      hostKeys: countsForHostKeyPlans(hostKeyPlans)
    }
  }

  public async import(input: Uint8Array, password: string | undefined, resolution: ConflictResolution): Promise<ImportResult> {
    const decoded = await decodeDocument(parseDocument(input), password)
    const localHosts = await this.target.listHosts()
    const hostPlans = planHosts(decoded.payload.hosts, localHosts, resolution.hosts ?? {}, this.nextHostId, true)
    const hostKeyPlans = await this.planHostKeys(decoded.payload.hostKeys, resolution.hostKeys ?? {}, true)
    if (resolution.importCredentials === true && decoded.payload.credentials.length > 0) {
      await this.target.assertCredentialsWritable()
    }

    for (const plan of hostPlans) {
      if ((plan.action === "new" || plan.action === "replace" || plan.action === "copy") && plan.profile) {
        await this.target.saveHost(plan.profile)
      }
    }
    if (resolution.applySettings === true) await this.target.updateSettings(decoded.payload.settings)
    for (const plan of hostKeyPlans) {
      if (plan.action === "new") {
        await this.target.trustHostKey(plan.imported.host, plan.imported.port, plan.imported.fingerprint)
      } else if (plan.action === "replace") {
        await this.target.replaceHostKey(
          plan.imported.host,
          plan.imported.port,
          plan.expectedFingerprint!,
          plan.imported.fingerprint
        )
      }
    }
    const credentials = resolution.importCredentials === true
      ? remapCredentials(decoded.payload.credentials, hostPlans)
      : {}
    if (Object.keys(credentials).length > 0) await this.target.importCredentials(credentials)

    return {
      importedHosts: hostPlans.filter((plan) => plan.action === "new").length,
      replacedHosts: hostPlans.filter((plan) => plan.action === "replace").length,
      copiedHosts: hostPlans.filter((plan) => plan.action === "copy").length,
      importedHostKeys: hostKeyPlans.filter((plan) => plan.action === "new").length,
      replacedHostKeys: hostKeyPlans.filter((plan) => plan.action === "replace").length,
      importedCredentials: Object.keys(credentials).length,
      settingsApplied: resolution.applySettings === true
    }
  }

  private async planHostKeys(
    imported: HostKeyRecord[],
    resolutions: Record<string, HostKeyConflictResolution>,
    requireResolution: boolean
  ): Promise<HostKeyPlan[]> {
    const plans: HostKeyPlan[] = []
    for (const record of imported) {
      const existing = await this.target.getHostKey(record.host, record.port)
      if (existing === undefined) {
        plans.push({ imported: record, action: "new" })
        continue
      }
      if (existing === record.fingerprint) {
        plans.push({ imported: record, action: "matching" })
        continue
      }
      const resolution = resolutions[hostKeyId(record)]
      if (requireResolution && resolution === undefined) throw new Error("Import conflict requires resolution")
      plans.push({
        imported: record,
        expectedFingerprint: existing,
        action: resolution === "replace-host-key" ? "replace" : "skip"
      })
    }
    return plans
  }
}

function parseDocument(input: Uint8Array): ConfigTemplate | EncryptedConfigBundle {
  if (!(input instanceof Uint8Array) || input.byteLength === 0 || input.byteLength > maximumBundleBytes) {
    throw new Error("Bundle is invalid")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input))
  } catch {
    throw new Error("Bundle is invalid")
  }
  const template = normalizeTemplate(parsed)
  if (template) return template
  const encrypted = normalizeEncryptedBundle(parsed)
  if (encrypted) return encrypted
  throw new Error("Bundle is invalid")
}

async function decodeDocument(document: ConfigTemplate | EncryptedConfigBundle, password: string | undefined): Promise<DecodedBundle> {
  if (!isEncryptedBundle(document)) {
    return { encrypted: false, payload: { ...document, format: payloadFormat, hostKeys: [], credentials: [] } }
  }
  if (password === undefined) throw new Error("Bundle password is required")
  try {
    const values = await openVault(password, document.vault)
    if (typeof values.payload !== "string") throw new Error("invalid payload")
    const payload = normalizePayload(JSON.parse(values.payload))
    if (!payload) throw new Error("invalid payload")
    return { encrypted: true, payload }
  } catch {
    throw new Error("Bundle could not be opened")
  }
}

function normalizeExportSnapshot(value: ExportSnapshot): Required<ExportSnapshot> {
  const createdAt = normalizeTimestamp(value.createdAt ?? new Date().toISOString())
  const hosts = normalizeHosts(value.hosts)
  const settings = normalizeSettings(value.settings)
  const hostKeys = normalizeHostKeys(value.hostKeys ?? [])
  const credentials = normalizeCredentials(value.credentials ?? [], hosts)
  if (!createdAt || !settings) throw new Error("Configuration export is invalid")
  return { createdAt, hosts, settings, hostKeys, credentials }
}

function normalizeTemplate(value: unknown): ConfigTemplate | undefined {
  if (!isRecord(value) || value.format !== templateFormat || value.version !== currentVersion || value.containsSecrets !== false) return undefined
  const createdAt = normalizeTimestamp(value.createdAt)
  const hosts = normalizeHosts(value.hosts)
  const settings = normalizeSettings(value.settings)
  if (!createdAt || !settings) return undefined
  return { format: templateFormat, version: currentVersion, containsSecrets: false, createdAt, hosts, settings }
}

function normalizeEncryptedBundle(value: unknown): EncryptedConfigBundle | undefined {
  if (!isRecord(value) || value.format !== bundleFormat || value.version !== currentVersion || value.encrypted !== true) return undefined
  const vault = validateEncryptedVault(value.vault)
  return vault ? { format: bundleFormat, version: currentVersion, encrypted: true, vault } : undefined
}

function normalizePayload(value: unknown): ConfigPayload | undefined {
  if (!isRecord(value) || value.format !== payloadFormat || value.version !== currentVersion) return undefined
  const createdAt = normalizeTimestamp(value.createdAt)
  const hosts = normalizeHosts(value.hosts)
  const settings = normalizeSettings(value.settings)
  const hostKeys = normalizeHostKeys(value.hostKeys)
  if (!createdAt || !settings || !Array.isArray(value.credentials)) return undefined
  let credentials: BundleCredential[]
  try {
    credentials = normalizeCredentials(value.credentials, hosts)
  } catch {
    return undefined
  }
  return { format: payloadFormat, version: currentVersion, createdAt, hosts, settings, hostKeys, credentials }
}

function normalizeHosts(value: unknown): HostProfile[] {
  if (!Array.isArray(value) || value.length > maximumHosts) throw new Error("Configuration hosts are invalid")
  const hosts: HostProfile[] = []
  const ids = new Set<string>()
  for (const item of value) {
    const host = normalizeHostProfile(item)
    if (!host) throw new Error("Configuration hosts are invalid")
    if (ids.has(host.id)) throw new Error("Configuration hosts are invalid")
    ids.add(host.id)
    hosts.push(host)
  }
  return hosts
}

function normalizeHostKeys(value: unknown): HostKeyRecord[] {
  if (!Array.isArray(value) || value.length > maximumHostKeys) throw new Error("Configuration Host Keys are invalid")
  const keys: HostKeyRecord[] = []
  const ids = new Set<string>()
  for (const item of value) {
    if (!isRecord(item)) {
      throw new Error("Configuration Host Keys are invalid")
    }
    const host = item.host
    const port = item.port
    const rawFingerprint = item.fingerprint
    if (!isBoundedString(host, 512) || !isPort(port) || !isBoundedString(rawFingerprint, 512)) {
      throw new Error("Configuration Host Keys are invalid")
    }
    const fingerprint = rawFingerprint.replace(/^SHA256:/i, "")
    if (fingerprint.length === 0) throw new Error("Configuration Host Keys are invalid")
    const record = { host, port, fingerprint }
    if (ids.has(hostKeyId(record))) throw new Error("Configuration Host Keys are invalid")
    ids.add(hostKeyId(record))
    keys.push(record)
  }
  return keys
}

function normalizeCredentials(value: unknown, hosts: HostProfile[]): BundleCredential[] {
  if (!Array.isArray(value) || value.length > maximumCredentials) throw new Error("Configuration credentials are invalid")
  const hostIds = new Set(hosts.map((host) => host.id))
  const credentials: BundleCredential[] = []
  const ids = new Set<string>()
  for (const item of value) {
    if (!isRecord(item)) {
      throw new Error("Configuration credentials are invalid")
    }
    const hostId = item.hostId
    const kind = item.kind
    const credentialValue = item.value
    if (!isBoundedString(hostId, 128) || !hostIds.has(hostId) || (kind !== "password" && kind !== "passphrase") || !isBoundedString(credentialValue, 2_000_000)) {
      throw new Error("Configuration credentials are invalid")
    }
    const id = `${hostId}\u0000${kind}`
    if (ids.has(id)) throw new Error("Configuration credentials are invalid")
    ids.add(id)
    credentials.push({ hostId, kind, value: credentialValue })
  }
  return credentials
}

function planHosts(
  imported: HostProfile[],
  local: HostProfile[],
  resolutions: Record<string, HostConflictResolution>,
  nextHostId: () => string,
  requireResolution: boolean
): HostPlan[] {
  const localById = new Map(local.map((host) => [host.id, host]))
  return imported.map((profile) => {
    const existing = localById.get(profile.id)
    if (!existing) return { imported: profile, profile, action: "new" }
    if (sameHost(existing, profile)) return { imported: profile, profile: existing, action: "matching" }
    const resolution = resolutions[profile.id]
    if (requireResolution && resolution === undefined) throw new Error("Import conflict requires resolution")
    if (resolution === "use-imported") return { imported: profile, profile, action: "replace" }
    if (resolution === "create-copy") {
      const copy = { ...profile, id: nextHostId(), name: importedCopyName(profile.name) }
      return { imported: profile, profile: copy, action: "copy" }
    }
    return { imported: profile, action: "skip" }
  })
}

function remapCredentials(credentials: BundleCredential[], plans: HostPlan[]): Record<string, string> {
  const mappings = new Map(
    plans
      .filter((plan): plan is HostPlan & { profile: HostProfile } => plan.profile !== undefined)
      .map((plan) => [plan.imported.id, plan.profile.id])
  )
  const values: Record<string, string> = {}
  for (const credential of credentials) {
    const hostId = mappings.get(credential.hostId)
    if (hostId) values[`${hostId}:${credential.kind}`] = credential.value
  }
  return values
}

function previewForPayload(payload: ConfigPayload, encrypted: boolean): ImportPreview {
  return {
    format: encrypted ? bundleFormat : templateFormat,
    encrypted,
    requiresPassword: false,
    createdAt: payload.createdAt,
    hosts: { total: payload.hosts.length, new: 0, matching: 0, conflicts: 0 },
    hostKeys: { total: payload.hostKeys.length, new: 0, matching: 0, conflicts: 0 },
    credentials: { total: payload.credentials.length },
    hasSettings: true
  }
}

function emptyEncryptedPreview(): ImportPreview {
  return {
    format: bundleFormat,
    encrypted: true,
    requiresPassword: true,
    hosts: { total: 0, new: 0, matching: 0, conflicts: 0 },
    hostKeys: { total: 0, new: 0, matching: 0, conflicts: 0 },
    credentials: { total: 0 },
    hasSettings: false
  }
}

function countsForHostPlans(plans: HostPlan[]): BundleCounts {
  return {
    total: plans.length,
    new: plans.filter((plan) => plan.action === "new").length,
    matching: plans.filter((plan) => plan.action === "matching").length,
    conflicts: plans.filter((plan) => plan.action === "replace" || plan.action === "copy" || plan.action === "skip").length
  }
}

function countsForHostKeyPlans(plans: HostKeyPlan[]): BundleCounts {
  return {
    total: plans.length,
    new: plans.filter((plan) => plan.action === "new").length,
    matching: plans.filter((plan) => plan.action === "matching").length,
    conflicts: plans.filter((plan) => plan.action === "replace" || plan.action === "skip").length
  }
}

function isEncryptedBundle(value: ConfigTemplate | EncryptedConfigBundle): value is EncryptedConfigBundle {
  return value.format === bundleFormat
}

function sameHost(left: HostProfile, right: HostProfile): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function hostKeyId(value: Pick<HostKeyRecord, "host" | "port">): string {
  return `${value.host}:${value.port}`
}

function importedCopyName(value: string): string {
  const suffix = " (Imported)"
  return value.length + suffix.length <= 256 ? `${value}${suffix}` : `${value.slice(0, 256 - suffix.length)}${suffix}`
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (!isBoundedString(value, 80) || Number.isNaN(Date.parse(value))) return undefined
  return new Date(value).toISOString()
}

function encode(value: EncryptedConfigBundle): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  if (bytes.byteLength > maximumBundleBytes) throw new Error("Configuration export is too large")
  return bytes
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
}

function isPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535
}
