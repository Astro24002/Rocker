import { EventEmitter } from "node:events"
import type { Socket } from "node:net"
import type { Client, ConnectConfig, HostFingerprintVerifier } from "ssh2"
import { describe, expect, it, vi } from "vitest"
import {
  SshConnectionManager,
  type ConnectionCommandExecutor,
  type ConnectionEvent,
  type ConnectionLease
} from "../ssh/connection-manager"
import {
  ForwardingManager,
  type ForwardingEvent,
  type ForwardingConnectionAccess,
  type LocalListener,
  type LocalListenerFactory
} from "./forwarding-manager"
import type { ForwardingSpec } from "./types"
import { sameRuntimeOwner, type RuntimeOwner } from "../runtime/owner"

const connectionId = "connection-a"
const owner: RuntimeOwner = { webContentsId: 7, rendererGeneration: 1 }
const otherOwner: RuntimeOwner = { webContentsId: 8, rendererGeneration: 1 }
const loopbackSpec: ForwardingSpec = {
  localAddress: "127.0.0.1",
  localPort: 43123,
  remoteAddress: "127.0.0.1",
  remotePort: 3000
}

describe("ForwardingManager", () => {
  it("returns count-only resources and returns to baseline after stopping a forward", async () => {
    const connections = new FakeConnections()
    const forwards = new ForwardingManager(connections, { createListener: createListenerFactory().create })

    expect(forwards.resourceSnapshot()).toEqual({ forwards: 0, listeners: 0, activationTasks: 0 })
    const forward = await forwards.start(connectionId, loopbackSpec, owner)
    expect(forwards.resourceSnapshot()).toMatchObject({ forwards: 1, listeners: 1 })

    await forwards.stop(forward.id)
    expect(forwards.resourceSnapshot()).toEqual({ forwards: 0, listeners: 0, activationTasks: 0 })
  })

  it.each(["127.0.0.1", "::1"])("keeps a %s loopback forward suspended through transport loss and restores it on ready", async (localAddress) => {
    const connections = new FakeConnections()
    const listeners = createListenerFactory()
    const forwards = new ForwardingManager(connections, { createListener: listeners.create })

    const forward = await forwards.start(connectionId, { ...loopbackSpec, localAddress }, owner)
    connections.emit({ kind: "lost", connectionId, owner, reason: "network" })

    expect(forwards.get(forward.id)).toMatchObject({ status: "suspended" })
    expect(forward).not.toHaveProperty("sessionId")
    expect(connections.activeLeaseCount()).toBe(1)

    connections.emit({ kind: "ready", connectionId, owner, transportGeneration: 2 })
    await waitFor(() => forwards.get(forward.id)?.status === "forwarding")

    expect(listeners.created).toHaveLength(2)
    expect(listeners.created[0].closed).toBe(true)
    expect(connections.activeLeaseCount()).toBe(1)
  })

  it("requires explicit resume for a non-loopback forward after transport recovery", async () => {
    const connections = new FakeConnections()
    const listeners = createListenerFactory()
    const forwards = new ForwardingManager(connections, { createListener: listeners.create })

    const forward = await forwards.start(connectionId, { ...loopbackSpec, localAddress: "0.0.0.0" }, owner)
    connections.emit({ kind: "lost", connectionId, owner, reason: "network" })
    connections.emit({ kind: "ready", connectionId, owner, transportGeneration: 2 })
    await flush()

    expect(forwards.get(forward.id)).toMatchObject({ status: "suspended" })
    expect(listeners.created).toHaveLength(1)

    const resumed = await forwards.resume(forward.id)

    expect(resumed).toMatchObject({ id: forward.id, status: "forwarding" })
    expect(listeners.created).toHaveLength(2)
  })

  it("reports the owner only while a forwarding record remains active", async () => {
    const connections = new FakeConnections()
    const forwards = new ForwardingManager(connections, { createListener: createListenerFactory().create })
    const forward = await forwards.start(connectionId, loopbackSpec, owner)

    expect(forwards.ownerForForwarding(forward.id)).toEqual(owner)
    await forwards.stop(forward.id)
    expect(forwards.ownerForForwarding(forward.id)).toBeUndefined()
  })

  it("releases only the matching runtime owner before broad webContents cleanup", async () => {
    const connections = new FakeConnections()
    const forwards = new ForwardingManager(connections, { createListener: createListenerFactory().create })
    const ownerV1: RuntimeOwner = { webContentsId: 7, rendererGeneration: 1 }
    const ownerV2: RuntimeOwner = { webContentsId: 7, rendererGeneration: 2 }
    const forward = await forwards.start(connectionId, loopbackSpec, ownerV2)

    expect(forwards.ownerForForwarding(forward.id)).toEqual(ownerV2)
    await forwards.releaseOwner(ownerV1)
    expect(forwards.ownerForForwarding(forward.id)).toEqual(ownerV2)
    await forwards.releaseWebContents(7)
    expect(forwards.ownerForForwarding(forward.id)).toBeUndefined()
  })

  it("emits bounded lifecycle events for diagnostics", async () => {
    const connections = new FakeConnections()
    const events: ForwardingEvent[] = []
    const forwards = new ForwardingManager(connections, { createListener: createListenerFactory().create, onEvent: (event) => events.push(event) })
    const forward = await forwards.start(connectionId, loopbackSpec, owner)

    connections.emit({ kind: "lost", connectionId, owner, reason: "network" })
    connections.emit({ kind: "ready", connectionId, owner, transportGeneration: 2 })
    await waitFor(() => events.some((event) => event.kind === "resumed"))
    await forwards.stop(forward.id)

    expect(events.map((event) => event.kind)).toEqual(["started", "suspended", "resumed", "stopped"])
    expect(events.every((event) => event.connectionId === connectionId && event.owner === owner)).toBe(true)
  })

  it("deduplicates concurrent manual resumes for one suspended forward", async () => {
    const connections = new FakeConnections()
    const listeners = createListenerFactory()
    const forwards = new ForwardingManager(connections, { createListener: listeners.create })
    const forward = await forwards.start(connectionId, { ...loopbackSpec, localAddress: "0.0.0.0" }, owner)
    connections.emit({ kind: "lost", connectionId, owner, reason: "network" })

    const resumed = await Promise.all([forwards.resume(forward.id), forwards.resume(forward.id)])

    expect(resumed).toEqual([
      expect.objectContaining({ id: forward.id, status: "forwarding" }),
      expect.objectContaining({ id: forward.id, status: "forwarding" })
    ])
    expect(listeners.created).toHaveLength(2)
    expect(connections.activeLeaseCount()).toBe(1)
  })

  it("deduplicates repeated ready events for one suspended loopback forward", async () => {
    const connections = new FakeConnections()
    const listeners = createListenerFactory()
    const forwards = new ForwardingManager(connections, { createListener: listeners.create })
    const forward = await forwards.start(connectionId, loopbackSpec, owner)
    connections.emit({ kind: "lost", connectionId, owner, reason: "network" })

    connections.emit({ kind: "ready", connectionId, owner, transportGeneration: 2 })
    connections.emit({ kind: "ready", connectionId, owner, transportGeneration: 2 })
    await flush()

    expect(forwards.get(forward.id)).toMatchObject({ status: "forwarding" })
    expect(listeners.created).toHaveLength(2)
    expect(connections.activeLeaseCount()).toBe(1)
  })

  it("ignores a stale listener activation after transport recovery is queued", async () => {
    const connections = new FakeConnections()
    const listeners = createListenerFactory({ deferListen: true })
    const forwards = new ForwardingManager(connections, { createListener: listeners.create })
    const starting = forwards.start(connectionId, loopbackSpec, owner)

    await waitFor(() => listeners.created.length === 1)
    connections.emit({ kind: "lost", connectionId, owner, reason: "network" })
    connections.emit({ kind: "ready", connectionId, owner, transportGeneration: 2 })
    listeners.created[0].finishListen()

    await waitFor(() => listeners.created.length === 2)
    listeners.created[1].finishListen()
    const forward = await starting
    await waitFor(() => forwards.get(forward.id)?.status === "forwarding")

    expect(listeners.created).toHaveLength(2)
    expect(listeners.created[0].closed).toBe(true)
    expect(connections.activeLeaseCount()).toBe(1)
  })

  it("closes a forward and clears its lease when the shared connection fails", async () => {
    const connections = new FakeConnections()
    const listeners = createListenerFactory()
    const forwards = new ForwardingManager(connections, { createListener: listeners.create })
    const forward = await forwards.start(connectionId, loopbackSpec, owner)

    connections.emit({ kind: "failed", connectionId, owner, reason: "network" })
    await flush()

    expect(forwards.get(forward.id)).toMatchObject({ status: "error", error: "network" })
    expect(listeners.created[0].closed).toBe(true)
    expect(connections.activeLeaseCount()).toBe(0)
    await expect(forwards.resume(forward.id)).rejects.toThrow("Port forwarding is not suspended")
  })

  it("releases its forward lease after a local port conflict", async () => {
    const connections = new FakeConnections()
    const listeners = createListenerFactory({ listenError: Object.assign(new Error("in use"), { code: "EADDRINUSE" }) })
    const forwards = new ForwardingManager(connections, { createListener: listeners.create })

    await expect(forwards.start(connectionId, loopbackSpec, owner)).rejects.toThrow("LOCAL_PORT_IN_USE")

    expect(forwards.list()).toMatchObject([{ status: "error", error: "LOCAL_PORT_IN_USE" }])
    expect(connections.activeLeaseCount()).toBe(0)
    expect(connections.releaseCount()).toBe(1)
    expect(listeners.created[0].closed).toBe(true)
  })

  it("releases only the closed window's forward leases", async () => {
    const connections = new FakeConnections()
    const listeners = createListenerFactory()
    const forwards = new ForwardingManager(connections, { createListener: listeners.create })
    const owned = await forwards.start(connectionId, loopbackSpec, owner)
    const other = await forwards.start("connection-b", { ...loopbackSpec, localPort: 43124 }, otherOwner)

    await forwards.releaseOwner(owner)

    expect(forwards.get(owned.id)).toMatchObject({ status: "stopped" })
    expect(forwards.get(other.id)).toMatchObject({ status: "forwarding" })
    expect(connections.activeLeaseCount()).toBe(1)
    expect(connections.releaseCount()).toBe(1)
  })

  it("keeps the shared SSH transport alive after its terminal lease closes", async () => {
    const { clientEnd, connections } = createSharedConnectionHarness()
    const listeners = createListenerFactory()
    const terminal = await connections.acquire({ hostId: "host-a", owner, kind: "terminal" })
    const forwards = new ForwardingManager(connections, { createListener: listeners.create })
    const forward = await forwards.start(terminal.connectionId, loopbackSpec, owner)

    await connections.release(terminal.id)

    expect(forwards.get(forward.id)).toMatchObject({ status: "forwarding" })
    expect(clientEnd).not.toHaveBeenCalled()

    await forwards.stop(forward.id)

    expect(clientEnd).toHaveBeenCalledOnce()
  })
})

