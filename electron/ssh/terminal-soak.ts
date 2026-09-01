import { performance } from "node:perf_hooks"
import { createSshTestServer, TEST_PASSWORD, TEST_USERNAME } from "./test-fixtures/ssh-server"
import {
  SshConnectionManager,
  type ResolvedConnectionRequest,
  type RetryScheduler
} from "./connection-manager"
import { TerminalSessionManager } from "./terminal-session-manager"
import { ForwardingManager } from "../ports/forwarding-manager"
import { LinuxMetricsSampler } from "../monitoring/linux-metrics"
import {
  runtimeResourcesAtBaseline,
  type RuntimeResourceSnapshot,
} from "../runtime/resource-snapshot"
import type { RuntimeOwner } from "../runtime/owner"

const DEFAULT_DURATION_MS = 1_800_000
const MIN_DURATION_MS = 1_000
const CYCLE_TIMEOUT_MS = 10_000
const MAX_RETRY_DELAY_MS = 100
const owner: RuntimeOwner = { webContentsId: 9001, rendererGeneration: 1 }

export interface TerminalSoakOptions {
  durationMs?: number
  cycleTimeoutMs?: number
  now?: () => number
  rss?: () => number
}

export interface TerminalSoakSummary {
  durationMs: number
  iterations: number
  failures: number
  reconnects: number
  maximumResources: RuntimeResourceSnapshot
  finalResourcesAtBaseline: boolean
  finalRssGrowthRatio: number | null
  rssMedians: { baseline: number | null; final: number | null }
}

interface RssSample {
  elapsedMs: number
  rss: number
}

interface SoakTerminalEvent {
  kind: "output" | "state"
  sessionId?: string
  channelGeneration?: number
  state?: string
  notice?: string
}

export async function runTerminalSoak(options: TerminalSoakOptions = {}): Promise<TerminalSoakSummary> {
  const durationMs = normalizeDuration(options.durationMs ?? DEFAULT_DURATION_MS)
  const cycleTimeoutMs = normalizeCycleTimeout(options.cycleTimeoutMs ?? CYCLE_TIMEOUT_MS)
  const now = options.now ?? (() => performance.timeOrigin + performance.now())
  const rss = options.rss ?? (() => process.memoryUsage().rss)
  const startedAt = now()
  const fixture = await createSshTestServer()
  const scheduler = new AcceleratedRetryScheduler()
  const trustedFingerprints = new Set<string>()
  const resolved: ResolvedConnectionRequest = {
    host: "127.0.0.1",
    port: fixture.port,
    username: TEST_USERNAME,
    authMethod: "password",
    password: TEST_PASSWORD,
    readyTimeoutMs: 2_000,
    securityContextKey: "terminal-soak"
  }
  const connections = new SshConnectionManager({
    scheduler,
    random: () => 0.5,
    maxRetryAttempts: Number.POSITIVE_INFINITY,
    resolve: async () => resolved,
    inspectHostKey: async (_request, fingerprint) => trustedFingerprints.has(fingerprint)
      ? { status: "match" as const, fingerprint }
      : { status: "unknown" as const, fingerprint },
    promptForHostKey: async () => true,
    trustHostKey: async (_host, _port, fingerprint) => { trustedFingerprints.add(fingerprint) },
  })
  const sessions = new TerminalSessionManager({ connections })
  const forwarding = new ForwardingManager(connections, { onEvent: () => observe() })
  const monitoring = new LinuxMetricsSampler(sessions)
  const terminalEvents: SoakTerminalEvent[] = []
  const unsubscribeSessions = sessions.onEvent(({ event }) => {
    if (event.kind === "output") {
      sessions.ackOutput(event.packet.sessionId, event.packet.channelGeneration, event.packet.sequence)
      terminalEvents.push({ kind: event.kind, sessionId: event.packet.sessionId, channelGeneration: event.packet.channelGeneration })
    } else {
      terminalEvents.push({ kind: event.kind, sessionId: event.sessionId, channelGeneration: event.channelGeneration, state: event.state, notice: event.notice })
    }
    observe()
  })
  let reconnects = 0
  let iterations = 0
  let failures = 0
  const rssSamples: RssSample[] = []
  let maximumResources = emptyRuntimeResources()

  const observe = (): void => {
    maximumResources = maxRuntimeResources(maximumResources, {
      connection: connections.resourceSnapshot(),
      terminal: sessions.resourceSnapshot(),
      forwarding: forwarding.resourceSnapshot()
    })
  }
  const connectionUnsubscribe = connections.onEvent((event) => {
    if (event.kind === "ready" && event.transportGeneration > 1) reconnects += 1
    observe()
  })

  try {
    while (iterations < 2 || now() - startedAt < durationMs) {
      iterations += 1
      try {
        await runCycle({ fixture, connections, sessions, forwarding, monitoring, terminalEvents, cycleTimeoutMs }, iterations)
      } catch {
        failures += 1
      }
      observe()
      rssSamples.push({ elapsedMs: Math.max(0, now() - startedAt), rss: rss() })
      await releaseOwnerResources({ fixture, connections, sessions, forwarding, cycleTimeoutMs, observe })
      observe()
    }
  } finally {
    unsubscribeSessions()
    connectionUnsubscribe()
    await releaseOwnerResources({ fixture, connections, sessions, forwarding, cycleTimeoutMs, observe }).catch(() => { failures += 1 })
    scheduler.cancelAll()
    await fixture.close().catch(() => { failures += 1 })
  }

  const finalResources = {
    connection: connections.resourceSnapshot(),
    terminal: sessions.resourceSnapshot(),
    forwarding: forwarding.resourceSnapshot()
  }
  const fixtureResources = fixture.resourceSnapshot()
  const finalResourcesAtBaseline = runtimeResourcesAtBaseline(finalResources) &&
    fixtureResources.clients === 0 && fixtureResources.sessions === 0 && fixtureResources.shells === 0 && fixtureResources.forwards === 0
  const rssMedians = computeRssMedians(rssSamples, durationMs)
  const finalRssGrowthRatio = rssMedians.baseline !== null && rssMedians.final !== null && rssMedians.baseline > 0
    ? rssMedians.final / rssMedians.baseline
    : null

  return {
    durationMs,
    iterations,
    failures,
    reconnects,
    maximumResources,
    finalResourcesAtBaseline,
    finalRssGrowthRatio,
    rssMedians
  }
}

