import { afterEach, describe, expect, it, vi } from "vitest"
import { registerWorkbenchIpc } from "./ipc"
import { ipcChannels } from "../ipc/bridge-contract"
import { WorkbenchService } from "./service"
import { WorkbenchProfileStore } from "./profile-store"
import { TestTransport } from "./test-transport"
import { tmpdir } from "node:os"
import { join } from "node:path"

const electron = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn(), showOpenDialog: vi.fn(), fromWebContents: vi.fn() }))
vi.mock("electron", () => ({ ipcMain: { handle: electron.handle, removeHandler: electron.removeHandler }, dialog: { showOpenDialog: electron.showOpenDialog }, BrowserWindow: { fromWebContents: electron.fromWebContents } }))
afterEach(() => vi.restoreAllMocks())
describe("Workbench IPC boundary", () => {
  it("derives ownership from the sender and rejects invalid operations before executing", async () => {
    const service = new WorkbenchService(new WorkbenchProfileStore(join(tmpdir(), "unused-workbench-ipc.json")), async () => new TestTransport())
    const owner = { webContentsId: 7, rendererGeneration: 3 }, ownerFor = vi.fn(() => owner)
    const cleanup = registerWorkbenchIpc(service, ownerFor, vi.fn())
    const handle = electron.handle.mock.lastCall![1] as (event: { sender: { id: number } }, action: unknown, input: unknown) => Promise<unknown>
    const sender = { sender: { id: 7 } }
    const send = vi.spyOn(service, "send").mockResolvedValue(undefined)
    await handle(sender, "send", { id: "session", text: "task", owner: { webContentsId: 99 } })
    expect(send).toHaveBeenCalledWith("session", "task", owner)
    expect(ownerFor).toHaveBeenCalledWith(7)
    await expect(handle(sender, "executeAnything", {})).rejects.toThrow("Unknown")
    await expect(handle(sender, "send", { id: "session", text: "a".repeat(100_001) })).rejects.toThrow()
    await expect(handle(sender, "terminal", { id: "session", action: "resize", cols: -1 })).rejects.toThrow()
    await expect(handle(sender, "approve", { id: "session", approvalId: "a", accept: "true" })).rejects.toThrow()
    await expect(handle(sender, "save", { id: "p", name: "test", source: "cloud", cwd: "/tmp", executable: "codex" })).rejects.toThrow("SSH Host")
    expect(send).toHaveBeenCalledTimes(1)
    cleanup(); expect(electron.removeHandler).toHaveBeenCalledWith(ipcChannels.workbenchRequest)
  })
})
