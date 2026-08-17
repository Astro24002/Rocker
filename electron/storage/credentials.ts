import type { CredentialKind } from "./types"

export interface CredentialCipher {
  encrypt(value: string): string
  decrypt(value: string): string
}

export interface CredentialValueStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export class CredentialVault {
  public constructor(
    private readonly values: Map<string, string> | CredentialValueStore,
    private readonly cipher: CredentialCipher
  ) {}

  public async get(hostId: string, kind: CredentialKind): Promise<string | undefined> {
    const stored = await this.read(this.key(hostId, kind))
    return stored === undefined ? undefined : this.cipher.decrypt(stored)
  }

  public async set(hostId: string, kind: CredentialKind, value: string): Promise<void> {
    const key = this.key(hostId, kind)
    const encrypted = this.cipher.encrypt(value)
    if (this.values instanceof Map) {
      this.values.set(key, encrypted)
    } else {
      await this.values.set(key, encrypted)
    }
  }

  public async clear(hostId: string, kind: CredentialKind): Promise<void> {
    const key = this.key(hostId, kind)
    if (this.values instanceof Map) {
      this.values.delete(key)
    } else {
      await this.values.delete(key)
    }
  }

  private key(hostId: string, kind: CredentialKind): string {
    return `${hostId}:${kind}`
  }

  private async read(key: string): Promise<string | undefined> {
    return this.values instanceof Map ? this.values.get(key) : this.values.get(key)
  }
}
