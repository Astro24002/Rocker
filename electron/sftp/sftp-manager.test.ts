import { EventEmitter } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Client, SFTPWrapper } from "ssh2"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SftpManager, type SftpConnectionAccess } from "./sftp-manager"

const owner = { webContentsId: 1, rendererGeneration: 1 }
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true }))) })

describe("SFTP cancellation ownership", () => {
  it("closes a channel returned after cancellation before releasing its transfer lease", async () => {
    const harness = await setup()
    await vi.waitFor(() => expect(harness.openChannel).toBeTypeOf("function"))
    let cancelled = false
    const cancelling = harness.manager.cancelTransfer(harness.taskId, owner).then(() => { cancelled = true })
    await Promise.resolve()
    expect(cancelled).toBe(false)
    harness.openChannel!()
    await vi.waitFor(() => expect(harness.channel.end).toHaveBeenCalled())
    expect(harness.channel.fastPut).not.toHaveBeenCalled()
    expect(harness.connections.release).not.toHaveBeenCalledWith("lease-2")
    harness.channel.emit("close")
    await cancelling
    expect(harness.connections.release).toHaveBeenCalledWith("lease-2")
    expect(harness.connections.release).not.toHaveBeenCalledWith("lease-1")
    await harness.manager.releaseOwner(owner)
  })

  it("settles a transfer whose callback never returns and suppresses late progress", async () => {
    const harness = await setup()
    await vi.waitFor(() => expect(harness.openChannel).toBeTypeOf("function"))
    harness.openChannel!()
    await vi.waitFor(() => expect(harness.channel.fastPut).toHaveBeenCalledOnce())
    const cancelling = harness.manager.cancelTransfer(harness.taskId, owner)
    expect(harness.channel.destroy).toHaveBeenCalled()
    harness.channel.emit("close")
    await cancelling
    const before = harness.manager.listTransfers(owner)
    harness.progress?.(1, 1, 1)
    harness.complete?.(null)
    expect(harness.manager.listTransfers(owner)).toEqual(before)
    expect(before[0].status).toBe("cancelled")
    expect(harness.connections.release).toHaveBeenCalledWith("lease-2")
    expect(harness.connections.release).not.toHaveBeenCalledWith("lease-1")
    await harness.manager.releaseOwner(owner)
  })
})

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "rocker-sftp-cancel-"))
  directories.push(directory)
  const path = join(directory, "source.txt")
  await writeFile(path, "x")
  let nextLease = 0
  const harness: {
    openChannel?: () => void
    progress?: (total: number, chunk: number, size: number) => void
    complete?: (error: Error | null) => void
  } = {}
  const channel = Object.assign(new EventEmitter(), {
    end: vi.fn(), destroy: vi.fn(),
    fastPut: vi.fn((_local: string, _remote: string, options: { step: (total: number, chunk: number, size: number) => void }, done: (error: Error | null) => void) => {
      harness.progress = options.step
      harness.complete = done
    })
  })
  const client = { sftp: (done: (error: Error | null, channel: SFTPWrapper) => void) => {
    harness.openChannel = () => done(null, channel as unknown as SFTPWrapper)
  } } as unknown as Client
  const connections: SftpConnectionAccess = {
    acquire: vi.fn(async () => ({ id: `lease-${++nextLease}`, hostId: "host-a", connectionId: "transport", owner, kind: "sftp" as const })),
    release: vi.fn(async () => undefined),
    getClientForConnection: () => client,
    onEvent: () => () => undefined
  }
  const manager = new SftpManager(connections)
  await manager.open("workspace", "host-a", owner)
  const selection = await manager.selectUpload("workspace", "/", path, owner)
  const started = await manager.upload(selection.selectionId, true, owner)
  if (started.kind !== "started") throw new Error("Expected upload task")
  return Object.assign(harness, { channel, connections, manager, taskId: started.task.id })
}
