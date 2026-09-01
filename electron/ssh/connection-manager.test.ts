import { EventEmitter } from "node:events"
import type { Client, ConnectConfig, HostFingerprintVerifier } from "ssh2"
import { describe, expect, it, vi } from "vitest"
import {
  ConnectionFailureError,
  SshConnectionManager,
  type ConnectionEvent,
  type ResolvedConnectionRequest,
  type RetryScheduler,
  type SshConnectionManagerOptions
} from "./connection-manager"
import { RemoteOperationError } from "./types"
import type { RuntimeOwner } from "../runtime/owner"

const owner11: RuntimeOwner = { webContentsId: 11, rendererGeneration: 1 }
const owner12: RuntimeOwner = { webContentsId: 12, rendererGeneration: 1 }

describe("SshConnectionManager", () => {
  it("returns count-only resources and returns to baseline after lease release", async () => {
    const { manager, request } = createConnectionHarness({})

    expect(manager.resourceSnapshot()).toEqual({
      connections: 0,
      leases: 0,
      readyWaiters: 0,
      retryTimers: 0,
      connectingTransports: 0
    })

    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    expect(manager.resourceSnapshot()).toMatchObject({ connections: 1, leases: 1 })

    await manager.release(lease.id)
    expect(manager.resourceSnapshot()).toEqual({
      connections: 0,
      leases: 0,
      readyWaiters: 0,
      retryTimers: 0,
      connectingTransports: 0
    })
  })

  it("shares one verified connection only inside the owner window", async () => {
    const { manager, request } = createConnectionHarness({})
    const first = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    const second = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    const otherWindow = await manager.acquire({ ...request, owner: owner12, kind: "terminal" })

    expect(second.connectionId).toBe(first.connectionId)
    expect(otherWindow.connectionId).not.toBe(first.connectionId)
  })

  it("reports the owner only while a connection record remains active", async () => {
    const { manager, request } = createConnectionHarness({})
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    expect(manager.ownerForConnection(lease.connectionId)).toEqual(owner11)
    await manager.release(lease.id)
    expect(manager.ownerForConnection(lease.connectionId)).toBeUndefined()
  })

  it("releases only the matching runtime owner before broad webContents cleanup", async () => {
    const { manager, request } = createConnectionHarness({})
    const ownerV1: RuntimeOwner = { webContentsId: 7, rendererGeneration: 1 }
    const ownerV2: RuntimeOwner = { webContentsId: 7, rendererGeneration: 2 }
    const lease = await manager.acquire({ ...request, owner: ownerV2, kind: "terminal" })

    expect(manager.ownerForConnection(lease.connectionId)).toEqual(ownerV2)
    await manager.releaseOwner(ownerV1)
    expect(manager.ownerForConnection(lease.connectionId)).toEqual(ownerV2)
    await manager.releaseWebContents(7)
    expect(manager.ownerForConnection(lease.connectionId)).toBeUndefined()
  })

  it("coalesces concurrent matching acquisitions in one owner window", async () => {
    const { clients, manager, request } = createConnectionHarness({})
    const [first, second] = await Promise.all([
      manager.acquire({ ...request, owner: owner11, kind: "terminal" }),
      manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    ])

    expect(clients).toHaveLength(1)
    expect(second.connectionId).toBe(first.connectionId)
  })

  it("normalizes an exec callback error without affecting the connection", async () => {
    const { manager, request, failNextExec } = createConnectionHarness({})
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    const operation = manager.execOnConnection(lease.connectionId, "cat /proc/stat")

    failNextExec(new Error("remote exec rejected"))

    await expect(operation).rejects.toMatchObject({
      name: "RemoteOperationError",
      reason: "channel-error",
      message: "remote exec rejected"
    })
    expect(manager.ownerForConnection(lease.connectionId)).toEqual(owner11)
    await manager.release(lease.id)
  })

  it("closes a channel after a remote channel error and removes its listeners", async () => {
    const { manager, request, resolveNextExec } = createConnectionHarness({})
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    const operation = manager.execOnConnection(lease.connectionId, "cat /proc/stat")
    const channel = resolveNextExec()

    channel.emitter.emit("error", new Error("remote channel failed"))

    await expect(operation).rejects.toMatchObject({ reason: "channel-error" })
    expect(channel.close).toHaveBeenCalledOnce()
    expect(channel.emitter.listenerCount("data")).toBe(0)
    expect(channel.emitter.listenerCount("error")).toBe(0)
    expect(channel.emitter.listenerCount("close")).toBe(0)
    channel.emitter.emit("close")
    await manager.release(lease.id)
  })

  it("times out an exec operation and closes a late channel exactly once", async () => {
    const { manager, request, resolveNextExec } = createConnectionHarness({})
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    const operation = manager.execOnConnection(lease.connectionId, "cat /proc/stat", { timeoutMs: 10, maxOutputBytes: 128 })

    await expect(operation).rejects.toMatchObject({ reason: "timeout" })
    const channel = resolveNextExec()
    expect(channel.close).toHaveBeenCalledOnce()
    channel.emitter.emit("close")
    await manager.release(lease.id)
  })

  it("cancels an exec operation and removes all operation listeners", async () => {
    const { manager, request, resolveNextExec } = createConnectionHarness({})
    const controller = new AbortController()
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    const operation = manager.execOnConnection(lease.connectionId, "cat /proc/stat", { timeoutMs: 1_000, maxOutputBytes: 128, signal: controller.signal })
    const channel = resolveNextExec()

    controller.abort()

    await expect(operation).rejects.toMatchObject({ reason: "cancelled" })
    expect(channel.close).toHaveBeenCalledOnce()
    expect(channel.emitter.listenerCount("data")).toBe(0)
    expect(channel.stderr.listenerCount("data")).toBe(0)
    await manager.release(lease.id)
  })

  it("counts stdout and stderr together for the output limit", async () => {
    const { manager, request, resolveNextExec } = createConnectionHarness({})
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    const operation = manager.execOnConnection(lease.connectionId, "cat /proc/stat", { timeoutMs: 1_000, maxOutputBytes: 8 })
    const channel = resolveNextExec()

    channel.emitter.emit("data", Buffer.from("1234"))
    channel.stderr.emit("data", Buffer.from("56789"))

    await expect(operation).rejects.toMatchObject({ reason: "output-limit" })
    expect(channel.close).toHaveBeenCalledOnce()
    channel.emitter.emit("close")
    await manager.release(lease.id)
  })

  it("keeps a timed-out operation settled when its channel closes later", async () => {
    const { manager, request, resolveNextExec } = createConnectionHarness({})
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    const operation = manager.execOnConnection(lease.connectionId, "cat /proc/stat", { timeoutMs: 10, maxOutputBytes: 128 })
    const channel = resolveNextExec()
    let settlements = 0
    void operation.then(() => { settlements += 1 }, () => { settlements += 1 })

    await expect(operation).rejects.toMatchObject({ reason: "timeout" })
    channel.emitter.emit("close")
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(settlements).toBe(1)
    expect(channel.close).toHaveBeenCalledOnce()
    await manager.release(lease.id)
  })

  it("cancels a pending acquisition and ends its only connecting client", async () => {
    const { clients, manager, request, releaseReady, scheduler } = createConnectionHarness({ deferReady: true })
    const controller = new AbortController()
    const pending = manager.acquire({ ...request, owner: owner11, kind: "terminal", signal: controller.signal })

    await waitFor(() => clients.length === 1)
    controller.abort()
    releaseReady()

    await expect(pending).rejects.toMatchObject({ reason: "cancelled" })
    expect(clients[0].end).toHaveBeenCalledOnce()
    expect(scheduler.pendingTimers()).toHaveLength(0)
  })

  it("keeps a shared acquisition ready when an equivalent waiter is cancelled", async () => {
    const { clients, manager, request, releaseReady, resolveCallCount } = createConnectionHarness({ deferReady: true })
    const cancelledController = new AbortController()
    const cancelled = manager.acquire({ ...request, owner: owner11, kind: "terminal", signal: cancelledController.signal })
    await waitFor(() => clients.length === 1)
    const remaining = manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    await waitFor(() => resolveCallCount() === 2)

    cancelledController.abort()
    releaseReady()

    const [cancelledResult, remainingResult] = await Promise.allSettled([cancelled, remaining])
    expect(cancelledResult).toMatchObject({ status: "rejected", reason: { reason: "cancelled" } })
    expect(remainingResult).toMatchObject({ status: "fulfilled", value: { connectionId: expect.any(String) } })
    expect(clients).toHaveLength(1)
    expect(clients[0].end).not.toHaveBeenCalled()
  })

  it("uses the production SSH keepalive policy by default", async () => {
    const { configs, manager, request } = createConnectionHarness({})

    await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    expect(configs[0]).toMatchObject({ keepaliveInterval: 15_000, keepaliveCountMax: 3 })
  })

  it("does not reuse a connection after its credential context changes", async () => {
    const { manager, request, setSecurityContext } = createConnectionHarness({})
    const first = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    setSecurityContext("different-resolved-credential-hash")
    const second = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    expect(second.connectionId).not.toBe(first.connectionId)
  })

  it("does not reuse a verified connection after its known Host Key context changes", async () => {
    const { manager, request, setKnownHostKey } = createConnectionHarness({})
    const first = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    setKnownHostKey("different-known-fingerprint")
    const second = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    expect(second.connectionId).not.toBe(first.connectionId)
  })

  it("keeps reusing a connection after its initially unknown Host Key is trusted", async () => {
    const { manager, request, setKnownHostKey } = createConnectionHarness({
      inspection: "unknown",
      promptForHostKey: async () => true,
      trustHostKey: async () => undefined
    })
    const first = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    setKnownHostKey("fingerprint-a")
    const second = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    expect(second.connectionId).toBe(first.connectionId)
  })

  it("schedules one retry timer for all leases on a lost connection", async () => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({})
    const first = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    clients[0].emitter.emit("close")

    expect(scheduler.pendingTimers()).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({
      kind: "retrying",
      connectionId: first.connectionId,
      owner: owner11,
      attempt: 1
    })
  })

  it("classifies ETIMEDOUT transport failures as retryable timeouts", async () => {
    const { manager, request, events, setConnectFailure } = createConnectionHarness({})
    setConnectFailure(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }))

    await expect(manager.acquire({ ...request, owner: owner11, kind: "terminal" })).rejects.toThrow("ETIMEDOUT")

    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "timeout" })
  })

  it("classifies ENOTFOUND resolver failures as DNS errors", async () => {
    const { manager, request, events, setConnectFailure } = createConnectionHarness({})
    setConnectFailure(Object.assign(new Error("getaddrinfo ENOTFOUND host.invalid"), { code: "ENOTFOUND" }))

    await expect(manager.acquire({ ...request, owner: owner11, kind: "terminal" })).rejects.toThrow("ENOTFOUND")

    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "dns" })
  })

  it("keeps DNS failures mentioning privatekey.example retryable for private-key profiles", async () => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({
      authMethod: "privateKey",
      identityFile: "/keys/host-a",
      readPrivateKey: (async () => Buffer.from("valid-key")) as unknown as SshConnectionManagerOptions["readPrivateKey"]
    })
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    clients[0].emitter.emit(
      "error",
      Object.assign(new Error("getaddrinfo ENOTFOUND privatekey.example"), { code: "ENOTFOUND" })
    )

    expect(events.at(-2)).toMatchObject({ kind: "lost", connectionId: lease.connectionId, reason: "dns" })
    expect(events.at(-1)).toMatchObject({
      kind: "retrying",
      connectionId: lease.connectionId,
      owner: owner11,
      attempt: 1
    })
    expect(scheduler.pendingTimers()).toHaveLength(1)
  })

  it("keeps ordinary socket failures mentioning private key retryable for private-key profiles", async () => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({
      authMethod: "privateKey",
      identityFile: "/keys/host-a",
      readPrivateKey: (async () => Buffer.from("valid-key")) as unknown as SshConnectionManagerOptions["readPrivateKey"]
    })
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    clients[0].emitter.emit(
      "error",
      Object.assign(new Error("socket ECONNRESET while sending private key data"), { code: "ECONNRESET" })
    )

    expect(events.at(-2)).toMatchObject({ kind: "lost", connectionId: lease.connectionId, reason: "network" })
    expect(events.at(-1)).toMatchObject({
      kind: "retrying",
      connectionId: lease.connectionId,
      owner: owner11,
      attempt: 1
    })
    expect(scheduler.pendingTimers()).toHaveLength(1)
  })

  it.each(["ENOENT", "EACCES"] as const)("keeps ordinary client-socket %s failures retryable for agent profiles", async (code) => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({
      authMethod: "agent",
      agent: "/private/agent/host-a.sock"
    })
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    clients[0].emitter.emit(
      "error",
      Object.assign(new Error(`client socket ${code} while connecting to 127.0.0.1:22`), { code })
    )

    expect(events.at(-2)).toMatchObject({ kind: "lost", connectionId: lease.connectionId, reason: "network" })
    expect(events.at(-1)).toMatchObject({
      kind: "retrying",
      connectionId: lease.connectionId,
      owner: owner11,
      attempt: 1
    })
    expect(scheduler.pendingTimers()).toHaveLength(1)
  })

  it.each(["ENOENT", "EACCES"] as const)("keeps ordinary socket %s failures mentioning private key retryable for private-key profiles", async (code) => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({
      authMethod: "privateKey",
      identityFile: "/keys/host-a",
      readPrivateKey: (async () => Buffer.from("valid-key")) as unknown as SshConnectionManagerOptions["readPrivateKey"]
    })
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    clients[0].emitter.emit(
      "error",
      Object.assign(new Error(`client socket ${code} while sending private key data`), { code })
    )

    expect(events.at(-2)).toMatchObject({ kind: "lost", connectionId: lease.connectionId, reason: "network" })
    expect(events.at(-1)).toMatchObject({
      kind: "retrying",
      connectionId: lease.connectionId,
      owner: owner11,
      attempt: 1
    })
    expect(scheduler.pendingTimers()).toHaveLength(1)
  })

  it("keeps a bare no-socket transport failure retryable for agent profiles", async () => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({
      authMethod: "agent",
      agent: "/private/agent/host-a.sock"
    })
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    clients[0].emitter.emit("error", new Error("no socket"))

    expect(events.at(-2)).toMatchObject({ kind: "lost", connectionId: lease.connectionId, reason: "network" })
    expect(events.at(-1)).toMatchObject({
      kind: "retrying",
      connectionId: lease.connectionId,
      owner: owner11,
      attempt: 1
    })
    expect(scheduler.pendingTimers()).toHaveLength(1)
  })

  it.each([
    "credential.example",
    "configuration.example",
    "authentication.example",
    "dns.example",
    "timeout.example",
    "privatekey.example",
    "agent endpoint.example"
  ])("keeps ordinary client-socket recovery errors mentioning %s retryable", async (hostname) => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({})
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    clients[0].emitter.emit(
      "error",
      Object.assign(new Error(`client socket closed while connecting to ${hostname}`), { level: "client-socket" })
    )

    expect(events.at(-2)).toMatchObject({ kind: "lost", connectionId: lease.connectionId, reason: "network" })
    expect(events.at(-1)).toMatchObject({
      kind: "retrying",
      connectionId: lease.connectionId,
      owner: owner11,
      attempt: 1
    })
    expect(scheduler.pendingTimers()).toHaveLength(1)
  })

  it.each(["cancelled", "canceled"] as const)("does not classify message-only %s recovery text as cancellation", async (word) => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({})
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    clients[0].emitter.emit(
      "error",
      Object.assign(new Error(`client socket ${word} while connecting to host.example`), { level: "client-socket" })
    )

    expect(events.at(-2)).toMatchObject({ kind: "lost", connectionId: lease.connectionId, reason: "network" })
    expect(events.at(-1)).toMatchObject({ kind: "retrying", connectionId: lease.connectionId, attempt: 1 })
    expect(scheduler.pendingTimers()).toHaveLength(1)
  })

  it.each([
    "client socket closed after cannot parse privatekey without parser context",
    "client socket closed after privatekey value contains arbitrary text",
    "client socket closed after privatekey value does not match the remote host",
    "client socket closed after private key path is missing for the remote host",
    "client socket closed while sending arbitrary private key text"
  ])("keeps unanchored private-key text retryable during recovery", async (message) => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({
      authMethod: "privateKey",
      identityFile: "/keys/host-a",
      readPrivateKey: (async () => Buffer.from("valid-key")) as unknown as SshConnectionManagerOptions["readPrivateKey"]
    })
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    clients[0].emitter.emit("error", Object.assign(new Error(message), { level: "client-socket" }))

    expect(events.at(-2)).toMatchObject({ kind: "lost", connectionId: lease.connectionId, reason: "network" })
    expect(events.at(-1)).toMatchObject({ kind: "retrying", connectionId: lease.connectionId, attempt: 1 })
    expect(scheduler.pendingTimers()).toHaveLength(1)
  })

  it.each(["ENOENT", "EACCES"] as const)("keeps ordinary client-socket %s failures for agent hostnames retryable", async (code) => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({
      authMethod: "agent",
      agent: "/private/agent/host-a.sock"
    })
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    clients[0].emitter.emit(
      "error",
      Object.assign(new Error(`client socket ${code} while connecting to agent.example`), {
        code,
        level: "client-socket"
      })
    )

    expect(events.at(-2)).toMatchObject({ kind: "lost", connectionId: lease.connectionId, reason: "network" })
    expect(events.at(-1)).toMatchObject({ kind: "retrying", connectionId: lease.connectionId, attempt: 1 })
    expect(scheduler.pendingTimers()).toHaveLength(1)
  })

  it("does not treat an arbitrary agent-level socket error as endpoint configuration", async () => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({
      authMethod: "agent",
      agent: "/private/agent/host-a.sock"
    })
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    clients[0].emitter.emit(
      "error",
      Object.assign(new Error("agent socket closed while connecting to host.example"), { level: "agent" })
    )

    expect(events.at(-2)).toMatchObject({ kind: "lost", connectionId: lease.connectionId, reason: "network" })
    expect(events.at(-1)).toMatchObject({ kind: "retrying", connectionId: lease.connectionId, attempt: 1 })
    expect(scheduler.pendingTimers()).toHaveLength(1)
  })

  it.each([
    ["ENOENT", "/private/ssh-agent/host-a.sock"],
    ["EACCES", "/private/openssh-ssh-agent.sock"],
    ["ENOENT", String.raw`C:\\Users\\rock\\AppData\\Local\\Temp\\openssh-ssh-agent.sock`],
    ["EACCES", String.raw`C:\\Users\\rock\\AppData\\Local\\Temp\\ssh-agent.sock`]
  ] as const)("classifies explicit agent socket paths for %s without retry", async (code, agentEndpoint) => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({
      authMethod: "agent",
      agent: agentEndpoint
    })
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    clients[0].emitter.emit(
      "error",
      Object.assign(new Error(`connect ${code} ${agentEndpoint}`), { code, level: "client-socket" })
    )

    expect(events.at(-1)).toMatchObject({ kind: "failed", connectionId: lease.connectionId, reason: "configuration" })
    expect(scheduler.pendingTimers()).toHaveLength(0)
  })

  it("keeps arbitrary agent-level authentication failures classified as authentication", async () => {
    const { events, manager, request, scheduler } = createConnectionHarness({
      authMethod: "agent",
      agent: "/private/agent/host-a.sock",
      connectFailure: Object.assign(new Error("Authentication failed"), { level: "agent" })
    })

    await expect(manager.acquire({ ...request, owner: owner11, kind: "terminal" }))
      .rejects.toMatchObject({ reason: "authentication" })

    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "authentication", owner: owner11 })
    expect(scheduler.pendingTimers()).toHaveLength(0)
  })

  it("preserves a typed configuration failure without relying on its message", async () => {
    const { events, manager, request, scheduler } = createConnectionHarness({
      connectFailure: new ConnectionFailureError("local setup failed", "configuration")
    })

    await expect(manager.acquire({ ...request, owner: owner11, kind: "terminal" }))
      .rejects.toMatchObject({ reason: "configuration" })

    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "configuration" })
    expect(scheduler.pendingTimers()).toHaveLength(0)
  })

  it("runs a shared retry immediately without leaving the delayed timer behind", async () => {
    const { clients, manager, request, scheduler } = createConnectionHarness({})
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    clients[0].emitter.emit("close")

    manager.retryNow(lease.connectionId)

    await waitFor(() => clients.length === 2)
    expect(scheduler.pendingTimers()).toHaveLength(0)
  })

  it("attaches a new terminal lease to the matching retrying connection", async () => {
    const { clients, manager, request, scheduler } = createConnectionHarness({})
    const first = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    clients[0].emitter.emit("close")

    const second = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    expect(second.connectionId).toBe(first.connectionId)
    expect(clients).toHaveLength(2)
    expect(scheduler.pendingTimers()).toHaveLength(0)
  })

  it("does not create a transport after the final lease is released during retry resolution", async () => {
    const { clients, manager, request, releaseRetryResolution, scheduler, waitForRetryResolution } = createConnectionHarness({
      deferRetryResolution: true
    })
    const lease = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    clients[0].emitter.emit("close")

    scheduler.fireNext()
    await waitForRetryResolution()
    await manager.release(lease.id)
    releaseRetryResolution()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(clients).toHaveLength(1)
    expect(clients[0].end).toHaveBeenCalledOnce()
  })

  it("exhausts the default eight retry attempts", async () => {
    const { clients, events, manager, request, scheduler, setConnectFailure } = createConnectionHarness({})
    await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    setConnectFailure(new Error("Network unavailable"))
    clients[0].emitter.emit("close")

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await scheduler.runNext()
      if (attempt < 8) await waitFor(() => scheduler.pendingTimers().length === 1)
    }

    await waitFor(() => events.at(-1)?.kind === "failed")
    expect(scheduler.pendingTimers()).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "network" })
  })

  it("does not schedule a retry when automatic reconnect is disabled", async () => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({ maxRetryAttempts: 0 })
    await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    clients[0].emitter.emit("close")

    expect(scheduler.pendingTimers()).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "network" })
  })

  it("applies a runtime reconnect-policy change to an existing retry loop", async () => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({})
    await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    clients[0].emitter.emit("close")

    manager.updateRetryPolicy({ autoReconnect: false, reconnectMode: "limited" })

    expect(scheduler.pendingTimers()).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "cancelled" })
  })

  it("ignores stale transport callbacks after a retry succeeds", async () => {
    const { clients, events, manager, request, scheduler } = createConnectionHarness({})
    await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    const staleClient = clients[0]
    staleClient.emitter.emit("close")
    await scheduler.runNext()
    await waitFor(() => clients.length === 2 && events.filter((event) => event.kind === "ready").length === 2)

    staleClient.emitter.emit("close")

    expect(scheduler.pendingTimers()).toHaveLength(0)
    expect(events.filter((event) => event.kind === "retrying")).toHaveLength(1)
  })

  it("marks a changed host key as non-retryable without replacing it", async () => {
    let replacements = 0
    const { manager, scheduler, events, request } = createConnectionHarness({
      storedFingerprint: "old-fingerprint",
      nextFingerprint: "new-fingerprint",
      promptForHostKey: async () => false,
      replaceHostKey: async () => { replacements += 1 }
    })

    await expect(manager.acquire({ ...request, owner: owner11, kind: "terminal" }))
      .rejects.toThrow("Host Key changed")

    expect(replacements).toBe(0)
    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "host-key-changed", owner: owner11 })
    expect(scheduler.pendingTimers()).toHaveLength(0)
  })

  it("trusts an unknown host key only after the owner approves it", async () => {
    let trustedFingerprint: string | undefined
    const { manager, request } = createConnectionHarness({
      inspection: "unknown",
      promptForHostKey: async () => true,
      trustHostKey: async (_host, _port, fingerprint) => { trustedFingerprint = fingerprint }
    })

    await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

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

    await manager.acquire({ ...request, owner: owner11, kind: "terminal" })

    expect(replacement).toEqual(["127.0.0.1", 22, "old-fingerprint", "new-fingerprint"])
  })

  it("does not retry authentication failures", async () => {
    const { manager, scheduler, events, request } = createConnectionHarness({
      connectFailure: new Error("Authentication failed")
    })

    await expect(manager.acquire({ ...request, owner: owner11, kind: "terminal" }))
      .rejects.toThrow("Authentication failed")

    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "authentication", owner: owner11 })
    expect(scheduler.pendingTimers()).toHaveLength(0)
  })

  it("reports resolver configuration failures without scheduling a retry", async () => {
    const { manager, scheduler, events, request } = createConnectionHarness({
      resolveFailure: new Error("Credential configuration is unavailable")
    })

    await expect(manager.acquire({ ...request, owner: owner11, kind: "terminal" }))
      .rejects.toThrow("Credential configuration is unavailable")

    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "configuration", owner: owner11 })
    expect(scheduler.pendingTimers()).toHaveLength(0)
  })

  it("classifies malformed private-key material as configuration without leaking local details", async () => {
    const identityFile = "/private/key/host-a"
    const secretMarker = "malformed-key-secret-marker"
    const { events, manager, request, scheduler } = createConnectionHarness({
      authMethod: "privateKey",
      identityFile,
      readPrivateKey: (async () => Buffer.from(secretMarker)) as unknown as SshConnectionManagerOptions["readPrivateKey"],
      connectThrow: new Error(`Cannot parse privateKey: invalid material at ${identityFile} (${secretMarker})`)
    })

    const rejection = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
      .then(() => undefined, (error: unknown) => error)

    expect(rejection).toMatchObject({ reason: "configuration" })
    expect(rejection).toBeInstanceOf(Error)
    expect((rejection as Error).message).not.toContain(identityFile)
    expect((rejection as Error).message).not.toContain(secretMarker)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: "failed", reason: "configuration", owner: owner11 })
    expect(scheduler.pendingTimers()).toHaveLength(0)
  })

  it.each([
    ["ENOENT", Object.assign(new Error("connect ENOENT /private/agent/host-a.sock"), { code: "ENOENT", level: "agent" })],
    ["EACCES", Object.assign(new Error("connect EACCES /private/agent/host-a.sock"), { code: "EACCES", level: "agent" })],
    ["no socket", Object.assign(new Error("Failed to connect to agent"), { level: "agent" })]
  ] as const)("classifies configured SSH-agent %s as configuration without retry", async (_caseName, connectFailure) => {
    const agentEndpoint = "/private/agent/host-a.sock"
    const { events, manager, request, scheduler } = createConnectionHarness({
      authMethod: "agent",
      agent: agentEndpoint,
      connectFailure
    })

    const rejection = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
      .then(() => undefined, (error: unknown) => error)

    expect(rejection).toMatchObject({ reason: "configuration" })
    expect(rejection).toBeInstanceOf(Error)
    expect((rejection as Error).message).not.toContain(agentEndpoint)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: "failed", reason: "configuration", owner: owner11 })
    expect(scheduler.pendingTimers()).toHaveLength(0)
  })

  it.each(["ENOENT", "EACCES"] as const)("classifies private-key %s as configuration without retry", async (code) => {
    const identityFile = "/private/key/host-a"
    const { events, manager, request, scheduler } = createConnectionHarness({
      authMethod: "privateKey",
      identityFile,
      readPrivateKey: async () => {
        throw Object.assign(new Error(`private key read failed: ${code}`), { code })
      }
    })

    const rejection = await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
      .then(() => undefined, (error: unknown) => error)

    expect(rejection).toMatchObject({ reason: "configuration" })
    expect(rejection).toBeInstanceOf(Error)
    expect((rejection as Error).message).not.toContain(identityFile)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: "failed", reason: "configuration", owner: owner11 })
    expect(scheduler.pendingTimers()).toHaveLength(0)
  })

  it("does not retry an unclassified profile resolution failure", async () => {
    const { clients, events, manager, request, scheduler, setResolveFailure } = createConnectionHarness({})
    await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    setResolveFailure(new Error("Profile unavailable"))
    clients[0].emitter.emit("close")

    await scheduler.runNext()

    expect(scheduler.pendingTimers()).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "configuration", owner: owner11 })
  })

  it("does not retry a Host Key persistence conflict during recovery", async () => {
    const { clients, events, manager, request, scheduler, setHostKeyChange } = createConnectionHarness({
      promptForHostKey: async () => true,
      replaceHostKey: async () => { throw new Error("Host Key changed while awaiting replacement confirmation") }
    })
    await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    setHostKeyChange("old-fingerprint", "new-fingerprint")
    clients[0].emitter.emit("close")

    await scheduler.runNext()

    expect(scheduler.pendingTimers()).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "host-key-changed", owner: owner11 })
  })

  it("does not retry a failed unknown Host Key trust during recovery", async () => {
    const { clients, events, manager, request, scheduler, setHostKeyUnknown } = createConnectionHarness({
      promptForHostKey: async () => true,
      trustHostKey: async () => { throw new Error("Host Key persistence is unavailable") }
    })
    await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    setHostKeyUnknown()
    clients[0].emitter.emit("close")

    await scheduler.runNext()

    expect(scheduler.pendingTimers()).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "host-key-rejected", owner: owner11 })
  })

  it("does not retry a Host Key inspection failure during recovery", async () => {
    const { clients, events, manager, request, scheduler, setHostKeyInspectionFailure } = createConnectionHarness({})
    await manager.acquire({ ...request, owner: owner11, kind: "terminal" })
    setHostKeyInspectionFailure(new Error("Host Key storage is unavailable"))
    clients[0].emitter.emit("close")

    await scheduler.runNext()

    expect(scheduler.pendingTimers()).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "host-key-rejected", owner: owner11 })
  })
})

