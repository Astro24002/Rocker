import { EventEmitter } from "node:events"
import type { Client, ConnectConfig, HostFingerprintVerifier } from "ssh2"
import { describe, expect, it, vi } from "vitest"
import { SshConnectionManager, type RetryScheduler } from "./connection-manager"
import { TerminalSessionManager } from "./terminal-session-manager"
import type { OwnedTerminalSessionEvent } from "./types"

describe("TerminalSessionManager", () => {
  it("opens a PTY, forwards raw output packets, and closes an explicit session", async () => {
    const { sessions, channels, events } = createSessionHarness()
    const sessionId = "11111111-1111-4111-8111-111111111111"

    const info = await sessions.open({ sessionId, hostId: "host-a", cols: 120, rows: 40, ownerWebContentsId: 7 })
    channels.get(1)!.emitter.emit("data", Buffer.from([0xe4, 0xb8, 0xad]))

    expect(info).toMatchObject({ sessionId, hostId: "host-a", channelGeneration: 1, state: "connected" })
    expect(events.at(-1)).toMatchObject({
      kind: "output",
      packet: { sessionId, channelGeneration: 1, sequence: 1, bytes: new Uint8Array([0xe4, 0xb8, 0xad]) }
    })

    await sessions.close(sessionId)
    expect(events.at(-1)).toMatchObject({ kind: "state", sessionId, state: "closing", channelGeneration: 1 })
  })

  it("opens a fresh PTY generation for every recovered logical session", async () => {
    const { sessions, transport, retryScheduler, events } = createSessionHarness()
    const sessionId = "11111111-1111-4111-8111-111111111111"
    await sessions.open({ sessionId, hostId: "host-a", cols: 120, rows: 40, ownerWebContentsId: 7 })
    transport.dropUnexpectedly()
    await retryScheduler.runNext()

    expect(events.filter((event) => event.kind === "state" && event.state === "connected")).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({ kind: "state", sessionId, channelGeneration: 2, notice: "reconnected" })
  })

  it("ignores a stale shell close after an unexpected transport loss", async () => {
    const { sessions, transport, retryScheduler, channels, events } = createSessionHarness()
    const sessionId = "11111111-1111-4111-8111-111111111111"
    await sessions.open({ sessionId, hostId: "host-a", cols: 120, rows: 40, ownerWebContentsId: 7 })

    transport.dropUnexpectedly()
    channels.get(1)!.emitClose()
    await retryScheduler.runNext()

    expect(events.filter((event) => event.kind === "state" && event.state === "connected")).toHaveLength(2)
  })

  it("rejects input, resize, and acknowledgement from a prior channel generation", async () => {
    const { sessions, channels } = createSessionHarness()
    const sessionId = "11111111-1111-4111-8111-111111111111"
    await sessions.open({ sessionId, hostId: "host-a", cols: 120, rows: 40, ownerWebContentsId: 7 })

    sessions.write(sessionId, 0, "stale")
    sessions.resize(sessionId, 0, { cols: 80, rows: 24 })
    sessions.ackOutput(sessionId, 0, 1)

    expect(channels.get(1)!.write).not.toHaveBeenCalled()
    expect(channels.get(1)!.setWindow).not.toHaveBeenCalled()
    expect(channels.get(1)!.pause).not.toHaveBeenCalled()
  })

  it("does not retry after a normal shell-channel close", async () => {
    const { sessions, channels, events, retryScheduler } = createSessionHarness()
    const sessionId = "11111111-1111-4111-8111-111111111111"
    await sessions.open({ sessionId, hostId: "host-a", cols: 120, rows: 40, ownerWebContentsId: 7 })
    channels.get(1)!.emitClose()

    expect(events.at(-1)).toMatchObject({ kind: "state", state: "disconnected", reason: "channel-ended" })
    expect(retryScheduler.pendingTimers()).toHaveLength(0)
  })

  it("keeps shared recovery alive when one session cancels reconnect", async () => {
    const { sessions, transport, retryScheduler, channels } = createSessionHarness()
    const first = "11111111-1111-4111-8111-111111111111"
    const second = "22222222-2222-4222-8222-222222222222"
    await sessions.open({ sessionId: first, hostId: "host-a", cols: 120, rows: 40, ownerWebContentsId: 7 })
    await sessions.open({ sessionId: second, hostId: "host-a", cols: 120, rows: 40, ownerWebContentsId: 7 })

    transport.dropUnexpectedly()
    sessions.cancelReconnect(first)
    await retryScheduler.runNext()

    expect(channels.has(3)).toBe(true)
    expect(channels.has(4)).toBe(false)
  })

  it("releases every session belonging to a closed owner", async () => {
    const { sessions, channels } = createSessionHarness()
    const owned = "11111111-1111-4111-8111-111111111111"
    const other = "22222222-2222-4222-8222-222222222222"
    await sessions.open({ sessionId: owned, hostId: "host-a", cols: 120, rows: 40, ownerWebContentsId: 7 })
    await sessions.open({ sessionId: other, hostId: "host-a", cols: 120, rows: 40, ownerWebContentsId: 8 })

    await sessions.releaseOwner(7)
    expect(channels.get(1)!.end).toHaveBeenCalledOnce()
    expect(channels.get(2)!.end).not.toHaveBeenCalled()
  })

  it("restores active sessions before background sessions with one shell in flight", async () => {
    const { sessions, shellFactory } = createSessionHarness({ deferShellCallbacks: true })
    const background = "11111111-1111-4111-8111-111111111111"
    const active = "22222222-2222-4222-8222-222222222222"
    const backgroundOpen = sessions.open({ sessionId: background, hostId: "host-a", cols: 120, rows: 40, ownerWebContentsId: 7, restorePriority: "background" })
    const activeOpen = sessions.open({ sessionId: active, hostId: "host-a", cols: 121, rows: 40, ownerWebContentsId: 7, restorePriority: "active" })

    await waitFor(() => shellFactory.started.length === 1)
    expect(shellFactory.started.map((entry) => entry.cols)).toEqual([121])
    shellFactory.settleNext()
    await waitFor(() => shellFactory.started.length === 2)
    expect(shellFactory.started.map((entry) => entry.cols)).toEqual([121, 120])
    shellFactory.settleNext()
    await Promise.all([backgroundOpen, activeOpen])
  })
})

