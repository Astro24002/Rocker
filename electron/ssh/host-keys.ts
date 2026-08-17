import { createHash } from "node:crypto"

export interface HostKeyStore {
  get(host: string, port: number): Promise<string | undefined>
  trust(host: string, port: number, fingerprint: string): Promise<void>
}

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

export function fingerprintFromKey(key: Buffer): string {
  return createHash("sha256").update(key).digest("base64")
}

export function normalizeFingerprint(value: string): string {
  return value.replace(/^SHA256:/i, "")
}
