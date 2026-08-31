import { describe, expect, it } from "vitest"
import { createConnectionResolver, type ConnectionResolverDependencies } from "./connection-resolver"
import type { RuntimeOwner } from "../runtime/owner"

const profile = {
  id: "host-a",
  name: "Host A",
  host: "example.test",
  port: 2222,
  username: "rock",
  authMethod: "password" as const,
  favorite: false,
  notes: ""
}
const owner: RuntimeOwner = { webContentsId: 21, rendererGeneration: 1 }

describe("createConnectionResolver", () => {
  it("derives timeout and reuse context from the current credential and verified Host Key", async () => {
    let password = "first-secret"
    let fingerprint = "SHA256:first-key"
    const resolve = createConnectionResolver(createDependencies({
      credential: () => password,
      fingerprint: () => fingerprint
    }))

    const first = await resolve({ hostId: profile.id, owner, kind: "terminal" })
    password = "second-secret"
    const changedCredential = await resolve({ hostId: profile.id, owner, kind: "terminal" })
    fingerprint = "SHA256:second-key"
    const changedHostKey = await resolve({ hostId: profile.id, owner, kind: "terminal" })

    expect(first).toMatchObject({ host: profile.host, port: profile.port, username: profile.username, password: "first-secret", readyTimeoutMs: 30_000 })
    expect(changedCredential.securityContextKey).not.toBe(first.securityContextKey)
    expect(changedHostKey.securityContextKey).toBe(changedCredential.securityContextKey)
    expect(changedHostKey.knownHostKeyFingerprint).not.toBe(first.knownHostKeyFingerprint)
    expect(first.securityContextKey).not.toContain("first-secret")
  })

  it("classifies a missing password credential as an authentication failure", async () => {
    const resolve = createConnectionResolver(createDependencies({ credential: () => undefined }))

    await expect(resolve({ hostId: profile.id, owner, kind: "terminal" }))
      .rejects.toMatchObject({ reason: "authentication" })
  })

  it("rejects a private-key profile without an identity path as configuration", async () => {
    const resolve = createConnectionResolver(createDependencies({
      profile: { ...profile, authMethod: "privateKey" }
    }))

    await expect(resolve({ hostId: profile.id, owner, kind: "terminal" }))
      .rejects.toMatchObject({ reason: "configuration" })
  })
})

function createDependencies(overrides: {
  profile?: typeof profile | { authMethod: "privateKey"; id: string; name: string; host: string; port: number; username: string; favorite: boolean; notes: string }
  credential?: () => string | undefined
  fingerprint?: () => string | undefined
} = {}): ConnectionResolverDependencies {
  return {
    hosts: { list: async () => [overrides.profile ?? profile] },
    credentials: { get: async () => overrides.credential ? overrides.credential() : "first-secret" },
    settings: {
      get: async () => ({
        locale: "en",
        sidebarWidth: 220,
        terminalFont: "JetBrains Mono",
        terminalFontSize: 13,
        connectionTimeout: 30,
        autoReconnect: true,
        reconnectMode: "limited",
        restorePreviousWorkspace: true,
        confirmMultilinePaste: true,
        bindAddress: "127.0.0.1"
      })
    },
    hostKeys: { get: async () => overrides.fingerprint?.() ?? "SHA256:first-key" },
    agentPath: () => "/tmp/ssh-agent"
  }
}