class FakeConnections implements ForwardingConnectionAccess {
  private readonly listeners = new Set<(event: ConnectionEvent) => void>()
  private readonly leases = new Map<string, ConnectionLease>()
  private readonly connectionOwners = new Map<string, RuntimeOwner>()
  private nextLease = 1
  private releases = 0

  public retain(connectionId: string, owner: RuntimeOwner, kind: "forward"): ConnectionLease {
    const existingOwner = this.connectionOwners.get(connectionId)
    if (existingOwner !== undefined && !sameRuntimeOwner(existingOwner, owner)) throw new Error("SSH connection is not owned by this window")
    this.connectionOwners.set(connectionId, owner)
    const lease: ConnectionLease = {
      id: `lease-${this.nextLease++}`,
      connectionId,
      owner,
      kind
    }
    this.leases.set(lease.id, lease)
    return lease
  }

  public async release(leaseId: string): Promise<void> {
    if (this.leases.delete(leaseId)) this.releases += 1
  }

  public async releaseOwner(owner: RuntimeOwner): Promise<void> {
    for (const lease of [...this.leases.values()]) {
      if (sameRuntimeOwner(lease.owner, owner)) this.leases.delete(lease.id)
    }
  }

  public async releaseWebContents(webContentsId: number): Promise<void> {
    for (const lease of [...this.leases.values()]) {
      if (lease.owner.webContentsId === webContentsId) this.leases.delete(lease.id)
    }
  }

