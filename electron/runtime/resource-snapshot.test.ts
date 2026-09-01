import { describe, expect, it } from "vitest"
import { runtimeResourcesAtBaseline, type RuntimeResourceSnapshot } from "./resource-snapshot"

const baseline: RuntimeResourceSnapshot = {
  connection: { connections: 0, leases: 0, readyWaiters: 0, retryTimers: 0, connectingTransports: 0 },
  terminal: { sessions: 0, channels: 0, outputPumps: 0, activeAttempts: 0, recoveryWaiters: 0, queuedShells: 0 },
  forwarding: { forwards: 0, listeners: 0, activationTasks: 0 }
}

describe("runtime resource snapshots", () => {
  it("recognizes an exact all-zero baseline", () => {
    expect(runtimeResourcesAtBaseline(baseline)).toBe(true)
    expect(runtimeResourcesAtBaseline({
      ...baseline,
      terminal: { ...baseline.terminal, queuedShells: 1 }
    })).toBe(false)
  })

  it("uses count-only resource shapes without identifiers", () => {
    expect(JSON.stringify(baseline)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i)
    expect(baseline).not.toHaveProperty("sessionId")
    expect(baseline).not.toHaveProperty("hostId")
    expect(baseline).not.toHaveProperty("address")
  })
})
