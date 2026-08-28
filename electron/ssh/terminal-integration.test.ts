import { afterEach, describe, expect, it } from "vitest"
import { SshConnectionManager, type ResolvedConnectionRequest, type RetryScheduler } from "./connection-manager"
import { TerminalSessionManager, type TerminalOpenRequest } from "./terminal-session-manager"
import { createSshTestServer, TEST_PASSWORD, TEST_USERNAME } from "./test-fixtures/ssh-server"

const sessions: TerminalSessionManager[] = []
const fixtures: Array<{ close(): Promise<void> }> = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

class ManualScheduler implements RetryScheduler {
  private actions: Array<() => void> = []
  schedule(_delay: number, action: () => void): number { this.actions.push(action); return this.actions.length }
  cancel(_id: number): void {}
  flush(): void { const actions = this.actions.splice(0); actions.forEach((action) => action()) }
}

function request(port: number, password = TEST_PASSWORD): ResolvedConnectionRequest {
  return { host: "127.0.0.1", port, username: TEST_USERNAME, authMethod: "password", password, readyTimeoutMs: 2_000, securityContextKey: "integration" }
}

function openRequest(sessionId: string, port: number, owner = 1): TerminalOpenRequest {
  return { sessionId, hostId: "fixture", cols: 80, rows: 24, ownerWebContentsId: owner }
}

function setup(port: number, resolved = request(port), scheduler?: ManualScheduler) {
  const trusted = new Set<string>()
  const connectionEvents: unknown[] = []
  const connections = new SshConnectionManager({
    scheduler,
    resolve: async () => resolved,
    inspectHostKey: async (_request, fingerprint) => trusted.has(fingerprint) ? { status: "match", fingerprint } : { status: "unknown", fingerprint },
    promptForHostKey: async () => true,
    trustHostKey: async (_host, _port, fingerprint) => { trusted.add(fingerprint) },
    onEvent: (event) => connectionEvents.push(event)
  })
  const events: any[] = []
  const terminal = new TerminalSessionManager({ connections, onEvent: (event) => events.push(event) })
  sessions.push(terminal)
  return { connections, terminal, events, connectionEvents }
}

describe("real SSH terminal integration", () => {
  it("trusts the first host key and reuses one verified connection for a second session", async () => {
    const fixture = await createSshTestServer(); fixtures.push(fixture)
    const { terminal, connectionEvents } = setup(fixture.port)
    const first = await terminal.open(openRequest("00000000-0000-4000-8000-000000000001", fixture.port))
    const second = await terminal.open(openRequest("00000000-0000-4000-8000-000000000002", fixture.port))
    expect(first.state).toBe("connected"); expect(second.state).toBe("connected")
    expect(fixture.connectionCount).toBe(1)
    expect(connectionEvents.filter((event: any) => event.kind === "ready")).toHaveLength(1)
  })

  it("opens two PTYs, forwards input and UTF-8 output, and observes resize", async () => {
    const fixture = await createSshTestServer({ welcome: "utf8: 世界\n" }); fixtures.push(fixture)
    const { terminal, events } = setup(fixture.port)
    const first = await terminal.open(openRequest("00000000-0000-4000-8000-000000000003", fixture.port))
    const second = await terminal.open(openRequest("00000000-0000-4000-8000-000000000004", fixture.port))
    terminal.write(first.sessionId, first.channelGeneration, "ping\n")
    terminal.write(second.sessionId, second.channelGeneration, "pong\n")
    await new Promise((resolve) => setTimeout(resolve, 20))
    terminal.resize(first.sessionId, first.channelGeneration, { cols: 120, rows: 40 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(events.some((event) => event.event.kind === "output" && new TextDecoder().decode(event.event.packet.bytes).includes("世界"))).toBe(true)
    expect(fixture.connectionCount).toBe(1)
    expect(fixture.ptyResizes).toContainEqual(expect.objectContaining({ cols: 120, rows: 40 }))
  })

  it("reconnects after transport loss with a new channel generation", async () => {
    const fixture = await createSshTestServer(); fixtures.push(fixture)
    const scheduler = new ManualScheduler(); const { terminal, events } = setup(fixture.port, request(fixture.port), scheduler)
    const opened = await terminal.open(openRequest("00000000-0000-4000-8000-000000000005", fixture.port))
    fixture.dropTransports(); await new Promise((resolve) => setTimeout(resolve, 20)); scheduler.flush()
    await new Promise((resolve) => setTimeout(resolve, 80))
    const states = events.map((event) => event.event).filter((event) => event.kind === "state")
    expect(states.some((event) => event.state === "reconnecting")).toBe(true)
    expect(states.some((event) => event.notice === "reconnected" && event.channelGeneration > opened.channelGeneration)).toBe(true)
  })

  it("reports authentication failure without retrying", async () => {
    const fixture = await createSshTestServer(); fixtures.push(fixture)
    const { terminal, events, connectionEvents } = setup(fixture.port, request(fixture.port, "wrong"))
    await expect(terminal.open(openRequest("00000000-0000-4000-8000-000000000006", fixture.port))).rejects.toThrow()
    expect(events.at(-1).event).toMatchObject({ kind: "state", state: "error", reason: "authentication" })
    expect(connectionEvents.some((event: any) => event.kind === "retrying")).toBe(false)
  })

  it("rejects a changed host key and does not replace the stored key", async () => {
    const fixture = await createSshTestServer(); fixtures.push(fixture)
    const replacementCalls: string[] = []; const { terminal, events } = (() => {
      const resolved = request(fixture.port)
      const connections = new SshConnectionManager({ resolve: async () => resolved, inspectHostKey: async () => ({ status: "changed", fingerprint: "new", storedFingerprint: "old", receivedFingerprint: "new" }), promptForHostKey: async () => false, replaceHostKey: async () => { replacementCalls.push("called") } })
      const events: any[] = []; const terminal = new TerminalSessionManager({ connections, onEvent: (event) => events.push(event) }); sessions.push(terminal); return { terminal, events }
    })()
    await expect(terminal.open(openRequest("00000000-0000-4000-8000-000000000007", fixture.port))).rejects.toThrow()
    expect(events.at(-1).event).toMatchObject({ state: "error" }); expect(replacementCalls).toHaveLength(0)
  })

  it("does not recover after the only terminal session is closed", async () => {
    const fixture = await createSshTestServer(); fixtures.push(fixture)
    const scheduler = new ManualScheduler(); const { terminal, events } = setup(fixture.port, request(fixture.port), scheduler)
    const opened = await terminal.open(openRequest("00000000-0000-4000-8000-000000000008", fixture.port))
    await terminal.close(opened.sessionId); fixture.dropTransports(); scheduler.flush(); await new Promise((resolve) => setTimeout(resolve, 20))
    expect(events.some((event) => event.event.notice === "reconnected")).toBe(false)
  })
})
