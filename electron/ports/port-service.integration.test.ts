import { expect, it, vi } from "vitest"
import { PortService } from "./port-service"
import { ForwardingManager } from "./forwarding-manager"
import { SshConnectionManager } from "../ssh/connection-manager"
import { createSshTestServer, TEST_PASSWORD, TEST_USERNAME } from "../ssh/test-fixtures/ssh-server"

it("opens and scans a PF-only SSH transport, reuses it, and keeps a forwarding lease after the PF page closes", async () => {
  const fixture = await createSshTestServer({ execOutput: 'LISTEN 0 128 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=42,fd=1))\n' })
  const owner = { webContentsId: 61, rendererGeneration: 1 }
  const connections = new SshConnectionManager({
    resolve: async () => ({ host: "127.0.0.1", port: fixture.port, username: TEST_USERNAME, password: TEST_PASSWORD, authMethod: "password", readyTimeoutMs: 2_000, securityContextKey: "pf-test" }),
    inspectHostKey: async (_request, fingerprint) => ({ status: "match", fingerprint }),
    promptForHostKey: async () => true
  })
  const ports = new PortService(connections)
  const forwarding = new ForwardingManager(connections)
  try {
    await ports.openWorkspace("pf", "host", owner)
    expect(connections.resourceSnapshot()).toMatchObject({ connections: 1, leases: 1 })
    expect(fixture.ptyRequests).toHaveLength(0)
    const discovered = await ports.scanWorkspace("pf", owner)
    expect(discovered).toEqual([expect.objectContaining({ remotePort: 3000, process: "node" })])
    expect(connections.resourceSnapshot().leases).toBe(1)
    const runtime = await forwarding.start(discovered[0].connectionId!, { localAddress: "127.0.0.1", localPort: 0, remoteAddress: "127.0.0.1", remotePort: 3000 }, owner)
    expect(connections.resourceSnapshot().leases).toBe(2)
    expect(fixture.connectionCount).toBe(1)
    await ports.closeWorkspace("pf", owner)
    expect(connections.resourceSnapshot().leases).toBe(1)
    expect(forwarding.get(runtime.id)?.status).toBe("forwarding")
    await forwarding.stop(runtime.id)
    expect(connections.resourceSnapshot().leases).toBe(0)
    await vi.waitFor(() => expect(fixture.resourceSnapshot().clients).toBe(0))
  } finally {
    try { await ports.releaseOwner(owner) } finally {
      try { await forwarding.releaseOwner(owner) } finally {
        try { await connections.releaseOwner(owner) } finally { await fixture.close() }
      }
    }
  }
}, 15_000)