  public async execOnConnection(_connectionId: string, _command: string): Promise<string> {
    return ""
  }

  public getClientForConnection(_connectionId: string): ReturnType<ConnectionCommandExecutor["getClientForConnection"]> {
    throw new Error("A client is only needed when a local socket connects")
  }

  public onEvent(listener: (event: ConnectionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public emit(event: ConnectionEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  public activeLeaseCount(): number {
    return this.leases.size
  }

  public releaseCount(): number {
    return this.releases
  }
}

interface ListenerFactoryOptions {
  listenError?: NodeJS.ErrnoException
  deferListen?: boolean
}

function createListenerFactory(options: ListenerFactoryOptions = {}) {
  const created: FakeListener[] = []
  const create: LocalListenerFactory = (_onConnection) => {
    const listener = new FakeListener(43123 + created.length, options.listenError, options.deferListen)
    created.push(listener)
    return listener
  }
  return { create, created }
}

class FakeListener implements LocalListener {
  private readonly emitter = new EventEmitter()
  private listenCallback?: () => void
  public closed = false

  public constructor(
    private readonly port: number,
    private readonly listenError?: NodeJS.ErrnoException,
    private readonly deferListen = false
  ) {}

  public once(event: "error", listener: (error: NodeJS.ErrnoException) => void): void {
    this.emitter.once(event, listener)
  }

  public listen(_port: number, _host: string, callback: () => void): void {
    if (this.deferListen) {
      this.listenCallback = callback
      return
    }
    queueMicrotask(() => {
      if (this.listenError) {
        this.emitter.emit("error", this.listenError)
        return
      }
      callback()
    })
  }

  public finishListen(): void {
    this.listenCallback?.()
    this.listenCallback = undefined
  }

  public close(callback: (error?: Error) => void): void {
    this.closed = true
    queueMicrotask(() => callback())
  }

  public address(): { port: number } {
    return { port: this.port }
  }
}

function createSharedConnectionHarness() {
  const emitter = new EventEmitter()
  const clientEnd = vi.fn()
  const connections = new SshConnectionManager({
    createClient: () => ({
      connect: (config: ConnectConfig) => {
        const verify = (accepted: boolean): void => { if (accepted) emitter.emit("ready") }
        ;(config.hostVerifier as HostFingerprintVerifier)("fingerprint-a", verify)
      },
      end: clientEnd,
      on: emitter.on.bind(emitter),
      once: emitter.once.bind(emitter)
    } as unknown as Client),
    resolve: async () => ({
      host: "127.0.0.1",
      port: 22,
      username: "rock",
      authMethod: "agent" as const,
      readyTimeoutMs: 15_000,
      securityContextKey: "test"
    }),
    inspectHostKey: async (_request, fingerprint) => ({ status: "match" as const, fingerprint }),
    promptForHostKey: async () => false
  })
  return { clientEnd, connections }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return
    await flush()
  }
  throw new Error("Timed out waiting for forwarding state")
}