interface CycleContext {
  fixture: Awaited<ReturnType<typeof createSshTestServer>>
  connections: SshConnectionManager
  sessions: TerminalSessionManager
  forwarding: ForwardingManager
  monitoring: LinuxMetricsSampler
  terminalEvents: SoakTerminalEvent[]
  cycleTimeoutMs: number
}

async function runCycle(context: CycleContext, iteration: number): Promise<void> {
  const firstSessionId = sessionId(iteration, 1)
  const secondSessionId = sessionId(iteration, 2)
  const first = await context.sessions.open({ sessionId: firstSessionId, hostId: "fixture", cols: 100, rows: 30, owner })
  const second = await context.sessions.open({ sessionId: secondSessionId, hostId: "fixture", cols: 100, rows: 30, owner })
  context.sessions.write(first.sessionId, first.channelGeneration, `soak-${iteration}-first\n`)
  context.sessions.write(second.sessionId, second.channelGeneration, `soak-${iteration}-second\n`)
  context.sessions.resize(first.sessionId, first.channelGeneration, { cols: 120, rows: 40 })
  await context.monitoring.sample(second.sessionId)

  const connectionId = context.sessions.connectionIdForSession(first.sessionId)
  if (!connectionId) throw new Error("Soak session did not retain its connection")
  const forward = await context.forwarding.start(connectionId, {
    localAddress: "127.0.0.1",
    localPort: 0,
    remoteAddress: "127.0.0.1",
    remotePort: context.fixture.port
  }, owner)

  context.fixture.dropTransports()
  await waitFor(() => hasTerminalState(context.terminalEvents, first.sessionId, "reconnecting") &&
    hasTerminalState(context.terminalEvents, second.sessionId, "reconnecting"), context.cycleTimeoutMs)
  await waitFor(() => hasReconnectedTerminal(context.terminalEvents, first.sessionId) &&
    hasReconnectedTerminal(context.terminalEvents, second.sessionId), context.cycleTimeoutMs)
  await waitFor(() => context.forwarding.get(forward.id)?.status === "forwarding", context.cycleTimeoutMs)

  await context.forwarding.stop(forward.id)
  await context.sessions.close(first.sessionId)
  await context.sessions.releaseOwner(owner)
}

