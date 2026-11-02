import { JsonStore } from "../storage/json-store"
import { StorageBlockedError, type StorageDiagnosticSink } from "../storage/storage-result"
import { record, type WorkbenchProfile } from "./types"

export function validateProfile(value: unknown): WorkbenchProfile {
  const p = record(value)
  for (const key of ["id", "name", "cwd", "executable"] as const) {
    if (typeof p[key] !== "string" || !p[key].trim() || p[key].length > (key === "cwd" || key === "executable" ? 4096 : 256) || /[\0\r\n]/.test(p[key])) throw new Error(`Invalid workspace ${key}`)
  }
  if (!["local", "remote", "cloud"].includes(String(p.source))) throw new Error("Invalid workspace source")
  if (p.source !== "local" && (typeof p.hostId !== "string" || !p.hostId || p.hostId.length > 256)) throw new Error("Choose an SSH Host")
  return { id: p.id as string, name: (p.name as string).trim(), source: p.source as WorkbenchProfile["source"], cwd: p.cwd as string, executable: p.executable as string, ...(p.source !== "local" ? { hostId: p.hostId as string } : {}) }
}

export class WorkbenchProfileStore {
  private readonly store: JsonStore<{ version: 1; profiles: WorkbenchProfile[] }>
  constructor(filePath: string, onDiagnostic?: StorageDiagnosticSink) {
    this.store = new JsonStore({ filePath, store: "workspace", defaultValue: { version: 1, profiles: [] }, recovery: "default", onDiagnostic, normalize: (value) => {
      const doc = record(value)
      if (doc.version !== 1 || !Array.isArray(doc.profiles)) return undefined
      try { return { version: 1, profiles: doc.profiles.map(validateProfile) } } catch { return undefined }
    } })
  }
  async list(): Promise<WorkbenchProfile[]> {
    const result = await this.store.load()
    if (result.status === "blocked") throw new StorageBlockedError(result.issue)
    return structuredClone(result.value.profiles)
  }
  async save(input: unknown): Promise<void> {
    const profile = validateProfile(input)
    await this.store.update((doc) => ({ version: 1, profiles: [...doc.profiles.filter(p => p.id !== profile.id), profile] }))
  }
  async remove(id: string): Promise<void> {
    await this.store.update((doc) => ({ version: 1, profiles: doc.profiles.filter(p => p.id !== id) }))
  }
}
