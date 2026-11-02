import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WorkbenchService } from "./service"
import { WorkbenchProfileStore } from "./profile-store"
import { TestTransport } from "./test-transport"
import { record, type WorkbenchProfile } from "./types"

const owner = { webContentsId: 1, rendererGeneration: 1 }
const profile: WorkbenchProfile = { id: "project", name: "Project", source: "local", cwd: "/tmp", executable: "codex" }
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); vi.restoreAllMocks() })
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "rocker-workbench-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const profiles = new WorkbenchProfileStore(join(directory, "profiles.json")); await profiles.save(profile)
  const transports: TestTransport[] = []
  const connect = vi.fn(async () => { const transport = new TestTransport(); transports.push(transport); return transport })
  const service = new WorkbenchService(profiles, connect)
  cleanup.push(() => service.releaseWebContents(1)); cleanup.push(() => service.releaseWebContents(2))
  return { service, profiles, transports, connect }
}
describe("Workbench lifecycle", () => {
  it("deduplicates an open, isolates independent sessions and window ownership", async () => {
    const { service, connect, transports } = await setup()
    await Promise.all([service.open("a", profile.id, owner), service.open("a", profile.id, owner)])
    expect(connect).toHaveBeenCalledTimes(1)
    await service.open("b", profile.id, owner)
    const other = { webContentsId: 2, rendererGeneration: 1 }
    await service.open("a", profile.id, other)
    expect(connect).toHaveBeenCalledTimes(3)
    const unsubscribe = service.onEvent(vi.fn()); unsubscribe()
    await service.send("a", "Inspect files", owner)
    expect(service.activeTaskCount(1)).toBe(1)
    await expect(service.close("a", owner)).rejects.toThrow("active task")
    await service.close("b", owner)
    expect(transports[0].close).not.toHaveBeenCalled()
    expect(service.read("a", other).status).toBe("ready")
    expect(() => service.read("a", { ...owner, rendererGeneration: 2 })).toThrow()
    await service.close("a", owner, true)
    expect(transports[0].sent).toContainEqual(expect.objectContaining({ method: "turn/interrupt" }))
    expect(transports[2].close).not.toHaveBeenCalled()
  })
  it.each(["close", "releaseOwner", "releaseWebContents", "releaseHost"])("cancels pending storage IO on %s", async action => {
    const { service, profiles, connect } = await setup()
    let resolve!: (profiles: WorkbenchProfile[]) => void
    vi.spyOn(profiles, "list").mockImplementation(() => new Promise(r => { resolve = r }))
    const pending = service.open("a", profile.id, owner)
    const rejected = expect(pending).rejects.toThrow()
    await Promise.resolve()
    if (action === "close") await service.close("a", owner)
    else if (action === "releaseOwner") await service.releaseOwner(owner)
    else if (action === "releaseWebContents") await service.releaseWebContents(owner.webContentsId)
    else await service.releaseHost("removed")
    resolve([{ ...profile, source: "remote", hostId: "removed" }]); await rejected
    expect(connect).not.toHaveBeenCalled()
  })
  it("closes a transport arriving after a cancelled connection", async () => {
    const { service, connect } = await setup(), transport = new TestTransport()
    let resolve!: (transport: TestTransport) => void
    connect.mockImplementation(() => new Promise(r => { resolve = r }))
    const opening = service.open("a", profile.id, owner)
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
    await service.close("a", owner); resolve(transport); await opening
    expect(transport.close).toHaveBeenCalledTimes(1)
    expect(transport.sent).toHaveLength(0)
    expect(() => service.read("a", owner)).toThrow()
  })
  it("streams messages, requires explicit approvals and resumes without replaying a task", async () => {
    const { service, transports } = await setup()
    await service.open("a", profile.id, owner); await service.send("a", "A task", owner)
    const transport = transports[0]
    transport.emit({ method: "item/agentMessage/delta", params: { itemId: "reply", delta: "Hello" } })
    transport.emit({ id: "permission-1", method: "item/commandExecution/requestApproval", params: { command: "ls" } })
    const approval = service.read("a", owner).approvals[0]
    expect(transport.sent.some(r => r.id === "permission-1")).toBe(false)
    service.approve("a", approval.id, true, owner)
    expect(transport.sent).toContainEqual({ id: "permission-1", result: { decision: "accept" } })
    expect(() => service.approve("a", approval.id, true, owner)).toThrow()
    transport.emit({ id: 900, method: "unimplemented/request", params: {} })
    expect(transport.sent).toContainEqual(expect.objectContaining({ id: 900, error: expect.objectContaining({ code: -32601 }) }))
    transport.disconnect()
    expect(service.read("a", owner)).toMatchObject({ status: "error", threadId: "thread-1", items: [{ text: "Hello" }] })
    await service.reconnect("a", owner)
    expect(transports[1].sent).toContainEqual(expect.objectContaining({ method: "thread/resume", params: expect.objectContaining({ threadId: "thread-1" }) }))
    expect(transports[1].sent.some(r => r.method === "turn/start")).toBe(false)
  })
  it("keeps the optional PTY independent from the Codex turn and decodes split UTF-8", async () => {
    const { service, transports } = await setup()
    await service.open("a", profile.id, owner); await service.send("a", "task", owner)
    const transport = transports[0]
    expect(transport.sent.some(r => r.method === "command/exec")).toBe(false)
    await service.terminal("a", owner, "open"); await service.terminal("a", owner, "open")
    const requests = transport.sent.filter(r => r.method === "command/exec")
    expect(requests).toHaveLength(1)
    const processId = record(requests[0].params).processId
    for (const byte of Buffer.from("中文")) transport.emit({ method: "command/exec/outputDelta", params: { processId, deltaBase64: Buffer.from([byte]).toString("base64") } })
    expect(service.read("a", owner).terminal.output).toBe("中文")
    await service.terminal("a", owner, "write", "pwd\n")
    await service.terminal("a", owner, "resize", undefined, 80, 30)
    await service.terminal("a", owner, "close")
    expect(service.read("a", owner)).toMatchObject({ status: "running", terminal: { open: false } })
    expect(transport.sent.some(r => r.method === "turn/interrupt")).toBe(false)
  })
  it("answers structured questions and clears them when a turn completes", async () => {
    const { service, transports } = await setup()
    await service.open("a", profile.id, owner)
    transports[0].emit({ id: 99, method: "item/tool/requestUserInput", params: { questions: [{ id: "q", question: "Which?", options: [{ label: "One" }] }] } })
    const approval = service.read("a", owner).approvals[0]
    expect(() => service.answer("a", approval.id, {}, owner)).toThrow("each question")
    service.answer("a", approval.id, { q: "One" }, owner)
    expect(transports[0].sent).toContainEqual({ id: 99, result: { answers: { q: { answers: ["One"] } } } })
    transports[0].emit({ method: "turn/completed", params: { turn: { id: "turn-1" } } })
    expect(service.read("a", owner)).toMatchObject({ status: "ready", approvals: [] })
  })
  it("persists only profiles, with validation and independent atomic updates", async () => {
    const { profiles } = await setup()
    await Promise.all([profiles.save({ ...profile, id: "two" }), profiles.save({ ...profile, id: "three", source: "cloud", hostId: "host" })])
    expect(await profiles.list()).toHaveLength(3)
    await expect(profiles.save({ ...profile, source: "remote" })).rejects.toThrow("SSH Host")
    await expect(profiles.save({ ...profile, executable: "codex\nother" })).rejects.toThrow()
    await profiles.remove("two"); expect(await profiles.list()).toHaveLength(2)
  })
})
