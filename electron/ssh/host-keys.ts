import { createHash } from "node:crypto"
import type { StorageHealth } from "../storage/storage-result"

export interface HostKeyHealthOptions {
  consumeHealth?: boolean
}

export interface HostKeyStore {
  get(host: string, port: number): Promise<string | undefined>
  trust(host: string, port: number, fingerprint: string): Promise<void>
  replace?(host: string, port: number, expectedFingerprint: string, replacementFingerprint: string): Promise<void>
  remove?(host: string, port: number, expectedFingerprint?: string): Promise<void>
  entries?(): Promise<StoredHostKeyRecord[]>
  auditEntries?(): Promise<HostKeyAuditRecord[]>
  health?(options?: HostKeyHealthOptions): Promise<StorageHealth>
}

export interface StoredHostKeyRecord {
  host: string
  port: number
  fingerprint: string
}

export type HostKeyAuditAction = "trusted" | "replaced" | "removed"

export interface HostKeyAuditRecord {
  at: string
  action: HostKeyAuditAction
  host: string
  port: number
  fingerprint: string
  previousFingerprint?: string
}

export type HostKeyInspection =
  | { status: "unknown"; fingerprint: string }
  | { status: "match"; fingerprint: string }
  | { status: "changed"; storedFingerprint: string; receivedFingerprint: string }

export type UnknownHostKeyApproval = (request: {
  host: string
  port: number
  fingerprint: string
}) => Promise<boolean>

export async function verifyHostFingerprint(
  presented: string,
  expected: string | undefined,
  approveUnknown: UnknownHostKeyApproval
): Promise<boolean> {
  const normalizedPresented = normalizeFingerprint(presented)
  if (expected !== undefined) {
    return normalizeFingerprint(expected) === normalizedPresented
  }
  return approveUnknown({ host: "", port: 0, fingerprint: normalizedPresented })
}

export async function inspectHostKey(
  store: Pick<HostKeyStore, "get">,
  host: string,
  port: number,
  presented: string
): Promise<HostKeyInspection> {
  const fingerprint = normalizeFingerprint(presented)
  const storedFingerprint = await store.get(host, port)
  if (storedFingerprint === undefined) return { status: "unknown", fingerprint }
  if (normalizeFingerprint(storedFingerprint) === fingerprint) return { status: "match", fingerprint }
  return {
    status: "changed",
    storedFingerprint: normalizeFingerprint(storedFingerprint),
    receivedFingerprint: fingerprint
  }
}

export function fingerprintFromKey(key: Buffer): string {
  return createHash("sha256").update(key).digest("base64")
}

export function normalizeFingerprint(value: string): string {
  return value.replace(/^SHA256:/i, "")
}