async function releaseOwnerResources(context: {
  connections: SshConnectionManager
  sessions: TerminalSessionManager
  forwarding: ForwardingManager
  fixture: Awaited<ReturnType<typeof createSshTestServer>>
  cycleTimeoutMs: number
  observe: () => void
}): Promise<void> {
  await context.forwarding.releaseOwner(owner)
  await context.sessions.releaseOwner(owner)
  await context.connections.releaseOwner(owner)
  try {
    await waitFor(() => {
      context.observe()
      const connection = context.connections.resourceSnapshot()
      const terminal = context.sessions.resourceSnapshot()
      const forwarding = context.forwarding.resourceSnapshot()
      const fixture = context.fixture.resourceSnapshot()
      return connection.connections === 0 && connection.leases === 0 && connection.readyWaiters === 0 && connection.retryTimers === 0 && connection.connectingTransports === 0 &&
        terminal.sessions === 0 && terminal.channels === 0 && terminal.outputPumps === 0 && terminal.activeAttempts === 0 && terminal.recoveryWaiters === 0 && terminal.queuedShells === 0 &&
        forwarding.forwards === 0 && forwarding.listeners === 0 && forwarding.activationTasks === 0 &&
        fixture.clients === 0 && fixture.sessions === 0 && fixture.shells === 0 && fixture.forwards === 0
    }, context.cycleTimeoutMs)
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : "Resource cleanup timed out"}: ${JSON.stringify({
      connection: context.connections.resourceSnapshot(),
      terminal: context.sessions.resourceSnapshot(),
      forwarding: context.forwarding.resourceSnapshot(),
      fixture: context.fixture.resourceSnapshot()
    })}`)
  }
}

class AcceleratedRetryScheduler implements RetryScheduler {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()

  public schedule(delayMs: number, action: () => void): number {
    let timer: ReturnType<typeof setTimeout>
    timer = setTimeout(() => {
      this.timers.delete(timer)
      action()
    }, Math.min(Math.max(0, delayMs), MAX_RETRY_DELAY_MS))
    this.timers.add(timer)
    return timer as unknown as number
  }

  public cancel(id: number): void {
    const timer = id as unknown as ReturnType<typeof setTimeout>
    clearTimeout(timer)
    this.timers.delete(timer)
  }

  public cancelAll(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
  }
}

function computeRssMedians(samples: RssSample[], durationMs: number): { baseline: number | null; final: number | null } {
  if (samples.length === 0 || durationMs < 600_000) return { baseline: null, final: null }
  const baseline = samples.filter((sample) => sample.elapsedMs >= 300_000 && sample.elapsedMs < 600_000).map((sample) => sample.rss)
  const final = samples.filter((sample) => sample.elapsedMs >= Math.max(0, durationMs - 300_000)).map((sample) => sample.rss)
  return { baseline: median(baseline.length ? baseline : samples.map((sample) => sample.rss)), final: median(final.length ? final : samples.map((sample) => sample.rss)) }
}

function hasTerminalState(events: SoakTerminalEvent[], sessionId: string, state: string): boolean {
  return events.some((event) => event.kind === "state" && event.sessionId === sessionId && event.state === state)
}

function hasReconnectedTerminal(events: SoakTerminalEvent[], sessionId: string): boolean {
  return events.some((event) => event.kind === "state" && event.sessionId === sessionId && event.state === "connected" && event.notice === "reconnected" && (event.channelGeneration ?? 0) >= 2)
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function emptyRuntimeResources(): RuntimeResourceSnapshot {
  return {
    connection: { connections: 0, leases: 0, readyWaiters: 0, retryTimers: 0, connectingTransports: 0 },
    terminal: { sessions: 0, channels: 0, outputPumps: 0, activeAttempts: 0, recoveryWaiters: 0, queuedShells: 0 },
    forwarding: { forwards: 0, listeners: 0, activationTasks: 0 }
  }
}

function maxRuntimeResources(current: RuntimeResourceSnapshot, next: RuntimeResourceSnapshot): RuntimeResourceSnapshot {
  return {
    connection: maxRecord(current.connection, next.connection),
    terminal: maxRecord(current.terminal, next.terminal),
    forwarding: maxRecord(current.forwarding, next.forwarding)
  }
}

function maxRecord<T extends object>(current: T, next: T): T {
  const result = { ...current }
  for (const key of Object.keys(current)) {
    const left = (current as Record<string, unknown>)[key]
    const right = (next as Record<string, unknown>)[key]
    if (typeof left === "number" && typeof right === "number") {
      (result as Record<string, unknown>)[key] = Math.max(left, right)
    }
  }
  return result
}

function normalizeDuration(value: number): number {
  if (!Number.isSafeInteger(value) || value < MIN_DURATION_MS) throw new Error(`Soak duration must be at least ${MIN_DURATION_MS}ms`)
  return value
}

function normalizeCycleTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 100) throw new Error("Soak cycle timeout is invalid")
  return value
}

function sessionId(iteration: number, slot: number): string {
  const value = Math.max(1, iteration * 2 + slot).toString(16).padStart(12, "0")
  return `00000000-0000-4000-8000-${value}`
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for terminal soak event")
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
}
