import { EventEmitter } from "node:events"
import type { Client, ConnectConfig, HostFingerprintVerifier } from "ssh2"
import { describe, expect, it } from "vitest"
import {
  SshConnectionManager,
  type ConnectionEvent,
  type RetryScheduler
} from "./connection-manager"

describe("SshConnectionManager", () => {
  it("shares one verified connection only inside the owner window", async () => {
    const { manager, request } = createConnectionHarness({})
    const first = await manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" })
    const second = await manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" })
    const otherWindow = await manager.acquire({ ...request, ownerWebContentsId: 12, kind: "terminal" })

    expect(second.connectionId).toBe(first.connectionId)
    expect(otherWindow.connectionId).not.toBe(first.connectionId)
  })

  it("does not reuse a connection after its credential context changes", async () => {
    const { manager, request, setSecurityContext } = createConnectionHarness({})
    const first = await manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" })
    setSecurityContext("different-resolved-credential-hash")
    const second = await manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" })

    expect(second.connectionId).not.toBe(first.connectionId)
  })

  it("schedules one retry timer for all leases on a lost connection", async () => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({})
    const first = await manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" })
    await manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" })

    clients[0].emitter.emit("close")

    expect(scheduler.pendingTimers()).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({
      kind: "retrying",
      connectionId: first.connectionId,
      ownerWebContentsId: 11,
      attempt: 1
    })
  })

  it("marks a changed host key as non-retryable without replacing it", async () => {
    let replacements = 0
    const { manager, scheduler, events, request } = createConnectionHarness({
      storedFingerprint: "old-fingerprint",
      nextFingerprint: "new-fingerprint",
      promptForHostKey: async () => false,
      replaceHostKey: async () => { replacements += 1 }
    })

    await expect(manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" }))
      .rejects.toThrow("Host Key changed")

    expect(replacements).toBe(0)
    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "host-key-changed", ownerWebContentsId: 11 })
    expect(scheduler.pendingTimers()).toHaveLength(0)
  })

  it("trusts an unknown host key only after the owner approves it", async () => {
    let trustedFingerprint: string | undefined
    const { manager, request } = createConnectionHarness({
      inspection: "unknown",
      promptForHostKey: async () => true,
      trustHostKey: async (_host, _port, fingerprint) => { trustedFingerprint = fingerprint }
    })

    await manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" })

    expect(trustedFingerprint).toBe("fingerprint-a")
  })

  it("replaces a changed host key only after the owner confirms replacement", async () => {
    let replacement: [string, number, string, string] | undefined
    const { manager, request } = createConnectionHarness({
      storedFingerprint: "old-fingerprint",
      nextFingerprint: "new-fingerprint",
      promptForHostKey: async () => true,
      replaceHostKey: async (host, port, expectedFingerprint, replacementFingerprint) => {
        replacement = [host, port, expectedFingerprint, replacementFingerprint]
      }
    })

    await manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" })

    expect(replacement).toEqual(["127.0.0.1", 22, "old-fingerprint", "new-fingerprint"])
  })

  it("does not retry authentication failures", async () => {
    const { manager, scheduler, events, request } = createConnectionHarness({
      connectFailure: new Error("Authentication failed")
    })

    await expect(manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" }))
      .rejects.toThrow("Authentication failed")

    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "authentication", ownerWebContentsId: 11 })
    expect(scheduler.pendingTimers()).toHaveLength(0)
  })

  it("reports resolver configuration failures without scheduling a retry", async () => {
    const { manager, scheduler, events, request } = createConnectionHarness({
      resolveFailure: new Error("Credential configuration is unavailable")
    })

    await expect(manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" }))
      .rejects.toThrow("Credential configuration is unavailable")

    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "configuration", ownerWebContentsId: 11 })
    expect(scheduler.pendingTimers()).toHaveLength(0)
  })
})

interface HarnessOptions {
  storedFingerprint?: string
  nextFingerprint?: string
  inspection?: "unknown" | "match"
  promptForHostKey?: () => Promise<boolean>
  trustHostKey?: (host: string, port: number, fingerprint: string) => Promise<void>
  replaceHostKey?: (host: string, port: number, expectedFingerprint: string, replacementFingerprint: string) => Promise<void>
  connectFailure?: Error
  resolveFailure?: Error
}

function createConnectionHarness(options: HarnessOptions) {
  const scheduled = new Map<number, () => void>()
  let nextTimer = 1
  const scheduler: RetryScheduler & { pendingTimers(): number[] } = {
    schedule: (_delayMs, action) => {
      const id = nextTimer++
      scheduled.set(id, action)
      return id
    },
    cancel: (id) => scheduled.delete(id),
    pendingTimers: () => [...scheduled.keys()]
  }
  const events: ConnectionEvent[] = []
  const clients: Array<{ emitter: EventEmitter }> = []
  let securityContextKey = "profile-and-credential-hash"
  const createClient = (): Client => {
    const emitter = new EventEmitter()
    const client = {
      connect: (config: ConnectConfig) => {
        if (options.connectFailure) {
          queueMicrotask(() => emitter.emit("error", options.connectFailure))
          return
        }
        const hostVerifier = config.hostVerifier as HostFingerprintVerifier | undefined
        if (hostVerifier) {
          hostVerifier(options.nextFingerprint ?? "fingerprint-a", (accepted) => {
            if (accepted) emitter.emit("ready")
          })
        } else {
          queueMicrotask(() => emitter.emit("ready"))
        }
      },
      end: () => undefined,
      on: emitter.on.bind(emitter),
      once: emitter.once.bind(emitter)
    }
    clients.push({ emitter })
    return client as unknown as Client
  }
  const manager = new SshConnectionManager({
    createClient,
    scheduler,
    random: () => 0.5,
    resolve: async () => {
      if (options.resolveFailure) throw options.resolveFailure
      return {
        host: "127.0.0.1",
        port: 22,
        username: "rock",
        authMethod: "agent",
        readyTimeoutMs: 15_000,
        securityContextKey
      }
    },
    inspectHostKey: async (_request, fingerprint) => {
      if (options.storedFingerprint) {
        return {
          status: "changed" as const,
          storedFingerprint: options.storedFingerprint,
          receivedFingerprint: options.nextFingerprint ?? fingerprint
        }
      }
      if (options.inspection === "unknown") return { status: "unknown" as const, fingerprint }
      return { status: "match" as const, fingerprint }
    },
    promptForHostKey: options.promptForHostKey ?? (async () => false),
    trustHostKey: options.trustHostKey,
    replaceHostKey: options.replaceHostKey,
    onEvent: (event) => events.push(event)
  })
  return {
    clients,
    events,
    manager,
    scheduler,
    request: { hostId: "host-a" },
    setSecurityContext: (next: string) => { securityContextKey = next }
  }
}