interface FakeExecChannel {
  emitter: EventEmitter
  stderr: EventEmitter
  close: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  on: EventEmitter["on"]
  removeListener: EventEmitter["removeListener"]
}

interface HarnessOptions {
  storedFingerprint?: string
  nextFingerprint?: string
  inspection?: "unknown" | "match"
  promptForHostKey?: () => Promise<boolean>
  trustHostKey?: (host: string, port: number, fingerprint: string) => Promise<void>
  replaceHostKey?: (host: string, port: number, expectedFingerprint: string, replacementFingerprint: string) => Promise<void>
  connectFailure?: Error
  connectThrow?: Error
  resolveFailure?: Error
  deferRetryResolution?: boolean
  maxRetryAttempts?: number
  deferReady?: boolean
  authMethod?: ResolvedConnectionRequest["authMethod"]
  identityFile?: string
  agent?: string
  readPrivateKey?: SshConnectionManagerOptions["readPrivateKey"]
}

function createConnectionHarness(options: HarnessOptions) {
  const scheduled = new Map<number, () => void>()
  let nextTimer = 1
  const scheduler: RetryScheduler & { pendingTimers(): number[]; runNext(): Promise<void>; fireNext(): void } = {
    schedule: (_delayMs, action) => {
      const id = nextTimer++
      scheduled.set(id, action)
      return id
    },
    cancel: (id) => scheduled.delete(id),
    pendingTimers: () => [...scheduled.keys()],
    runNext: async () => {
      const next = scheduled.entries().next().value as [number, () => void] | undefined
      if (!next) throw new Error("No retry timer is scheduled")
      scheduled.delete(next[0])
      next[1]()
      await waitFor(() => scheduled.size > 0 || clients.length > 1 || events.some((event) => event.kind === "failed"))
    },
    fireNext: () => {
      const next = scheduled.entries().next().value as [number, () => void] | undefined
      if (!next) throw new Error("No retry timer is scheduled")
      scheduled.delete(next[0])
      next[1]()
    }
  }
  const events: ConnectionEvent[] = []
  const clients: Array<{ emitter: EventEmitter; end: ReturnType<typeof vi.fn> }> = []
  const configs: ConnectConfig[] = []
  const pendingExec: Array<(error: Error | undefined, channel?: FakeExecChannel) => void> = []
  const pendingReady: Array<() => void> = []
  let readyReleased = !options.deferReady
  let securityContextKey = "profile-and-credential-hash"
  let knownHostKeyFingerprint: string | undefined
  let connectFailure = options.connectFailure
  let resolveFailure = options.resolveFailure
  let storedFingerprint = options.storedFingerprint
  let nextFingerprint = options.nextFingerprint
  let inspection = options.inspection
  let hostKeyInspectionFailure: Error | undefined
  let resolveCalls = 0
  let releaseRetryResolution: (() => void) | undefined
  let signalRetryResolution: (() => void) | undefined
  const retryResolution = new Promise<void>((resolve) => { releaseRetryResolution = resolve })
  const retryResolutionStarted = new Promise<void>((resolve) => { signalRetryResolution = resolve })
  const createClient = (): Client => {
    const emitter = new EventEmitter()
    const end = vi.fn()
    const client = {
      connect: (config: ConnectConfig) => {
        configs.push(config)
        if (options.connectThrow) throw options.connectThrow
        if (connectFailure) {
          queueMicrotask(() => emitter.emit("error", connectFailure))
          return
        }
        const hostVerifier = config.hostVerifier as HostFingerprintVerifier | undefined
        if (hostVerifier) {
          const verify = (accepted: boolean) => {
            if (!accepted) return
            if (readyReleased) {
              emitter.emit("ready")
            } else {
              pendingReady.push(() => emitter.emit("ready"))
            }
          }
          const result = hostVerifier(nextFingerprint ?? "fingerprint-a", verify)
          if (result !== undefined) verify(result)
        } else {
          queueMicrotask(() => emitter.emit("ready"))
        }
      },
      exec: (command: string, callback: (error: Error | undefined, channel?: FakeExecChannel) => void) => {
        void command
        pendingExec.push(callback)
      },
      end,
      on: emitter.on.bind(emitter),
      once: emitter.once.bind(emitter)
    }
    clients.push({ emitter, end })
    return client as unknown as Client
  }
  const managerOptions: SshConnectionManagerOptions = {
    createClient,
    scheduler,
    random: () => 0.5,
    maxRetryAttempts: options.maxRetryAttempts,
    resolve: async () => {
      resolveCalls += 1
      if (options.deferRetryResolution && resolveCalls > 1) {
        signalRetryResolution?.()
        await retryResolution
      }
      if (resolveFailure) throw resolveFailure
      return {
        host: "127.0.0.1",
        port: 22,
        username: "rock",
        authMethod: options.authMethod ?? "agent",
        ...(options.identityFile ? { identityFile: options.identityFile } : {}),
        ...(options.agent ? { agent: options.agent } : {}),
        readyTimeoutMs: 15_000,
        securityContextKey,
        ...(knownHostKeyFingerprint ? { knownHostKeyFingerprint } : {})
      }
    },
    inspectHostKey: async (_request, fingerprint) => {
      if (hostKeyInspectionFailure) throw hostKeyInspectionFailure
      if (storedFingerprint) {
        return {
          status: "changed" as const,
          storedFingerprint,
          receivedFingerprint: nextFingerprint ?? fingerprint
        }
      }
      if (inspection === "unknown") return { status: "unknown" as const, fingerprint }
      return { status: "match" as const, fingerprint }
    },
    promptForHostKey: options.promptForHostKey ?? (async () => false),
    trustHostKey: options.trustHostKey,
    replaceHostKey: options.replaceHostKey,
    onEvent: (event) => events.push(event),
    readPrivateKey: options.readPrivateKey
  }
  const manager = new SshConnectionManager(managerOptions)
  return {
    clients,
    configs,
    events,
    manager,
    scheduler,
    request: { hostId: "host-a" },
    setSecurityContext: (next: string) => { securityContextKey = next },
    setKnownHostKey: (next: string | undefined) => { knownHostKeyFingerprint = next },
    setConnectFailure: (next: Error | undefined) => { connectFailure = next },
    setResolveFailure: (next: Error | undefined) => { resolveFailure = next },
    setHostKeyChange: (stored: string, received: string) => {
      storedFingerprint = stored
      nextFingerprint = received
      inspection = undefined
    },
    setHostKeyUnknown: () => {
      storedFingerprint = undefined
      inspection = "unknown"
    },
    setHostKeyInspectionFailure: (next: Error | undefined) => {
      hostKeyInspectionFailure = next
    },
    releaseReady: () => {
      readyReleased = true
      for (const ready of pendingReady.splice(0)) ready()
    },
    resolveCallCount: () => resolveCalls,
    resolveNextExec: () => {
      const callback = pendingExec.shift()
      if (!callback) throw new Error("No pending exec operation")
      const channel = createFakeExecChannel()
      callback(undefined, channel)
      return channel
    },
    failNextExec: (error: Error) => {
      const callback = pendingExec.shift()
      if (!callback) throw new Error("No pending exec operation")
      callback(error)
    },
    updateRetryPolicy: (update: { autoReconnect: boolean; reconnectMode: "limited" | "continuous" }) => manager.updateRetryPolicy(update),
    releaseRetryResolution: () => releaseRetryResolution?.(),
    waitForRetryResolution: async () => retryResolutionStarted
  }
}

function createFakeExecChannel(): FakeExecChannel {
  const emitter = new EventEmitter()
  const stderr = new EventEmitter()
  return {
    emitter,
    stderr,
    close: vi.fn(),
    end: vi.fn(),
    on: emitter.on.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter)
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (condition()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("Timed out waiting for the expected connection state")
}
