import { describe, expect, it } from "vitest"
import type { DiscoveredPort, ForwardingInfo } from "../../app/types"
import { applyDiscoveredPorts, applyForwarding, createPortState, setPortError } from "./port-state"

const discovered: DiscoveredPort = {
  id: "port-3000",
  sessionId: "session",
  remoteAddress: "0.0.0.0",
  remotePort: 3000,
  process: "node",
  user: "rock",
  source: "ss",
  status: "discovered"
}

describe("Ports view state", () => {
  it("keeps discovered ports idle until the user forwards them", () => {
    const state = applyDiscoveredPorts(createPortState(), [discovered])
    expect(state.ports[0].status).toBe("discovered")
    expect(state.forwardings).toEqual([])
  })

  it("tracks forwarding independently from discovery", () => {
    const forwarding: ForwardingInfo = {
      id: "forward-1",
      sessionId: "session",
      localAddress: "127.0.0.1",
      localPort: 3000,
      remoteAddress: "0.0.0.0",
      remotePort: 3000,
      status: "forwarding"
    }
    const state = applyForwarding(applyDiscoveredPorts(createPortState(), [discovered]), forwarding)
    expect(state.ports).toHaveLength(1)
    expect(state.forwardings[0]).toEqual(forwarding)
  })

  it("retains discovered records when an action fails", () => {
    const state = setPortError(applyDiscoveredPorts(createPortState(), [discovered]), "LOCAL_PORT_IN_USE")
    expect(state.ports).toHaveLength(1)
    expect(state.error).toBe("LOCAL_PORT_IN_USE")
  })
})
