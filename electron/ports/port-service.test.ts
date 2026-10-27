import { describe, expect, it, vi } from "vitest"
import type { ConnectionAcquireRequest, ConnectionLease } from "../ssh/connection-manager"
import type { RemoteExecOptions } from "../ssh/types"
import { PortService } from "./port-service"

const owner = { webContentsId: 1, rendererGeneration: 1 }
const output = 'LISTEN 0 128 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=42,fd=1))'

function setup() {
  let sequence = 0
  const connections = {
    acquire: vi.fn(async (request: ConnectionAcquireRequest): Promise<ConnectionLease> => ({ id: `lease-${++sequence}`, connectionId: "transport", owner: request.owner, kind: request.kind })),
    release: vi.fn(async (_id: string) => undefined),
    execOnConnection: vi.fn(async (_id: string, _command: string, _options?: RemoteExecOptions) => output)
  }
  return { connections, ports: new PortService(connections) }
}

describe("PF workspace connections", () => {
  it("deduplicates opening, scans without a terminal, and releases only its leases", async () => {
    const { connections, ports } = setup()
    await Promise.all([ports.openWorkspace("pf", "host", owner), ports.openWorkspace("pf", "host", owner)])
    expect(connections.acquire).toHaveBeenCalledOnce()
    expect(connections.acquire).toHaveBeenCalledWith(expect.objectContaining({ hostId: "host", owner, kind: "forward" }))
    await expect(ports.scanWorkspace("pf", owner)).resolves.toEqual([expect.objectContaining({ remotePort: 3000, process: "node" })])
    expect(connections.release.mock.calls).toEqual([["lease-2"]])
    await ports.closeWorkspace("pf", owner)
    expect(connections.release.mock.calls).toEqual([["lease-2"], ["lease-1"]])
  })

  it("isolates windows and renderer generations and rejects host reassignment", async () => {
    const { connections, ports } = setup()
    const other = { ...owner, webContentsId: 2 }
    const next = { ...owner, rendererGeneration: 2 }
    await ports.openWorkspace("pf", "host", owner)
    await expect(ports.scanWorkspace("pf", other)).rejects.toThrow("not open")
    await expect(ports.openWorkspace("pf", "other-host", owner)).rejects.toThrow("different Host")
    await ports.openWorkspace("pf", "host", other)
    await ports.openWorkspace("pf", "host", next)
    await ports.releaseOwner(owner)
    expect(connections.release.mock.calls).toEqual([["lease-1"]])
    await ports.releaseWebContents(1)
    expect(connections.release.mock.calls).toEqual([["lease-1"], ["lease-3"]])
    await expect(ports.scanWorkspace("pf", other)).resolves.toHaveLength(1)
    await ports.releaseHost("host")
    expect(connections.release).toHaveBeenCalledWith("lease-2")
  })

  it("closes a lease that arrives after a workspace closes during connection", async () => {
    const { connections, ports } = setup()
    let complete!: (lease: ConnectionLease) => void
    connections.acquire.mockReturnValueOnce(new Promise((resolve) => { complete = resolve }))
    const opening = ports.openWorkspace("pf", "host", owner)
    const closing = ports.closeWorkspace("pf", owner)
    expect(connections.acquire.mock.calls[0][0].signal?.aborted).toBe(true)
    complete({ id: "late", connectionId: "transport", owner, kind: "forward" })
    await Promise.all([opening, closing])
    expect(connections.release).toHaveBeenCalledWith("late")
    await expect(ports.scanWorkspace("pf", owner)).rejects.toThrow("not open")
  })

  it("permits retry after authentication fails", async () => {
    const { connections, ports } = setup()
    connections.acquire.mockRejectedValueOnce(new Error("Authentication failed"))
    await expect(ports.openWorkspace("pf", "host", owner)).rejects.toThrow("Authentication")
    await ports.openWorkspace("pf", "host", owner)
    await expect(ports.scanWorkspace("pf", owner)).resolves.toHaveLength(1)
    await ports.closeWorkspace("pf", owner)
  })

  it("aborts an active scan on close, waits for its release, and does not run fallback", async () => {
    const { connections, ports } = setup()
    await ports.openWorkspace("pf", "host", owner)
    connections.execOnConnection.mockImplementationOnce(async (_id, _command, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })
    }))
    const scanning = ports.scanWorkspace("pf", owner)
    const rejection = expect(scanning).rejects.toThrow("cancelled")
    await vi.waitFor(() => expect(connections.execOnConnection).toHaveBeenCalledOnce())
    await ports.closeWorkspace("pf", owner)
    await rejection
    expect(connections.execOnConnection).toHaveBeenCalledOnce()
    expect(connections.release.mock.calls).toEqual([["lease-2"], ["lease-1"]])
  })

  it("falls back to netstat and releases scan leases on errors", async () => {
    const { connections, ports } = setup()
    await ports.openWorkspace("pf", "host", owner)
    connections.execOnConnection.mockRejectedValue(new Error("command unavailable"))
    await expect(ports.scanWorkspace("pf", owner)).rejects.toThrow("unavailable")
    expect(connections.execOnConnection.mock.calls.map((call) => call[1])).toEqual(["ss -ltnpeH", "netstat -ltnpe"])
    expect(connections.release).toHaveBeenCalledWith("lease-2")
    await ports.closeWorkspace("pf", owner)
  })
})
