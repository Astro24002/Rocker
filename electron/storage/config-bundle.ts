import { randomUUID } from "node:crypto"
import { normalizeHostProfile } from "./host-store"
import { normalizeSettings } from "./settings-store"
import type { CredentialImportResult } from "./credentials"
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

export interface HostConflictPreview {
  id: string
  name: string
  host: string
  port: number
  username: string
}

export interface HostKeyConflictPreview {
  id: string
  host: string
  port: number
  localFingerprint: string
  importedFingerprint: string
}

export interface ImportPreview {
  format: typeof templateFormat | typeof bundleFormat
  encrypted: boolean
  requiresPassword: boolean
  createdAt?: string
  hosts: BundleCounts
  hostKeys: BundleCounts
  hostConflicts: HostConflictPreview[]
  hostKeyConflicts: HostKeyConflictPreview[]
  credentials: { total: number }
  hasSettings: boolean
}

export type HostConflictResolution = "keep-local" | "use-imported" | "create-copy" | "skip"
export type HostKeyConflictResolution = "keep-local" | "replace-host-key" | "skip"

export interface ConflictResolution {
  hosts?: Record<string, HostConflictResolution>
  hostKeys?: Record<string, HostKeyConflictResolution>
  importHostKeys?: boolean
  applySettings?: boolean
  importCredentials?: boolean
}

export interface ImportResult {
  importedHosts: number
  replacedHosts: number
  copiedHosts: number
  importedHostKeys: number
  replacedHostKeys: number
  skippedHostKeys: number
  importedCredentials: number
  skippedCredentials: number
  settingsApplied: boolean
}

export interface ConfigImportTarget {
  listHosts(): Promise<HostProfile[]>
  saveHost(profile: HostProfile): Promise<void>
  removeHost(id: string): Promise<void>
  getSettings(): Promise<AppSettings>
  updateSettings(settings: AppSettings): Promise<void>
  getHostKey(host: string, port: number): Promise<string | undefined>
  trustHostKey(host: string, port: number, fingerprint: string): Promise<void>
  replaceHostKey(host: string, port: number, expected: string, replacement: string): Promise<void>
  removeHostKey(host: string, port: number, expected: string): Promise<void>
  assertCredentialsWritable(): Promise<void>
  importCredentials(values: Record<string, string>): Promise<CredentialImportResult>
  journal?: ConfigurationImportJournalStore
}

export interface ConfigurationImportJournalStore {
  begin(journal: ConfigurationImportJournal): Promise<void>
  commit(): Promise<void>
  clear(): Promise<void>
}

export interface ConfigurationImportJournal {
  version: 1
  state: "pending" | "committed"
  hosts: ConfigurationImportHostRollback[]
  hostKeys: ConfigurationImportHostKeyRollback[]
  settings?: {
    expected: AppSettings
    restore: AppSettings
  }
}

export type ConfigurationImportHostRollback =
  | { kind: "remove-created"; expected: HostProfile }
  | { kind: "restore-replaced"; expected: HostProfile; restore: HostProfile }

export type ConfigurationImportHostKeyRollback =
  | { kind: "remove-created"; host: string; port: number; expected: string }
  | { kind: "restore-replaced"; host: string; port: number; expected: string; restore: string }

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
  original?: HostProfile
  action: "new" | "matching" | "replace" | "copy" | "skip"
}

interface HostKeyPlan {
  imported: HostKeyRecord
  action: "new" | "matching" | "replace" | "skip"
  expectedFingerprint?: string
}

