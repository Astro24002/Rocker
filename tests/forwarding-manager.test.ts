import { once } from "node:events"
import { createServer, type Server } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { ForwardingManager, type ForwardingConnectionAccess } from "../electron/ports/forwarding-manager"
import type {
  ConnectionCommandExecutor,
  ConnectionEvent,
  ConnectionLease
} from "../electron/ssh/connection-manager"
import { sameRuntimeOwner, type RuntimeOwner } from "../electron/runtime/owner"

const occupiedServers: Server[] = []
const owner7: RuntimeOwner = { webContentsId: 7, rendererGeneration: 1 }
const owner8: RuntimeOwner = { webContentsId: 8, rendererGeneration: 1 }

afterEach(async () => {
  await Promise.all(occupiedServers.splice(0).map(async (server) => {
    server.close()
    await once(server, "close")
  }))
})

describe("local forwarding", () => {
  it("reports a deterministic local port conflict", async () => {
    const occupied = createServer()
    occupiedServers.push(occupied)
    occupied.listen(0, "127.0.0.1")
    await once(occupied, "listening")
    const address = occupied.address()
    if (!address || typeof address === "string") throw new Error("occupied port was not assigned")
    const manager = new ForwardingManager(createConnections())

    await expect(manager.start("connection-1", {
      localAddress: "127.0.0.1",
      localPort: address.port,
      remoteAddress: "127.0.0.1",
      remotePort: 3000
    }, owner7)).rejects.toThrow("LOCAL_PORT_IN_USE")
  })

  it("releases listeners belonging to a closed window", async () => {
    const manager = new ForwardingManager(createConnections())
    const first = await manager.start("connection-a", {
      localAddress: "127.0.0.1",
      localPort: 0,
      remoteAddress: "127.0.0.1",
      remotePort: 3000
    }, owner7)
    const second = await manager.start("connection-b", {
      localAddress: "127.0.0.1",
      localPort: 0,
      remoteAddress: "127.0.0.1",
      remotePort: 4000
    }, owner8)

    await manager.releaseOwner(owner7)

    expect(manager.get(first.id)?.status).toBe("stopped")
    expect(manager.get(second.id)?.status).toBe("forwarding")
    await manager.stop(second.id)
  })
})

function createConnections(): ForwardingConnectionAccess {
  const listeners = new Set<(event: ConnectionEvent) => void>()
  const leases = new Map<string, ConnectionLease>()
  let nextLease = 1
  return {
    retain: (connectionId, owner, kind) => {
      const lease: ConnectionLease = {
        id: `lease-${nextLease++}`,
        connectionId,
        owner,
        kind
      }
      leases.set(lease.id, lease)
      return lease
    },
    release: async (leaseId) => { leases.delete(leaseId) },
    releaseOwner: async (owner) => {
      for (const lease of [...leases.values()]) {
        if (sameRuntimeOwner(lease.owner, owner)) leases.delete(lease.id)
      }
    },
    releaseWebContents: async (webContentsId) => {
      for (const lease of [...leases.values()]) {
        if (lease.owner.webContentsId === webContentsId) leases.delete(lease.id)
      }
    },
    execOnConnection: async (_connectionId, _command) => "",
    getClientForConnection: (_connectionId): ReturnType<ConnectionCommandExecutor["getClientForConnection"]> => {
      throw new Error("A client is only needed when a socket connects")
    },
    onEvent: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
