import { once } from "node:events"
import { createServer, type Server } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { ForwardingManager } from "../electron/ports/forwarding-manager"

const occupiedServers: Server[] = []

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
    const manager = new ForwardingManager({
      getClient: () => { throw new Error("forwardOut should not run for a bind conflict") }
    })

    await expect(manager.start("session-1", {
      localAddress: "127.0.0.1",
      localPort: address.port,
      remoteAddress: "127.0.0.1",
      remotePort: 3000
    })).rejects.toThrow("LOCAL_PORT_IN_USE")
  })

  it("stops all listeners associated with a session", async () => {
    const manager = new ForwardingManager({
      getClient: () => { throw new Error("client is only needed when a socket connects") }
    })
    const first = await manager.start("session-a", {
      localAddress: "127.0.0.1",
      localPort: 0,
      remoteAddress: "127.0.0.1",
      remotePort: 3000
    })
    const second = await manager.start("session-b", {
      localAddress: "127.0.0.1",
      localPort: 0,
      remoteAddress: "127.0.0.1",
      remotePort: 4000
    })

    await manager.stopForSession("session-a")

    expect(manager.get(first.id)?.status).toBe("stopped")
    expect(manager.get(second.id)?.status).toBe("forwarding")
    await manager.stop(second.id)
  })
})