interface AppliedImportOperation {
  rollback(): Promise<void>
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

export function credentialsForHosts(hosts: HostProfile[], values: Record<string, string>): BundleCredential[] {
  const credentials: BundleCredential[] = []
  for (const host of hosts) {
    for (const kind of ["password", "passphrase"] as const) {
      const value = values[`${host.id}:${kind}`]
      if (value !== undefined) credentials.push({ hostId: host.id, kind, value })
    }
  }
  return credentials
}

export function hostKeysForHosts(hosts: HostProfile[], values: HostKeyRecord[]): HostKeyRecord[] {
  const endpoints = new Set(hosts.map((host) => hostKeyId(host)))
  return values.filter((value) => endpoints.has(hostKeyId(value)))
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
  private importQueue = Promise.resolve()

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
      hostKeys: countsForHostKeyPlans(hostKeyPlans),
      hostConflicts: hostConflictsForPlans(hostPlans),
      hostKeyConflicts: hostKeyConflictsForPlans(hostKeyPlans)
    }
  }

  public import(input: Uint8Array, password: string | undefined, resolution: ConflictResolution): Promise<ImportResult> {
    const pending = this.importQueue.then(() => this.importUnlocked(input, password, resolution))
    this.importQueue = pending.then(() => undefined, () => undefined)
    return pending
  }

  private async importUnlocked(input: Uint8Array, password: string | undefined, resolution: ConflictResolution): Promise<ImportResult> {
    const decoded = await decodeDocument(parseDocument(input), password)
    const localHosts = await this.target.listHosts()
    const hostPlans = planHosts(decoded.payload.hosts, localHosts, resolution.hosts ?? {}, this.nextHostId, true)
    const hostKeyPlans = resolution.importHostKeys === true
      ? await this.planHostKeys(decoded.payload.hostKeys, resolution.hostKeys ?? {}, true)
      : []
    const originalSettings = resolution.applySettings === true ? await this.target.getSettings() : undefined
    if (resolution.importCredentials === true && decoded.payload.credentials.length > 0) {
      await this.target.assertCredentialsWritable()
    }
    const credentials = resolution.importCredentials === true
      ? remapCredentials(decoded.payload.credentials, hostPlans)
      : {}
    const journal = createConfigurationImportJournal(hostPlans, hostKeyPlans, originalSettings, decoded.payload.settings)
    if (journal && this.target.journal) await this.target.journal.begin(journal)
    const applied: AppliedImportOperation[] = []
    let credentialImport: CredentialImportResult = { imported: [], skippedExisting: [] }

    try {
      const localHostsById = new Map(localHosts.map((host) => [host.id, host]))
      for (const plan of hostPlans) {
        if ((plan.action !== "new" && plan.action !== "replace" && plan.action !== "copy") || !plan.profile) continue
        const profile = plan.profile
        const original = localHostsById.get(plan.imported.id)
        applied.push({
          rollback: async () => {
            const current = (await this.target.listHosts()).find((host) => host.id === profile.id)
            if (plan.action === "replace" && original) {
              if (current && sameHost(current, profile)) await this.target.saveHost(original)
            } else if (current && sameHost(current, profile)) {
              await this.target.removeHost(profile.id)
            }
          }
        })
        await this.target.saveHost(profile)
      }
      if (resolution.applySettings === true && originalSettings) {
        applied.push({
          rollback: async () => {
            const current = await this.target.getSettings()
            if (sameSettings(current, decoded.payload.settings)) await this.target.updateSettings(originalSettings)
          }
        })
        await this.target.updateSettings(decoded.payload.settings)
      }
      for (const plan of hostKeyPlans) {
        if (plan.action === "new") {
          applied.push({
            rollback: async () => {
              if (await this.target.getHostKey(plan.imported.host, plan.imported.port) === plan.imported.fingerprint) {
                await this.target.removeHostKey(plan.imported.host, plan.imported.port, plan.imported.fingerprint)
              }
            }
          })
          await this.target.trustHostKey(plan.imported.host, plan.imported.port, plan.imported.fingerprint)
        } else if (plan.action === "replace") {
          applied.push({
            rollback: async () => {
              if (await this.target.getHostKey(plan.imported.host, plan.imported.port) === plan.imported.fingerprint) {
                await this.target.replaceHostKey(
                  plan.imported.host,
                  plan.imported.port,
                  plan.imported.fingerprint,
                  plan.expectedFingerprint!
                )
              }
            }
          })
          await this.target.replaceHostKey(
            plan.imported.host,
            plan.imported.port,
            plan.expectedFingerprint!,
            plan.imported.fingerprint
          )
        }
      }
      if (Object.keys(credentials).length > 0) credentialImport = await this.target.importCredentials(credentials)
    } catch {
      const rolledBack = await rollbackImport(applied)
      if (rolledBack && journal && this.target.journal) await this.target.journal.clear()
      throw new Error("Configuration import could not be completed")
    }
    if (journal && this.target.journal) await this.target.journal.commit()

    return {
      importedHosts: hostPlans.filter((plan) => plan.action === "new").length,
      replacedHosts: hostPlans.filter((plan) => plan.action === "replace").length,
      copiedHosts: hostPlans.filter((plan) => plan.action === "copy").length,
      importedHostKeys: hostKeyPlans.filter((plan) => plan.action === "new").length,
      replacedHostKeys: hostKeyPlans.filter((plan) => plan.action === "replace").length,
      skippedHostKeys: resolution.importHostKeys === true
        ? hostKeyPlans.filter((plan) => plan.action === "skip").length
        : decoded.payload.hostKeys.length,
      importedCredentials: credentialImport.imported.length,
      skippedCredentials: resolution.importCredentials === true
        ? decoded.payload.credentials.length - credentialImport.imported.length
        : 0,
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

function createConfigurationImportJournal(
  hostPlans: HostPlan[],
  hostKeyPlans: HostKeyPlan[],
  originalSettings: AppSettings | undefined,
  importedSettings: AppSettings
): ConfigurationImportJournal | undefined {
  const hosts: ConfigurationImportHostRollback[] = []
  for (const plan of hostPlans) {
    if (!plan.profile || (plan.action !== "new" && plan.action !== "replace" && plan.action !== "copy")) continue
    if (plan.action === "replace") {
      hosts.push({ kind: "restore-replaced", expected: plan.profile, restore: plan.original! })
    } else {
      hosts.push({ kind: "remove-created", expected: plan.profile })
    }
  }
  const hostKeys: ConfigurationImportHostKeyRollback[] = []
  for (const plan of hostKeyPlans) {
    if (plan.action === "new") {
      hostKeys.push({
        kind: "remove-created",
        host: plan.imported.host,
        port: plan.imported.port,
        expected: plan.imported.fingerprint
      })
    } else if (plan.action === "replace") {
      hostKeys.push({
        kind: "restore-replaced",
        host: plan.imported.host,
        port: plan.imported.port,
        expected: plan.imported.fingerprint,
        restore: plan.expectedFingerprint!
      })
    }
  }
  if (hosts.length === 0 && hostKeys.length === 0 && !originalSettings) return undefined
  return {
    version: 1,
    state: "pending",
    hosts,
    hostKeys,
    ...(originalSettings ? { settings: { expected: importedSettings, restore: originalSettings } } : {})
  }
}

async function rollbackImport(operations: AppliedImportOperation[]): Promise<boolean> {
  let completed = true
  for (const operation of [...operations].reverse()) {
    try {
      await operation.rollback()
    } catch {
      // Keep attempting every independent rollback; the caller receives one sanitized failure.
      completed = false
    }
  }
  return completed
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
  const hostKeys = normalizeHostKeys(value.hostKeys ?? [], hosts)
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
  const hostKeys = normalizeHostKeys(value.hostKeys, hosts)
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

function normalizeHostKeys(value: unknown, hosts: HostProfile[]): HostKeyRecord[] {
  if (!Array.isArray(value) || value.length > maximumHostKeys) throw new Error("Configuration Host Keys are invalid")
  const hostEndpoints = new Set(hosts.map((host) => hostKeyId(host)))
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
    if (!hostEndpoints.has(hostKeyId(record))) throw new Error("Configuration Host Keys are invalid")
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
    if (sameHost(existing, profile)) return { imported: profile, profile: existing, original: existing, action: "matching" }
    const resolution = resolutions[profile.id]
    if (requireResolution && resolution === undefined) throw new Error("Import conflict requires resolution")
    if (resolution === "use-imported") return { imported: profile, profile, original: existing, action: "replace" }
    if (resolution === "create-copy") {
      const copy = { ...profile, id: nextHostId(), name: importedCopyName(profile.name) }
      return { imported: profile, profile: copy, original: existing, action: "copy" }
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
    hostConflicts: [],
    hostKeyConflicts: [],
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
    hostConflicts: [],
    hostKeyConflicts: [],
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

function hostConflictsForPlans(plans: HostPlan[]): HostConflictPreview[] {
  return plans
    .filter((plan) => plan.action === "skip")
    .map(({ imported }) => ({
      id: imported.id,
      name: imported.name,
      host: imported.host,
      port: imported.port,
      username: imported.username
    }))
}

function hostKeyConflictsForPlans(plans: HostKeyPlan[]): HostKeyConflictPreview[] {
  return plans
    .filter((plan): plan is HostKeyPlan & { expectedFingerprint: string } => plan.action === "skip" && plan.expectedFingerprint !== undefined)
    .map((plan) => ({
      id: hostKeyId(plan.imported),
      host: plan.imported.host,
      port: plan.imported.port,
      localFingerprint: plan.expectedFingerprint,
      importedFingerprint: plan.imported.fingerprint
    }))
}

function isEncryptedBundle(value: ConfigTemplate | EncryptedConfigBundle): value is EncryptedConfigBundle {
  return value.format === bundleFormat
}

function sameHost(left: HostProfile, right: HostProfile): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameSettings(left: AppSettings, right: AppSettings): boolean {
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
