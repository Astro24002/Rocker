import type { RemoteExecOptions } from "../ssh/types"
import type { ConnectionLease, SshConnectionManager } from "../ssh/connection-manager"
import { runtimeOwnerKey, type RuntimeOwner } from "../runtime/owner"
import { parseListeningPorts } from "./linux-port-parser"
import type { DiscoveredPort } from "./types"

const ssCommand = "ss -ltnpeH"
const netstatCommand = "netstat -ltnpe"

export class PortService {
  private readonly workspaces = new Map<string, {
    hostId: string
    owner: RuntimeOwner
    controller: AbortController
    lease: Promise<ConnectionLease>
    scans: Set<Promise<DiscoveredPort[]>>
  }>()

  public constructor(private readonly sessions: Pick<SshConnectionManager, "acquire" | "release" | "execOnConnection">) {}

  public async openWorkspace(workspaceId: string, hostId: string, owner: RuntimeOwner): Promise<void> {
    const key = this.workspaceKey(workspaceId, owner)
    const existing = this.workspaces.get(key)
    if (existing) {
      if (existing.hostId !== hostId) throw new Error("PF workspace belongs to a different Host")
      await existing.lease
      return
    }
    const controller = new AbortController()
    const record = { hostId, owner, controller, lease: this.sessions.acquire({ hostId, owner, kind: "forward", signal: controller.signal }), scans: new Set<Promise<DiscoveredPort[]>>() }
    this.workspaces.set(key, record)
    try {
      await record.lease
    } catch (error) {
      if (this.workspaces.get(key) === record) this.workspaces.delete(key)
      throw error
    }
  }

  public async closeWorkspace(workspaceId: string, owner: RuntimeOwner): Promise<void> {
    await this.closeKey(this.workspaceKey(workspaceId, owner))
  }

  public async scanWorkspace(workspaceId: string, owner: RuntimeOwner): Promise<DiscoveredPort[]> {
    const record = this.workspaces.get(this.workspaceKey(workspaceId, owner))
    if (!record) throw new Error("PF workspace is not open in this window")
    // A scan gets its own lease so a recovering transport is awaited, and closing
    // the workspace can cancel this command without stopping existing forwards.
    const scanning = (async () => {
      await record.lease
      const lease = await this.sessions.acquire({ hostId: record.hostId, owner, kind: "forward", signal: record.controller.signal })
      try {
        return await this.scan(lease.connectionId, { signal: record.controller.signal, timeoutMs: 10_000, maxOutputBytes: 1_048_576 })
      } finally {
        await this.sessions.release(lease.id)
      }
    })()
    record.scans.add(scanning)
    try {
      return await scanning
    } finally {
      record.scans.delete(scanning)
    }
  }

  public async releaseOwner(owner: RuntimeOwner): Promise<void> {
    const prefix = `${runtimeOwnerKey(owner)}:`
    await Promise.all([...this.workspaces.keys()].filter((key) => key.startsWith(prefix)).map((key) => this.closeKey(key)))
  }

  public async releaseWebContents(webContentsId: number): Promise<void> {
    await Promise.all([...this.workspaces].filter(([, record]) => record.owner.webContentsId === webContentsId).map(([key]) => this.closeKey(key)))
  }

  public async releaseHost(hostId: string): Promise<void> {
    await Promise.all([...this.workspaces].filter(([, record]) => record.hostId === hostId).map(([key]) => this.closeKey(key)))
  }

  private workspaceKey(workspaceId: string, owner: RuntimeOwner): string {
    return `${runtimeOwnerKey(owner)}:${workspaceId}`
  }

  private async closeKey(key: string): Promise<void> {
    const record = this.workspaces.get(key)
    if (!record) return
    this.workspaces.delete(key)
    record.controller.abort()
    await Promise.allSettled([...record.scans])
    const lease = await record.lease.catch(() => undefined)
    if (lease) await this.sessions.release(lease.id)
  }

  public async scan(connectionId: string, options?: RemoteExecOptions): Promise<DiscoveredPort[]> {
    try {
      const output = await this.sessions.execOnConnection(connectionId, ssCommand, options)
      const ports = parseListeningPorts(output, "ss")
      if (ports.length > 0) return ports.map((port) => ({ ...port, connectionId }))
    } catch {
      // The netstat fallback below reports the final unsupported state.
    }
    if (options?.signal?.aborted) throw new Error("Port scan was cancelled")
    const output = await this.sessions.execOnConnection(connectionId, netstatCommand, options)
    return parseListeningPorts(output, "netstat").map((port) => ({ ...port, connectionId }))
  }
}
