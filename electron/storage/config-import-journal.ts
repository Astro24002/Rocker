import { JsonStore } from "./json-store"
import { normalizeHostProfile } from "./host-store"
import { normalizeSettings } from "./settings-store"
import type {
  ConfigImportTarget,
  ConfigurationImportHostKeyRollback,
  ConfigurationImportHostRollback,
  ConfigurationImportJournal,
  ConfigurationImportJournalStore
} from "./config-bundle"
import type { AppSettings, HostProfile } from "./types"

interface JournalDocument {
  journal?: ConfigurationImportJournal
}

const maximumJournalEntries = 10_000

export class ConfigImportJournalStore implements ConfigurationImportJournalStore {
  private readonly store: JsonStore<JournalDocument>

  public constructor(filePath: string) {
    this.store = new JsonStore({
      filePath,
      store: "imports",
      defaultValue: {},
      recovery: "blocked",
      normalize: normalizeJournalDocument,
      sensitive: true
    })
  }

  public async begin(journal: ConfigurationImportJournal): Promise<void> {
    const normalized = normalizeJournal(journal)
    if (!normalized || normalized.state !== "pending") throw new Error("Configuration import journal is invalid")
    await this.store.write({ journal: normalized })
  }

  public async commit(): Promise<void> {
    const document = await this.store.read()
    if (!document.journal) return
    await this.store.write({ journal: { ...document.journal, state: "committed" } })
    await this.clear().catch(() => undefined)
  }

  public async clear(): Promise<void> {
    await this.store.write({})
  }

  public async recover(target: ConfigImportRecoveryTarget): Promise<void> {
    const document = await this.store.read()
    const journal = document.journal
    if (!journal) return
    if (journal.state === "committed") {
      await this.clear()
      return
    }
    const completed = await recoverPendingJournal(journal, target)
    if (!completed) throw new Error("Pending configuration import recovery failed")
    await this.clear()
  }
}

export type ConfigImportRecoveryTarget = Pick<
  ConfigImportTarget,
  "listHosts" | "saveHost" | "removeHost" | "getSettings" | "updateSettings" | "getHostKey" | "replaceHostKey" | "removeHostKey"
>

async function recoverPendingJournal(
  journal: ConfigurationImportJournal,
  target: ConfigImportRecoveryTarget
): Promise<boolean> {
  let complete = true
  for (const rollback of [...journal.hostKeys].reverse()) {
    try {
      if (!await recoverHostKey(rollback, target)) complete = false
    } catch {
      complete = false
    }
  }
  if (journal.settings) {
    try {
      const current = await target.getSettings()
      if (sameSettings(current, journal.settings.expected)) await target.updateSettings(journal.settings.restore)
      else if (!sameSettings(current, journal.settings.restore)) complete = false
    } catch {
      complete = false
    }
  }
  for (const rollback of [...journal.hosts].reverse()) {
    try {
      if (!await recoverHost(rollback, target)) complete = false
    } catch {
      complete = false
    }
  }
  return complete
}

async function recoverHost(
  rollback: ConfigurationImportHostRollback,
  target: Pick<ConfigImportTarget, "listHosts" | "saveHost" | "removeHost">
): Promise<boolean> {
  const current = (await target.listHosts()).find((host) => host.id === rollback.expected.id)
  if (rollback.kind === "remove-created") {
    if (!current) return true
    if (!sameHost(current, rollback.expected)) return false
    await target.removeHost(rollback.expected.id)
    return true
  }
  if (!current) return false
  if (sameHost(current, rollback.restore)) return true
  if (!sameHost(current, rollback.expected)) return false
  await target.saveHost(rollback.restore)
  return true
}

