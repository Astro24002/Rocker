import { randomUUID } from "node:crypto"
import { StringDecoder } from "node:string_decoder"
import { runtimeOwnerKey, type RuntimeOwner } from "../runtime/owner"
import { CodexRpc, type CodexTransport } from "./rpc"
import { WorkbenchProfileStore } from "./profile-store"
import { record, text, type WorkbenchProfile, type WorkbenchSnapshot } from "./types"

type Entry = { owner: RuntimeOwner; snapshot: WorkbenchSnapshot; controller: AbortController; rpc?: CodexRpc; ready?: Promise<void>; requests: Map<string, unknown>; terminalId?: string; terminalDecoder?: StringDecoder; timer?: ReturnType<typeof setTimeout> }
type Pending = { owner: RuntimeOwner; profileId: string; controller: AbortController; promise: Promise<WorkbenchSnapshot> }
type Connect = (profile: WorkbenchProfile, owner: RuntimeOwner, signal: AbortSignal) => Promise<CodexTransport>

export class WorkbenchService {
  private entries = new Map<string, Entry>()
  private pending = new Map<string, Pending>()
  private hostGeneration = 0
  private removedHosts = new Map<string, number>()
  private listeners = new Set<(event: { owner: RuntimeOwner; snapshot: WorkbenchSnapshot }) => void>()
  constructor(public readonly profiles: WorkbenchProfileStore, private connect: Connect, private localShell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/sh") {}
  onEvent(listener: (event: { owner: RuntimeOwner; snapshot: WorkbenchSnapshot }) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private key(id: string, owner: RuntimeOwner): string { return `${runtimeOwnerKey(owner)}:${id}` }
  private get(id: string, owner: RuntimeOwner): Entry { const entry = this.entries.get(this.key(id, owner)); if (!entry) throw new Error("Workspace session is not open in this window"); return entry }
  read(id: string, owner: RuntimeOwner): WorkbenchSnapshot { return structuredClone(this.get(id, owner).snapshot) }
  async open(id: string, profileId: string, owner: RuntimeOwner): Promise<WorkbenchSnapshot> {
    const key = this.key(id, owner)
    const existing = this.entries.get(key), pending = this.pending.get(key)
    if (pending) {
      if (pending.profileId !== profileId) throw new Error("Workspace session already belongs to another profile")
      return pending.promise
    }
    if (existing) {
      if (existing.snapshot.profile.id !== profileId) throw new Error("Workspace session already belongs to another profile")
      await existing.ready
      return structuredClone(existing.snapshot)
    }
    const controller = new AbortController(), hostGeneration = this.hostGeneration
    // Reserve ownership before storage IO so close/reload can cancel a pending open.
    const promise = Promise.resolve().then(async () => {
      const profile = (await this.profiles.list()).find(p => p.id === profileId)
      if (controller.signal.aborted) throw new Error("Workspace session was closed")
      if (!profile) throw new Error("Workspace profile was removed")
      if (profile.hostId && (this.removedHosts.get(profile.hostId) ?? 0) > hostGeneration) throw new Error("SSH Host was removed")
      const entry: Entry = { owner, controller, requests: new Map(), snapshot: { id, revision: 0, profile, status: "connecting", items: [], approvals: [], terminal: { open: false, output: "" } } }
      this.entries.set(key, entry)
      entry.ready = this.start(entry)
      await entry.ready
      return structuredClone(entry.snapshot)
    }).finally(() => this.pending.delete(key))
    this.pending.set(key, { owner, profileId, controller, promise })
    return promise
  }
  private async start(entry: Entry): Promise<void> {
    const s = entry.snapshot, controller = entry.controller
    s.status = "connecting"; s.error = undefined; s.approvals = []; entry.requests.clear(); this.emit(entry)
    try {
      const transport = await this.connect(s.profile, entry.owner, controller.signal)
      if (controller.signal.aborted) { transport.close(); return }
      const rpc = new CodexRpc(transport, message => this.message(entry, message), error => {
        if (s.status === "closed" || controller.signal.aborted) return
        s.status = "error"; s.error = error.message; s.approvals = []; entry.requests.clear(); s.terminal.open = false; entry.terminalId = undefined; this.emit(entry)
      })
      entry.rpc = rpc
      await rpc.request("initialize", { clientInfo: { name: "rocker", title: "Rocker", version: "0.8.1" }, capabilities: { experimentalApi: true } })
      rpc.notify("initialized")
      const result = record(await rpc.request(s.threadId ? "thread/resume" : "thread/start", { ...(s.threadId ? { threadId: s.threadId } : {}), cwd: s.profile.cwd, approvalPolicy: "on-request", sandbox: "workspace-write" }))
      const thread = record(result.thread)
      if (controller.signal.aborted) return
      if (!text(thread.id)) throw new Error("Codex did not return a conversation ID")
      s.threadId = text(thread.id)
      s.turnId = undefined
      if (Array.isArray(thread.turns)) for (const turn of thread.turns) {
        const value = record(turn)
        if (Array.isArray(value.items)) for (const item of value.items) this.item(entry, record(item))
        if (value.status === "inProgress") s.turnId = text(value.id)
      }
      s.status = s.turnId ? "running" : "ready"
      this.emit(entry)
    } catch (error) {
      if (controller.signal.aborted) return
      entry.rpc?.close()
      s.status = "error"; s.error = error instanceof Error ? error.message : String(error); this.emit(entry)
    }
  }
  async send(id: string, input: string, owner: RuntimeOwner): Promise<void> {
    const entry = this.get(id, owner), s = entry.snapshot
    if (s.status !== "ready" || !entry.rpc || !s.threadId) throw new Error("Codex is not ready for another task")
    s.status = "running"; s.error = undefined; this.emit(entry)
    try {
      const result = record(await entry.rpc.request("turn/start", { threadId: s.threadId, input: [{ type: "text", text: input, text_elements: [] }] }))
      // turn/completed may arrive before the RPC response.
      if (s.status === "running") s.turnId = text(record(result.turn).id) || s.turnId
      this.emit(entry)
    } catch (error) {
      if (!entry.controller.signal.aborted) { s.status = "error"; s.error = error instanceof Error ? error.message : String(error); this.emit(entry) }
      throw error
    }
  }
  async interrupt(id: string, owner: RuntimeOwner): Promise<void> {
    const e = this.get(id, owner)
    if (e.snapshot.turnId) await e.rpc?.request("turn/interrupt", { threadId: e.snapshot.threadId, turnId: e.snapshot.turnId })
  }
  async reconnect(id: string, owner: RuntimeOwner): Promise<WorkbenchSnapshot> {
    const e = this.get(id, owner)
    if (e.snapshot.status === "connecting") { await e.ready; return this.read(id, owner) }
    if (e.snapshot.status !== "error") throw new Error("Only disconnected sessions can reconnect")
    e.controller.abort(); e.rpc?.close(); e.controller = new AbortController()
    e.ready = this.start(e); await e.ready
    return this.read(id, owner)
  }
  approve(id: string, approvalId: string, accept: boolean, owner: RuntimeOwner): void {
    const e = this.get(id, owner)
    const approval = e.snapshot.approvals.find(a => a.id === approvalId && !a.questions)
    if (!approval || !e.requests.has(approvalId)) throw new Error("Approval is no longer pending")
    e.rpc?.respond(e.requests.get(approvalId), { decision: accept ? "accept" : "decline" })
    this.clearRequest(e, approvalId)
  }
  answer(id: string, approvalId: string, answers: Record<string, string>, owner: RuntimeOwner): void {
    const e = this.get(id, owner), approval = e.snapshot.approvals.find(a => a.id === approvalId)
    if (!approval?.questions || !e.requests.has(approvalId)) throw new Error("Question is no longer pending")
    const response: Record<string, { answers: string[] }> = {}
    for (const q of approval.questions) {
      if (!answers[q.id]?.trim()) throw new Error("Answer each question")
      response[q.id] = { answers: [answers[q.id]] }
    }
    e.rpc?.respond(e.requests.get(approvalId), { answers: response }); this.clearRequest(e, approvalId)
  }
  private clearRequest(e: Entry, id: string): void { e.requests.delete(id); e.snapshot.approvals = e.snapshot.approvals.filter(a => a.id !== id); this.emit(e) }
  async close(id: string, owner: RuntimeOwner, stop = false): Promise<void> {
    const key = this.key(id, owner), e = this.entries.get(key)
    if (!e) { this.pending.get(key)?.controller.abort(); return }
    if (e.snapshot.status === "running" && !stop) throw new Error("Codex has an active task")
    e.snapshot.status = "closed"; clearTimeout(e.timer)
    if (stop && e.snapshot.turnId) await e.rpc?.request("turn/interrupt", { threadId: e.snapshot.threadId, turnId: e.snapshot.turnId }, 2000).catch(() => undefined)
    e.controller.abort(); e.rpc?.close()
    this.entries.delete(key)
  }
  activeTaskCount(webContentsId?: number): number { return [...this.entries.values()].filter(e => e.snapshot.status === "running" && (webContentsId === undefined || e.owner.webContentsId === webContentsId)).length }
  async releaseOwner(owner: RuntimeOwner): Promise<void> {
    for (const pending of this.pending.values()) if (runtimeOwnerKey(pending.owner) === runtimeOwnerKey(owner)) pending.controller.abort()
    await this.releaseWhere(e => runtimeOwnerKey(e.owner) === runtimeOwnerKey(owner))
  }
  async releaseWebContents(id: number): Promise<void> {
    for (const pending of this.pending.values()) if (pending.owner.webContentsId === id) pending.controller.abort()
    await this.releaseWhere(e => e.owner.webContentsId === id)
  }
  async releaseHost(id: string): Promise<void> { this.removedHosts.set(id, ++this.hostGeneration); await this.releaseWhere(e => e.snapshot.profile.hostId === id) }
  private async releaseWhere(match: (e: Entry) => boolean): Promise<void> { await Promise.all([...this.entries.values()].filter(match).map(e => this.close(e.snapshot.id, e.owner, true))) }

  async terminal(id: string, owner: RuntimeOwner, action: string, data?: string, cols = 100, rows = 24): Promise<void> {
    const e = this.get(id, owner), rpc = e.rpc
    if (!rpc || e.snapshot.status === "error" || e.snapshot.status === "connecting") throw new Error("Codex connection is unavailable")
    if (action === "open") {
      if (e.terminalId) return
      const processId = randomUUID(); e.terminalId = processId
      e.terminalDecoder = new StringDecoder("utf8")
      e.snapshot.terminal = { open: true, output: "" }; this.emit(e)
      void rpc.request("command/exec", { command: [e.snapshot.profile.source === "local" ? this.localShell : "/bin/sh"], processId, tty: true, disableTimeout: true, cwd: e.snapshot.profile.cwd, size: { cols, rows } }, 0).then(() => {
        if (e.terminalId !== processId) return
        e.terminalId = undefined; e.snapshot.terminal.open = false; this.emit(e)
      }).catch(error => {
        if (e.terminalId !== processId) return
        e.terminalId = undefined; e.snapshot.terminal.open = false; e.snapshot.terminal.error = String(error); this.emit(e)
      })
    } else if (action === "close" && e.terminalId) {
      await rpc.request("command/exec/terminate", { processId: e.terminalId }); e.terminalId = undefined; e.snapshot.terminal.open = false; this.emit(e)
    } else if (action === "write" && e.terminalId) {
      await rpc.request("command/exec/write", { processId: e.terminalId, deltaBase64: Buffer.from(data ?? "").toString("base64") })
    } else if (action === "resize" && e.terminalId) {
      await rpc.request("command/exec/resize", { processId: e.terminalId, size: { cols, rows } })
    }
  }
  private item(e: Entry, value: Record<string, unknown>): void {
    const id = text(value.id)
    if (!id) return
    const type = text(value.type)
    const content = Array.isArray(value.content) ? value.content.map(c => text(record(c).text)).join("\n") : ""
    const body = text(value.text) || content || (type === "commandExecution" ? `${text(value.command)}\n${text(value.aggregatedOutput)}` : type === "fileChange" ? JSON.stringify(value.changes ?? []) : "")
    if (!body) return
    const item = { id, role: type === "userMessage" ? "user" as const : type === "agentMessage" ? "assistant" as const : "tool" as const, text: body.slice(-100_000) }
    const previous = e.snapshot.items.findIndex(i => i.id === id)
    if (previous < 0) e.snapshot.items.push(item); else e.snapshot.items[previous] = item
    e.snapshot.items = e.snapshot.items.slice(-100)
  }
  private message(e: Entry, message: Record<string, unknown>): void {
    const method = text(message.method), p = record(message.params), s = e.snapshot
    if (s.status === "closed" || e.controller.signal.aborted) return
    if (message.id !== undefined) {
      if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/tool/requestUserInput"].includes(method)) {
        const id = randomUUID(); e.requests.set(id, message.id)
        s.approvals.push({ id, method, description: text(p.command) || text(p.reason) || method, ...(method === "item/tool/requestUserInput" ? { questions: (Array.isArray(p.questions) ? p.questions : []).map(q => { const v = record(q); return { id: text(v.id), question: text(v.question), options: (Array.isArray(v.options) ? v.options : []).map(o => text(record(o).label)) } }) } : {}) })
      } else e.rpc?.reject(message.id)
    } else if (method === "turn/started") { s.status = "running"; s.turnId = text(record(p.turn).id) }
    else if (method === "turn/completed") {
      const turn = record(p.turn); s.status = "ready"; s.turnId = undefined
      s.error = text(record(turn.error).message) || undefined; s.approvals = []; e.requests.clear()
    } else if (method === "item/started" || method === "item/completed") this.item(e, record(p.item))
    else if (method === "item/agentMessage/delta" || method === "item/commandExecution/outputDelta") {
      const id = text(p.itemId); let item = s.items.find(i => i.id === id)
      if (!item) { item = { id, role: method === "item/agentMessage/delta" ? "assistant" : "tool", text: "" }; s.items.push(item) }
      item.text = (item.text + text(p.delta)).slice(-100_000); s.items = s.items.slice(-100)
    } else if (method === "error") { s.error = text(record(p.error).message) || "Codex reported an error" }
    else if (method === "command/exec/outputDelta" && p.processId === e.terminalId) {
      s.terminal.output = (s.terminal.output + (e.terminalDecoder?.write(Buffer.from(text(p.deltaBase64), "base64")) ?? "")).slice(-200_000)
    }
    this.emit(e)
  }
  private emit(e: Entry): void {
    e.snapshot.revision += 1
    if (e.timer || e.snapshot.status === "closed") return
    e.timer = setTimeout(() => { e.timer = undefined; const snapshot = structuredClone(e.snapshot); for (const listener of this.listeners) listener({ owner: e.owner, snapshot }) }, 25)
  }
}