interface FakeChannel {
  emitter: EventEmitter
  write: ReturnType<typeof vi.fn>
  setWindow: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  on: EventEmitter["on"]
  emitClose(): void
}

interface HarnessOptions { deferShellCallbacks?: boolean }

function createSessionHarness(options: HarnessOptions = {}) {
  const events: OwnedTerminalSessionEvent["event"][] = []
  const channels = new Map<number, FakeChannel>()
  const shellFactory = createShellFactory(channels, options.deferShellCallbacks ?? false)
  const retryScheduler = createRetryScheduler()
  const transport = createTransport(shellFactory, retryScheduler)
  const sessions = new TerminalSessionManager({ connections: transport.connections })
  sessions.onEvent(({ event }) => events.push(event))
  return { sessions, transport, retryScheduler, events, channels, shellFactory }
}

function createShellFactory(channels: Map<number, FakeChannel>, deferred: boolean) {
  const pending: Array<() => void> = []
  const started: Array<{ cols: number }> = []
  let nextGeneration = 1
  return {
    started,
    shell: (shellOptions: { cols: number }, callback: (error: Error | undefined, channel?: FakeChannel) => void) => {
      const generation = nextGeneration++
      const channel = createFakeChannel()
      channels.set(generation, channel)
      const start = () => callback(undefined, channel)
      started.push({ cols: shellOptions.cols })
      if (deferred) pending.push(start)
      else queueMicrotask(start)
    },
    settleNext: () => pending.shift()?.()
  }
}

function createFakeChannel(): FakeChannel {
  const emitter = new EventEmitter()
  return {
    emitter,
    write: vi.fn(),
    setWindow: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    end: vi.fn(),
    on: emitter.on.bind(emitter),
    emitClose: () => emitter.emit("close")
  }
}

function createRetryScheduler() {
  const timers = new Map<number, () => void>()
  let nextId = 1
  return {
    schedule: (_delay: number, action: () => void) => {
      const id = nextId++
      timers.set(id, action)
      return id
    },
    cancel: (id: number) => timers.delete(id),
    pendingTimers: () => [...timers.keys()],
    runNext: async () => {
      const next = timers.entries().next().value as [number, () => void] | undefined
      if (!next) throw new Error("No retry timer is scheduled")
      timers.delete(next[0])
      next[1]()
      await waitFor(() => timers.size > 0 || true)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
}

function createTransport(shellFactory: ReturnType<typeof createShellFactory>, retryScheduler: ReturnType<typeof createRetryScheduler>) {
  const clients: EventEmitter[] = []
  const connections = new SshConnectionManager({
    createClient: () => {
      const emitter = new EventEmitter()
      clients.push(emitter)
      return {
        connect: (config: ConnectConfig) => {
          const verify = (accepted: boolean) => { if (accepted) emitter.emit("ready") }
          ;(config.hostVerifier as HostFingerprintVerifier)("fingerprint-a", verify)
        },
        shell: (shellOptions: { cols: number }, callback: (error: Error | undefined, channel?: FakeChannel) => void) => {
          shellFactory.shell(shellOptions, callback)
        },
        end: () => undefined,
        on: emitter.on.bind(emitter),
        once: emitter.once.bind(emitter)
      } as unknown as Client
    },
    scheduler: retryScheduler satisfies RetryScheduler,
    random: () => 0.5,
    resolve: async () => ({
      host: "127.0.0.1",
      port: 22,
      username: "rock",
      authMethod: "agent",
      readyTimeoutMs: 15_000,
      securityContextKey: "test"
    }),
    inspectHostKey: async (_request, fingerprint) => ({ status: "match" as const, fingerprint }),
    promptForHostKey: async () => false
  })
  return {
    connections,
    dropUnexpectedly: () => clients.at(-1)?.emit("close")
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (condition()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("Timed out waiting for expected behavior")
}
