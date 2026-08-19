import { createHash } from "node:crypto"
import type { CredentialVault } from "../storage/credentials"
import type { HostStore } from "../storage/host-store"
import type { SettingsStore } from "../storage/settings-store"
import {
  ConnectionResolutionError,
  type ConnectionAcquireRequest,
  type ResolvedConnectionRequest
} from "./connection-manager"
import type { HostKeyStore } from "./host-keys"

export interface ConnectionResolverDependencies {
  hosts: Pick<HostStore, "list">
  credentials: Pick<CredentialVault, "get">
  settings: Pick<SettingsStore, "get">
  hostKeys: Pick<HostKeyStore, "get">
  agentPath?: () => string | undefined
}

export function createConnectionResolver(
  dependencies: ConnectionResolverDependencies
): (request: ConnectionAcquireRequest) => Promise<ResolvedConnectionRequest> {
  return async (request) => {
    try {
      const [hosts, settings] = await Promise.all([dependencies.hosts.list(), dependencies.settings.get()])
      const profile = hosts.find((host) => host.id === request.hostId)
      if (!profile) throw new ConnectionResolutionError("Host profile was not found", "configuration")
      if (profile.authMethod === "privateKey" && !profile.identityFile) {
        throw new ConnectionResolutionError("Private key path is missing", "configuration")
      }

      const [password, passphrase, storedHostKey] = await Promise.all([
        profile.authMethod === "password" ? dependencies.credentials.get(profile.id, "password") : undefined,
        profile.authMethod === "privateKey" ? dependencies.credentials.get(profile.id, "passphrase") : undefined,
        dependencies.hostKeys.get(profile.host, profile.port)
      ])
      if (profile.authMethod === "password" && password === undefined) {
        throw new ConnectionResolutionError("Password credential is missing", "authentication")
      }
      const agent = profile.authMethod === "agent" ? resolveAgentPath(dependencies.agentPath) : undefined
      return {
        host: profile.host,
        port: profile.port,
        username: profile.username,
        authMethod: profile.authMethod,
        ...(profile.identityFile ? { identityFile: profile.identityFile } : {}),
        ...(password !== undefined ? { password } : {}),
        ...(passphrase !== undefined ? { passphrase } : {}),
        ...(agent ? { agent } : {}),
        readyTimeoutMs: settings.connectionTimeout * 1_000,
        ...(storedHostKey ? { knownHostKeyFingerprint: storedHostKey } : {}),
        securityContextKey: securityContextKey({
          host: profile.host,
          port: profile.port,
          username: profile.username,
          authMethod: profile.authMethod,
          identityFile: profile.identityFile,
          agent,
          password,
          passphrase
        })
      }
    } catch (error) {
      if (error instanceof ConnectionResolutionError) throw error
      throw new ConnectionResolutionError("SSH connection configuration could not be resolved", "configuration")
    }
  }
}

function resolveAgentPath(agentPath: ConnectionResolverDependencies["agentPath"]): string | undefined {
  return agentPath?.() ?? process.env.SSH_AUTH_SOCK ?? (process.platform === "win32" ? "pageant" : undefined)
}

function securityContextKey(value: {
  host: string
  port: number
  username: string
  authMethod: string
  identityFile?: string
  agent?: string
  password?: string
  passphrase?: string
}): string {
  return createHash("sha256").update(JSON.stringify({
    host: value.host,
    port: value.port,
    username: value.username,
    authMethod: value.authMethod,
    identityFile: value.identityFile,
    agent: value.agent,
    passwordDigest: digest(value.password),
    passphraseDigest: digest(value.passphrase)
  })).digest("hex")
}

function digest(value: string | undefined): string | undefined {
  return value === undefined ? undefined : createHash("sha256").update(value).digest("hex")
}