async function recoverHostKey(
  rollback: ConfigurationImportHostKeyRollback,
  target: Pick<ConfigImportTarget, "getHostKey" | "replaceHostKey" | "removeHostKey">
): Promise<boolean> {
  const current = await target.getHostKey(rollback.host, rollback.port)
  if (rollback.kind === "remove-created") {
    if (current === undefined) return true
    if (current !== rollback.expected) return false
    await target.removeHostKey(rollback.host, rollback.port, rollback.expected)
    return true
  }
  if (current === rollback.restore) return true
  if (current !== rollback.expected) return false
  await target.replaceHostKey(rollback.host, rollback.port, rollback.expected, rollback.restore)
  return true
}

function normalizeJournalDocument(value: unknown): JournalDocument | undefined {
  if (!isRecord(value)) return undefined
  if (value.journal === undefined) return {}
  const journal = normalizeJournal(value.journal)
  return journal ? { journal } : undefined
}

function normalizeJournal(value: unknown): ConfigurationImportJournal | undefined {
  if (!isRecord(value) || value.version !== 1 || (value.state !== "pending" && value.state !== "committed")) return undefined
  if (!Array.isArray(value.hosts) || !Array.isArray(value.hostKeys) || value.hosts.length > maximumJournalEntries || value.hostKeys.length > maximumJournalEntries) {
    return undefined
  }
  const hosts: ConfigurationImportHostRollback[] = []
  for (const item of value.hosts) {
    const normalized = normalizeHostRollback(item)
    if (!normalized) return undefined
    hosts.push(normalized)
  }
  const hostKeys: ConfigurationImportHostKeyRollback[] = []
  for (const item of value.hostKeys) {
    const normalized = normalizeHostKeyRollback(item)
    if (!normalized) return undefined
    hostKeys.push(normalized)
  }
  const settings = value.settings === undefined ? undefined : normalizeSettingsRollback(value.settings)
  if (value.settings !== undefined && !settings) return undefined
  return {
    version: 1,
    state: value.state,
    hosts,
    hostKeys,
    ...(settings ? { settings } : {})
  }
}

function normalizeHostRollback(value: unknown): ConfigurationImportHostRollback | undefined {
  if (!isRecord(value)) return undefined
  const expected = normalizeHostProfile(value.expected)
  if (!expected) return undefined
  if (value.kind === "remove-created") return { kind: "remove-created", expected }
  if (value.kind !== "restore-replaced") return undefined
  const restore = normalizeHostProfile(value.restore)
  if (!restore || restore.id !== expected.id) return undefined
  return { kind: "restore-replaced", expected, restore }
}

function normalizeHostKeyRollback(value: unknown): ConfigurationImportHostKeyRollback | undefined {
  if (!isRecord(value) || !isBoundedString(value.host, 512) || !isPort(value.port) || !isBoundedString(value.expected, 512)) return undefined
  const expected = normalizeFingerprint(value.expected)
  if (!expected) return undefined
  if (value.kind === "remove-created") return { kind: "remove-created", host: value.host, port: value.port, expected }
  if (value.kind !== "restore-replaced" || !isBoundedString(value.restore, 512)) return undefined
  const restore = normalizeFingerprint(value.restore)
  return restore ? { kind: "restore-replaced", host: value.host, port: value.port, expected, restore } : undefined
}

function normalizeSettingsRollback(value: unknown): { expected: AppSettings; restore: AppSettings } | undefined {
  if (!isRecord(value)) return undefined
  const expected = normalizeSettings(value.expected)
  const restore = normalizeSettings(value.restore)
  return expected && restore ? { expected, restore } : undefined
}

function sameHost(left: HostProfile, right: HostProfile): boolean {
  const normalizedLeft = normalizeHostProfile(left)
  const normalizedRight = normalizeHostProfile(right)
  return normalizedLeft !== undefined && normalizedRight !== undefined
    ? JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
    : JSON.stringify(left) === JSON.stringify(right)
}

function sameSettings(left: AppSettings, right: AppSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function normalizeFingerprint(value: string): string | undefined {
  const normalized = value.replace(/^SHA256:/i, "").trim()
  return normalized.length > 0 ? normalized : undefined
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
