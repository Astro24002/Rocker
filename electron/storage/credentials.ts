import type { CredentialKind } from "./types"

export interface CredentialCipher {
  encrypt(value: string): string
  decrypt(value: string): string
}

export class CredentialVault {
  public constructor(
    private readonly values: Map<string, string>,
    private readonly cipher: CredentialCipher
  ) {}

  public async get(hostId: string, kind: CredentialKind): Promise<string | undefined> {
    const stored = this.values.get(this.key(hostId, kind))
    return stored === undefined ? undefined : this.cipher.decrypt(stored)
  }

  public async set(hostId: string, kind: CredentialKind, value: string): Promise<void> {
    this.values.set(this.key(hostId, kind), this.cipher.encrypt(value))
  }

  public async clear(hostId: string, kind: CredentialKind): Promise<void> {
    this.values.delete(this.key(hostId, kind))
  }

  private key(hostId: string, kind: CredentialKind): string {
    return `${hostId}:${kind}`
  }
}
