# Rocker v0.3 Terminal Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Rocker's React-backed terminal output with a bounded, reconnectable SSH terminal engine that restores workspace metadata safely across application restarts.

**Architecture:** The Electron main process gains separate connection, terminal-session, output-pump, forwarding, and workspace-snapshot responsibilities. The renderer keeps one xterm.js controller per logical session and sends only small workspace state through React; terminal bytes use ordered, generation-aware IPC packets with acknowledgements.

**Tech Stack:** Electron 43, React 19, TypeScript, ssh2, xterm.js 6, @xterm/addon-fit, Vitest 4, Testing Library, electron-vite.

**Spec:** `docs/superpowers/specs/2026-08-19-rocker-terminal-engine-design.md`

## Global Constraints

- Support Windows and macOS desktop only; do not add mobile layouts or behavior.
- Keep Electron context isolation enabled and Node integration disabled in the renderer.
- Credentials, private-key contents, passphrases, terminal output, and typed commands must never be persisted, logged, or put into React state.
- Reuse SSH only inside the owner BrowserWindow and only after host configuration, authentication context, credential context, and verified Host Key context match.
- Do not add AI, cloud sync, team features, deep SFTP, snippets execution, ProxyJump, SOCKS5, remote forwarding, or remote file browsing.
- Port discovery remains user initiated. Never create a new port forward without an explicit user action.
- Preserve the current frameless, dark, native-app-like workspace; do not add a terminal tab strip or a permanent global terminal toolbar.
- English remains the default UI language and every new visible string must also have a Simplified Chinese translation.
- Use the existing runtime dependencies unless a concrete implementation blocker proves one is required.
- Preserve the user-owned `1.png` and deleted `Snipaste_2026-08-17_17-58-09.png`; do not stage either file.

---

## File Map

### Create

- `electron/ssh/types.ts` - shared terminal, connection, packet, and failure types.
- `electron/ssh/reconnect-policy.ts` - deterministic retry-delay calculation.
- `electron/ssh/terminal-output-pump.ts` - ordered, bounded SSH-output queue with acknowledgement accounting.
- `electron/ssh/connection-manager.ts` - per-window verified connection records, leases, and retry orchestration.
- `electron/ssh/terminal-session-manager.ts` - logical session records, PTY lifecycle, output pumps, and command execution.
- `electron/storage/workspace-store.ts` - validated, debounced, atomic workspace snapshot persistence.
- `electron/windows/workspace-window-manager.ts` - BrowserWindow-to-workspace ownership and shutdown behavior.
- `src/features/terminal/layout.ts` - pure horizontal layout-tree operations.
- `src/features/terminal/terminal-controller.ts` - xterm.js byte FIFO, fit lifecycle, and acknowledgement callback.
- `src/features/terminal/TerminalConnectionOverlay.tsx` - compact reconnect/error controls within the terminal surface.
- `electron/ssh/reconnect-policy.test.ts`
- `electron/ssh/terminal-output-pump.test.ts`
- `electron/ssh/connection-manager.test.ts`
- `electron/ssh/terminal-session-manager.test.ts`
- `electron/ports/forwarding-manager.test.ts`
- `electron/storage/workspace-store.test.ts`
- `electron/storage/settings-store.test.ts`
- `electron/windows/workspace-window-manager.test.ts`
- `electron/ipc/register.test.ts`
- `src/features/terminal/layout.test.ts`
- `src/features/terminal/terminal-controller.test.ts`
- `src/features/terminal/TerminalView.test.tsx`
- `src/features/terminal/TerminalConnectionOverlay.test.tsx`
- `src/features/settings/SettingsView.test.tsx`
- `tests/fixtures/terminal-engine.ts`
- `tests/terminal-engine-flow.test.ts`

### Modify

- `vite.config.ts` - include Electron main-process test files and run them in Node.
- `electron/ssh/host-keys.ts` and `electron/ssh/host-key-store.ts` - classify unknown and changed keys, then support an explicit replacement trust decision.
- `electron/ports/types.ts`, `electron/ports/forwarding-manager.ts`, and `electron/ports/port-service.ts` - make forwarding connection-scoped, suspendable, and resumable.
- `electron/storage/types.ts` and `electron/storage/settings-store.ts` - add snapshot and v0.3 settings types; remove `portScanInterval`.
- `electron/ipc/validation.ts`, `electron/ipc/bridge-contract.ts`, `electron/ipc/register.ts`, `electron/preload.ts`, and `electron/main.ts` - add generation-aware terminal IPC, owner-only routing, workspace IPC, window lifecycle, and resume handling.
- `electron/monitoring/linux-metrics.ts` - consume the new session-command interface instead of `SshManager`.
- `src/app/types.ts`, `src/app/bridge.ts`, and `src/app/App.tsx` - use the new bridge contract, restore snapshots, route byte packets to controllers, and persist workspace metadata.
- `src/features/terminal/session-state.ts`, `src/features/terminal/TerminalView.tsx`, and `src/features/terminal/TerminalWorkspace.tsx` - remove output state, use layout trees, keep inactive xterm instances alive, and surface state controls.
- `src/features/ports/PortsView.tsx` and `src/features/ports/port-state.ts` - display suspended forwards and an explicit Resume action.
- `src/features/settings/SettingsView.tsx` - expose v0.3 reconnect, restore, and paste settings and remove scan interval controls.
- `src/components/Sidebar.tsx`, `src/features/monitoring/MonitorSummary.tsx`, `src/styles/components.css`, and `src/styles/layout.css` - render the expanded session state set and the compact terminal overlay without changing the shell hierarchy.
- `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, and affected renderer tests - localize all new copy and remove old output-state assumptions.

### Delete

- `electron/ssh/ssh-manager.ts` after all imports use `TerminalSessionManager` and the smaller dependency interfaces from `electron/ssh/types.ts`.

## Task 1: Define Stable Terminal and Workspace State

**Files:**
- Create: `electron/ssh/types.ts`
- Create: `src/features/terminal/layout.ts`
- Create: `src/features/terminal/layout.test.ts`
- Modify: `src/features/terminal/session-state.ts`
- Modify: `src/features/terminal/session-state.test.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- Produces `TerminalSessionState`, `TerminalFailureReason`, `TerminalDimensions`, `TerminalOutputPacket`, `TerminalStateEvent`, and `TerminalSessionEvent` for all later main-process and renderer tasks.
- Produces `TerminalLayout`, `visibleSessionIds`, `insertHorizontalSplit`, and `removeSessionFromLayout` for workspace rendering and persistence.
- Produces `TerminalWorkspaceState { sessions, activeSessionId, layout }` with no terminal-output property.

- [ ] **Step 1: Write failing state and layout tests**

Replace the output-retention test with a no-output-state test and add tree tests.

```ts
it("stores session metadata without terminal output", () => {
  const state = openSession(createTerminalWorkspaceState(), {
    id: "11111111-1111-4111-8111-111111111111",
    hostId: "host-a",
    label: "G11"
  })

  expect(state.sessions[0]).toMatchObject({ state: "idle", channelGeneration: 0 })
  expect(state.sessions[0]).not.toHaveProperty("output")
})

it("collapses a horizontal split when one leaf closes", () => {
  const layout: TerminalLayout = {
    kind: "split",
    direction: "horizontal",
    ratio: 0.5,
    first: { kind: "leaf", sessionId: "a" },
    second: { kind: "leaf", sessionId: "b" }
  }

  expect(removeSessionFromLayout(layout, "b")).toEqual({ kind: "leaf", sessionId: "a" })
})
```

- [ ] **Step 2: Run the focused tests and confirm the old model fails**

Run: `npx vitest run src/features/terminal/session-state.test.ts src/features/terminal/layout.test.ts`

Expected: FAIL because `createTerminalWorkspaceState`, `openSession`, and the layout module do not exist, while the old session records still expose `output`.

- [ ] **Step 3: Implement shared types and pure workspace operations**

Create `electron/ssh/types.ts` with the exact runtime-facing types below. Keep
packets binary, make the owner a main-process routing wrapper rather than a
renderer-visible workspace field, and keep state events small.

```ts
export type TerminalSessionState =
  | "idle"
  | "restoring"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error"
  | "closing"

export type TerminalFailureReason =
  | "network" | "timeout" | "dns" | "authentication"
  | "host-key-changed" | "host-key-rejected" | "configuration"
  | "channel-ended" | "local-port-in-use" | "cancelled" | "unknown"

export interface TerminalDimensions { cols: number; rows: number }
export interface TerminalOutputPacket {
  sessionId: string
  channelGeneration: number
  sequence: number
  bytes: Uint8Array
}

export interface TerminalStateEvent {
  kind: "state"
  sessionId: string
  connectionId?: string
  channelGeneration: number
  state: TerminalSessionState
  reason?: TerminalFailureReason
  attempt?: number
  nextRetryAt?: string
  notice?: "reconnected" | "restored-new-shell"
}

export type TerminalSessionEvent =
  | { kind: "output"; packet: TerminalOutputPacket }
  | TerminalStateEvent

export interface OwnedTerminalSessionEvent {
  ownerWebContentsId: number
  event: TerminalSessionEvent
}

export interface TerminalSessionInfo {
  sessionId: string
  hostId: string
  channelGeneration: number
  state: TerminalSessionState
}
```

Refactor `session-state.ts` to expose the following serializable renderer
shape. It deliberately has no `connectionId`, screen buffer, or command text.

```ts
export interface WorkspaceSession {
  id: string
  hostId: string
  label: string
  state: TerminalSessionState
  channelGeneration: number
  dimensions?: TerminalDimensions
  reason?: TerminalFailureReason
  attempt?: number
  nextRetryAt?: string
}

export interface TerminalWorkspaceState {
  sessions: WorkspaceSession[]
  activeSessionId?: string
  layout?: TerminalLayout
}
```

Replace `openTab`, `closeTab`, `activateTab`, and `appendOutput` with
`createTerminalWorkspaceState`, `openSession`, `closeSession`,
`activateSession`, `applyTerminalState`, and `attachChannel`. `attachChannel`
copies only `channelGeneration` and `state` from `TerminalSessionInfo`. Set a
new session to `idle` with `channelGeneration: 0`, retain labels and
dimensions, and never add output.

Implement `layout.ts` as a pure recursive module. `insertHorizontalSplit`
replaces the selected leaf with a `split` node, `visibleSessionIds` returns
the leaf IDs in render order, and `removeSessionFromLayout` collapses a split
that loses one child.

Update `vite.config.ts` so Electron tests are included and have a Node
environment:

```ts
include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx", "electron/**/*.test.ts"],
environmentMatchGlobs: [["electron/**/*.test.ts", "node"]]
```

- [ ] **Step 4: Run the focused tests and typecheck**

Run: `npx vitest run src/features/terminal/session-state.test.ts src/features/terminal/layout.test.ts && npm run typecheck`

Expected: PASS. The session reducer contains no `output` or `appendOutput` export.

- [ ] **Step 5: Commit the state foundation**

```bash
git add vite.config.ts electron/ssh/types.ts src/features/terminal/layout.ts src/features/terminal/layout.test.ts src/features/terminal/session-state.ts src/features/terminal/session-state.test.ts
git commit -m "refactor: model terminal sessions without output state"
```

## Task 2: Build the Bounded Main-Process Output Pump

**Files:**
- Create: `electron/ssh/terminal-output-pump.ts`
- Create: `electron/ssh/terminal-output-pump.test.ts`

**Interfaces:**
- Consumes `TerminalOutputPacket` from Task 1.
- Produces `TerminalOutputPump.enqueue(bytes)`, `acknowledge(generation, sequence)`, `close()`, `queuedByteCount`, and `isPaused`.
- Consumes a narrow channel interface: `{ pause(): void; resume(): void }`.

- [ ] **Step 1: Write failing output-pump tests**

Cover packet splitting, byte ordering, stale acknowledgements, and the exact
4 MiB / 1 MiB pause-resume thresholds.

```ts
it("preserves UTF-8 source fragments and ANSI bytes in ordered 64 KiB packets", () => {
  const channel = { pause: vi.fn(), resume: vi.fn() }
  const packets: TerminalOutputPacket[] = []
  const pump = new TerminalOutputPump(channel, "session-a", 3, (packet) => packets.push(packet))
  const character = Buffer.from("\u4e2d", "utf8")
  const input = Buffer.concat([
    character.subarray(0, 1),
    character.subarray(1),
    Buffer.from("\u001b[31mred\u001b[0m"),
    Buffer.alloc(65_536, 0x78)
  ])

  pump.enqueue(input.subarray(0, 2))
  pump.enqueue(input.subarray(2))

  expect(Buffer.concat(packets.map((packet) => Buffer.from(packet.bytes)))).toEqual(input)
  expect(packets.map((packet) => packet.sequence)).toEqual([1, 2])
})

it("pauses at four MiB and resumes only below one MiB", () => {
  const channel = { pause: vi.fn(), resume: vi.fn() }
  const packets: TerminalOutputPacket[] = []
  const pump = new TerminalOutputPump(channel, "session-a", 1, (packet) => packets.push(packet))
  pump.enqueue(Buffer.alloc(4 * 1024 * 1024))
  expect(channel.pause).toHaveBeenCalledOnce()

  pump.acknowledge(0, packets[0].sequence)
  expect(channel.resume).not.toHaveBeenCalled()
  for (const packet of packets.slice(0, -8)) pump.acknowledge(1, packet.sequence)

  expect(channel.resume).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npx vitest run electron/ssh/terminal-output-pump.test.ts`

Expected: FAIL because the output pump module does not exist.

- [ ] **Step 3: Implement ordered packets, credit accounting, and channel flow control**

Implement the pump with a FIFO of byte slices and an in-flight map keyed by
sequence. Count both queued and unacknowledged bytes. Send packets in sequence
order, capped at `64 * 1024` bytes. Pause once at or above `4 * 1024 * 1024`
pending bytes and resume only below `1 * 1024 * 1024`.

```ts
const MAX_PACKET_BYTES = 64 * 1024
const PAUSE_AT_BYTES = 4 * 1024 * 1024
const RESUME_BELOW_BYTES = 1 * 1024 * 1024

export class TerminalOutputPump {
  private readonly queued: Uint8Array[] = []
  private readonly inFlight = new Map<number, Uint8Array>()
  private readonly acknowledged = new Set<number>()
  private nextSequence = 1
  private nextAcknowledgement = 1
  private pendingBytes = 0
  private closed = false
  public isPaused = false

  public constructor(
    private readonly channel: { pause(): void; resume(): void },
    private readonly sessionId: string,
    private readonly channelGeneration: number,
    private readonly send: (packet: TerminalOutputPacket) => void
  ) {}

  public get queuedByteCount(): number { return this.pendingBytes }

  public enqueue(chunk: Uint8Array): void {
    for (let offset = 0; offset < chunk.byteLength; offset += MAX_PACKET_BYTES) {
      const slice = chunk.slice(offset, Math.min(offset + MAX_PACKET_BYTES, chunk.byteLength))
      this.queued.push(slice)
      this.pendingBytes += slice.byteLength
    }
    this.flush()
    this.updateFlowControl()
  }

  public acknowledge(channelGeneration: number, sequence: number): void {
    if (this.closed || channelGeneration !== this.channelGeneration || !this.inFlight.has(sequence)) return
    this.acknowledged.add(sequence)
    while (this.acknowledged.delete(this.nextAcknowledgement)) {
      this.pendingBytes -= this.inFlight.get(this.nextAcknowledgement)!.byteLength
      this.inFlight.delete(this.nextAcknowledgement++)
    }
    this.updateFlowControl()
  }

  public close(): void {
    this.closed = true
    this.queued.length = 0
    this.inFlight.clear()
    this.acknowledged.clear()
    this.pendingBytes = 0
  }

  private flush(): void {
    while (!this.closed && this.queued.length > 0) {
      const bytes = this.queued.shift()!
      const sequence = this.nextSequence++
      this.inFlight.set(sequence, bytes)
      this.send({ sessionId: this.sessionId, channelGeneration: this.channelGeneration, sequence, bytes })
    }
  }

  private updateFlowControl(): void {
    if (!this.isPaused && this.pendingBytes >= PAUSE_AT_BYTES) { this.isPaused = true; this.channel.pause() }
    if (this.isPaused && this.pendingBytes < RESUME_BELOW_BYTES) { this.isPaused = false; this.channel.resume() }
  }
}
```

The implementation must not decode bytes to strings and must not discard data
while the session remains open. Acknowledgements for a different generation,
unknown sequence, duplicate sequence, or closed pump must be ignored.

- [ ] **Step 4: Run the output-pump test and all currently affected tests**

Run: `npx vitest run electron/ssh/terminal-output-pump.test.ts src/features/terminal/session-state.test.ts && npm run typecheck`

Expected: PASS. The test proves a single source chunk can be split without a
byte-order change and that a stale acknowledgement does not resume the channel.

- [ ] **Step 5: Commit the output pump**

```bash
git add electron/ssh/terminal-output-pump.ts electron/ssh/terminal-output-pump.test.ts
git commit -m "feat: add bounded terminal output pump"
```

## Task 3: Add Verified Connection Records and Retry Policy

**Files:**
- Create: `electron/ssh/reconnect-policy.ts`
- Create: `electron/ssh/reconnect-policy.test.ts`
- Create: `electron/ssh/connection-manager.ts`
- Create: `electron/ssh/connection-manager.test.ts`
- Modify: `electron/ssh/host-keys.ts`
- Modify: `electron/ssh/host-key-store.ts`

**Interfaces:**
- Consumes the terminal state and failure types from Task 1.
- Produces `SshConnectionManager`, `ConnectionLease`, `ConnectionEvent`, `ConnectionAcquireRequest`, `ConnectionLeaseController`, and `ConnectionCommandExecutor`.
- Produces `retryDelayMs(attempt, random)` with 1s, 2s, 4s, 8s, 16s, 30s cap and plus-or-minus 20 percent jitter.
- Produces Host Key inspection results `unknown`, `match`, and `changed` before any trust mutation.

- [ ] **Step 1: Write failing retry and connection-manager tests**

Use an injected scheduler, deterministic random source, and fake `ssh2.Client`
factory. Prove that matching security contexts reuse one connection, a new
window creates a separate connection, retry uses one timer, and changed Host
Keys do not retry or auto-trust.

```ts
it("uses capped exponential backoff with bounded jitter", () => {
  expect(retryDelayMs(1, () => 0.5)).toBe(1_000)
  expect(retryDelayMs(5, () => 0.5)).toBe(16_000)
  expect(retryDelayMs(6, () => 0.5)).toBe(30_000)
  expect(retryDelayMs(1, () => 0)).toBe(800)
  expect(retryDelayMs(1, () => 1)).toBe(1_200)
})

it("shares one verified connection only inside the owner window", async () => {
  const { manager, request } = createConnectionHarness({})
  const first = await manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" })
  const second = await manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" })
  const otherWindow = await manager.acquire({ ...request, ownerWebContentsId: 12, kind: "terminal" })

  expect(second.connectionId).toBe(first.connectionId)
  expect(otherWindow.connectionId).not.toBe(first.connectionId)
})

it("does not reuse a connection after its credential context changes", async () => {
  const { manager, request, setSecurityContext } = createConnectionHarness({})
  const first = await manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" })
  setSecurityContext("different-resolved-credential-hash")
  const second = await manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" })

  expect(second.connectionId).not.toBe(first.connectionId)
})

it("marks a changed host key as non-retryable", async () => {
  const { manager, scheduler, events, request } = createConnectionHarness({
    storedFingerprint: "old-fingerprint",
    nextFingerprint: "new-fingerprint"
  })
  await expect(manager.acquire({ ...request, ownerWebContentsId: 11, kind: "terminal" }))
    .rejects.toThrow("Host Key changed")

  expect(events.at(-1)).toMatchObject({ kind: "failed", reason: "host-key-changed" })
  expect(scheduler.pendingTimers()).toHaveLength(0)
})

function createConnectionHarness(options: { storedFingerprint?: string; nextFingerprint?: string }) {
  const scheduled = new Map<number, () => void>()
  let nextTimer = 1
  const scheduler: RetryScheduler & { pendingTimers(): number[] } = {
    schedule: (_delayMs, action) => { const id = nextTimer++; scheduled.set(id, action); return id },
    cancel: (id) => scheduled.delete(id),
    pendingTimers: () => [...scheduled.keys()]
  }
  const events: ConnectionEvent[] = []
  let securityContextKey = "profile-and-credential-hash"
  const createClient = (): Client => {
    const emitter = new EventEmitter()
    const client = {
      connect: (config: ConnectConfig) => {
        if (config.hostVerifier) {
          config.hostVerifier(options.nextFingerprint ?? "fingerprint-a", (accepted) => {
            if (accepted) emitter.emit("ready")
          })
        } else {
          queueMicrotask(() => emitter.emit("ready"))
        }
      },
      end: vi.fn(),
      on: emitter.on.bind(emitter),
      once: emitter.once.bind(emitter)
    }
    return client as unknown as Client
  }
  const manager = new SshConnectionManager({
    createClient,
    scheduler,
    random: () => 0.5,
    resolve: async () => ({
      host: "127.0.0.1", port: 22, username: "rock", authMethod: "agent",
      readyTimeoutMs: 15_000, securityContextKey
    }),
    inspectHostKey: async () => options.storedFingerprint
      ? { status: "changed" as const, storedFingerprint: options.storedFingerprint, receivedFingerprint: options.nextFingerprint ?? "fingerprint-a" }
      : { status: "match" as const, fingerprint: "fingerprint-a" },
    promptForHostKey: async () => false,
    onEvent: (event) => events.push(event)
  })
  return { manager, scheduler, events, request: { hostId: "host-a" }, setSecurityContext: (next: string) => { securityContextKey = next } }
}
```

Import `EventEmitter` from `node:events` and `ConnectConfig` from `ssh2` in
this test file. The fake client feeds the received fingerprint through the
real `hostVerifier` callback, then emits `ready` only if the manager accepted
it. It does not open a PTY, so no shell methods are required.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `npx vitest run electron/ssh/reconnect-policy.test.ts electron/ssh/connection-manager.test.ts`

Expected: FAIL because the retry policy and connection manager do not exist.

- [ ] **Step 3: Implement connection identity, leases, Host Key decisions, and retry**

Define a resolved request that remains main-process-only. It contains the
target host fields plus credentials for the duration of `client.connect`; the
stored connection record retains only a security-context hash and never the
plaintext credential.

```ts
export interface ConnectionAcquireRequest {
  hostId: string
  ownerWebContentsId: number
  kind: "terminal" | "forward"
  forceNewConnection?: boolean
}

export interface ResolvedConnectionRequest {
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  identityFile?: string
  password?: string
  passphrase?: string
  agent?: string
  readyTimeoutMs: number
  securityContextKey: string
}

export interface RetryScheduler {
  schedule(delayMs: number, action: () => void): number
  cancel(id: number): void
}

export interface ConnectionLease {
  id: string
  connectionId: string
  ownerWebContentsId: number
  kind: "terminal" | "forward"
}

export type ConnectionEvent =
  | { kind: "ready"; connectionId: string; ownerWebContentsId: number; transportGeneration: number }
  | { kind: "lost"; connectionId: string; ownerWebContentsId: number; reason: TerminalFailureReason }
  | { kind: "retrying"; connectionId: string; ownerWebContentsId: number; attempt: number; nextRetryAt: string }
  | { kind: "failed"; connectionId: string; ownerWebContentsId: number; reason: TerminalFailureReason }

export interface ConnectionLeaseController {
  retain(connectionId: string, ownerWebContentsId: number, kind: ConnectionLease["kind"]): ConnectionLease
  release(leaseId: string): Promise<void>
  releaseOwner(ownerWebContentsId: number): Promise<void>
}

export interface ConnectionCommandExecutor {
  execOnConnection(connectionId: string, command: string): Promise<string>
  getClientForConnection(connectionId: string): Client
}
```

`SshConnectionManager` resolves the request through an injected
main-process-only resolver, creates a hash from profile and credential context,
verifies the Host Key, and stores `connectionId`, `transportGeneration`, owner
window, lease IDs, and retry state. `acquire()` returns a terminal lease;
`retain()` creates a forward lease only for an existing same-owner connection;
`release()` closes the physical transport only when its last lease disappears.
It emits connection events with an owner window ID, not a broadcast target.

Refactor `host-keys.ts` so inspection returns an explicit status. For an
unknown key, prompt and then call `trust`. For a changed key, show a native
replacement confirmation through the manager's injected owner-window prompt;
only an affirmative replacement updates `JsonHostKeyStore`.

Use `retryDelayMs` and an injected scheduler for one retry task per logical
connection. `retryDelayMs(1, () => 0.5)` is `1000`, attempt `2` is `2000`,
and attempts `6+` are `30000`; `(random() * 0.4) - 0.2` is multiplied into
the delay before scheduling. On a successful retry keep `connectionId`,
increment `transportGeneration`, and emit `ready`. On retry exhaustion emit
`failed`. Authentication, configuration, Host Key, and cancellation failures
emit `failed` directly and schedule no retry.

- [ ] **Step 4: Run connection tests and verify Host Key behavior**

Run: `npx vitest run electron/ssh/reconnect-policy.test.ts electron/ssh/connection-manager.test.ts && npm run typecheck`

Expected: PASS. Tests show only one retry timer for shared consumers, no
cross-window reuse, no reuse after a changed credential context, a prompted
unknown Host Key is trusted only after approval, and no retry path for
authentication or Host Key failures.

- [ ] **Step 5: Commit the connection layer**

```bash
git add electron/ssh/reconnect-policy.ts electron/ssh/reconnect-policy.test.ts electron/ssh/connection-manager.ts electron/ssh/connection-manager.test.ts electron/ssh/host-keys.ts electron/ssh/host-key-store.ts
git commit -m "feat: add verified SSH connection manager"
```

## Task 4: Replace the Legacy SSH Session Manager

**Files:**
- Create: `electron/ssh/terminal-session-manager.ts`
- Create: `electron/ssh/terminal-session-manager.test.ts`
- Modify: `electron/ports/port-service.ts`
- Modify: `electron/monitoring/linux-metrics.ts`
- Modify: `src/app/types.ts`
- Delete: `electron/ssh/ssh-manager.ts`

**Interfaces:**
- Consumes `SshConnectionManager`, `TerminalOutputPump`, and all types from Tasks 1-3.
- Produces `TerminalSessionManager` with `open`, `write`, `resize`, `ackOutput`, `reconnect`, `cancelReconnect`, `close`, `releaseOwner`, `retryAfterResume`, `exec`, and `execOnConnection`.
- Produces `SessionCommandExecutor` for monitoring and `ConnectionCommandExecutor` for port discovery.

- [ ] **Step 1: Write failing logical-session lifecycle tests**

Test PTY creation, output packet generation, stale generation rejection,
normal channel exit, shared-transport reconnect, explicit close, and restore
queue ordering. For the queue test, open one `restorePriority: "background"`
session and one `restorePriority: "active"` session while the fake connection
is unavailable, mark it ready, then assert the shell factory starts the active
session first and does not start the second until the first shell callback
settles.

Put a `createSessionHarness()` factory in this test file. It returns
`{ sessions, transport, retryScheduler, events, channels }`, where `channels`
is a `Map<number, FakeChannel>` keyed by the PTY channel generation. The fake
channel exposes `write`, `setWindow`, `pause`, `resume`, `end`, and an
`emitClose()` method; the fake transport exposes `dropUnexpectedly()`.

```ts
it("opens a fresh PTY generation for every recovered logical session", async () => {
  const { sessions, transport, retryScheduler, events } = createSessionHarness()
  const idA = "11111111-1111-4111-8111-111111111111"
  await sessions.open({ sessionId: idA, hostId: "host-a", cols: 120, rows: 40, ownerWebContentsId: 7 })
  transport.dropUnexpectedly()
  await retryScheduler.runNext()

  expect(events.filter((event) => event.kind === "state" && event.state === "connected")).toHaveLength(2)
  expect(events.at(-1)).toMatchObject({ kind: "state", sessionId: idA, channelGeneration: 2, notice: "reconnected" })
})

it("rejects input, resize, and acknowledgement from a prior channel generation", async () => {
  const { sessions, channels } = createSessionHarness()
  const idA = "11111111-1111-4111-8111-111111111111"
  await sessions.open({ sessionId: idA, hostId: "host-a", cols: 120, rows: 40, ownerWebContentsId: 7 })
  sessions.write(idA, 0, "stale")
  sessions.resize(idA, 0, { cols: 80, rows: 24 })
  sessions.ackOutput(idA, 0, 1)

  expect(channels.get(1)!.write).not.toHaveBeenCalled()
  expect(channels.get(1)!.setWindow).not.toHaveBeenCalled()
  expect(channels.get(1)!.pause).not.toHaveBeenCalled()
})

it("does not retry after a normal shell-channel close", async () => {
  const { sessions, channels, events, retryScheduler } = createSessionHarness()
  const idA = "11111111-1111-4111-8111-111111111111"
  await sessions.open({ sessionId: idA, hostId: "host-a", cols: 120, rows: 40, ownerWebContentsId: 7 })
  channels.get(1)!.emitClose()

  expect(events.at(-1)).toMatchObject({ kind: "state", state: "disconnected", reason: "channel-ended" })
  expect(retryScheduler.pendingTimers()).toHaveLength(0)
})
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npx vitest run electron/ssh/terminal-session-manager.test.ts`

Expected: FAIL because `TerminalSessionManager` does not exist and the old
manager has no generation-aware APIs.

- [ ] **Step 3: Implement logical PTY sessions over connection leases**

Use a stable `sessionId` supplied by the renderer. `open` acquires a terminal
lease, opens a shell only after the connection is ready, creates a new output
pump for the next channel generation, and emits a state event to the owner.

```ts
export interface TerminalOpenRequest {
  sessionId: string
  hostId: string
  cols: number
  rows: number
  ownerWebContentsId: number
  forceNewConnection?: boolean
  restorePriority?: "active" | "background"
}

export class TerminalSessionManager implements SessionCommandExecutor, ConnectionCommandExecutor {
  public async open(request: TerminalOpenRequest): Promise<TerminalSessionInfo>
  public write(sessionId: string, channelGeneration: number, data: string): void
  public resize(sessionId: string, channelGeneration: number, dimensions: TerminalDimensions): void
  public ackOutput(sessionId: string, channelGeneration: number, sequence: number): void
  public async reconnect(sessionId: string): Promise<void>
  public cancelReconnect(sessionId: string): void
  public async close(sessionId: string): Promise<void>
  public async releaseOwner(ownerWebContentsId: number): Promise<void>
  public retryAfterResume(): void
  public exec(sessionId: string, command: string): Promise<string>
  public execOnConnection(connectionId: string, command: string): Promise<string>
}

export interface SessionCommandExecutor {
  exec(sessionId: string, command: string): Promise<string>
}
```

On an unexpected connection event, mark each recoverable logical session
`reconnecting`, retain its metadata and terminal lease, and reopen a shell
after the connection is ready. On a normal channel close, emit
`disconnected` without scheduling recovery. On explicit close, release the
terminal lease and remove the manager record. Implement a global restore queue
inside this manager with a concurrency limit of one and active-session priority.
`cancelReconnect(sessionId)` releases only that session's recovery desire; it
must not cancel another session's or a forward's shared retry. When that was
the last recoverable consumer, release the connection lease and cancel its
single retry timer.

Replace direct imports of `SshManager` in port discovery and monitoring with
the narrow executor interfaces from `electron/ssh/types.ts`. Re-export the
new session event types through `src/app/types.ts`.

- [ ] **Step 4: Run focused session, monitoring, and port parser tests**

Run: `npx vitest run electron/ssh/terminal-session-manager.test.ts tests/ssh-config.test.ts src/features/monitoring/monitor-state.test.ts src/features/ports/port-state.test.ts && npm run typecheck`

Expected: PASS. A normal channel close remains manually reconnectable, an
unexpected shared transport loss reopens every eligible session once, restore
opens the active session before background sessions, and canceling one session
does not interrupt another consumer.

- [ ] **Step 5: Commit the terminal-session manager migration**

```bash
git add electron/ssh/terminal-session-manager.ts electron/ssh/terminal-session-manager.test.ts electron/ports/port-service.ts electron/monitoring/linux-metrics.ts src/app/types.ts
git rm electron/ssh/ssh-manager.ts
git commit -m "refactor: manage logical terminal sessions separately"
```

## Task 5: Make Port Forwards Connection Consumers

**Files:**
- Create: `electron/ports/forwarding-manager.test.ts`
- Modify: `electron/ports/types.ts`
- Modify: `electron/ports/forwarding-manager.ts`
- Modify: `electron/ports/port-service.ts`
- Modify: `src/features/ports/port-state.ts`

**Interfaces:**
- Consumes `ConnectionLeaseController`, `ConnectionEvent`, and `ConnectionCommandExecutor` from Tasks 3-4.
- Produces `ForwardingManager.resume(forwardingId)`, `releaseOwner(ownerWebContentsId)`, and `suspended` forwarding state.
- Produces connection-scoped `ForwardingInfo` without a session ownership field.

- [ ] **Step 1: Write failing forwarding lifecycle tests**

Use a fake connection accessor and injected local-listener factory to prove
that forwarding keeps a connection alive, handles transport loss, and follows
the bind-address recovery rule.

```ts
it("keeps a loopback forward suspended through transport loss and restores it on ready", async () => {
  const forward = await forwards.start(connectionId, loopbackSpec, ownerWebContentsId)
  connectionEvents.emit({ kind: "lost", connectionId })
  expect(forwards.get(forward.id)).toMatchObject({ status: "suspended" })

  connectionEvents.emit({ kind: "ready", connectionId, transportGeneration: 2 })
  expect(forwards.get(forward.id)).toMatchObject({ status: "forwarding" })
})

it("requires Resume for a non-loopback forward after recovery", async () => {
  const forward = await forwards.start(connectionId, { ...loopbackSpec, localAddress: "0.0.0.0" }, ownerWebContentsId)
  connectionEvents.emit({ kind: "lost", connectionId })
  connectionEvents.emit({ kind: "ready", connectionId, transportGeneration: 2 })

  expect(forwards.get(forward.id)?.status).toBe("suspended")
})
```

- [ ] **Step 2: Run the forwarding test and confirm it fails**

Run: `npx vitest run electron/ports/forwarding-manager.test.ts`

Expected: FAIL because `suspended`, `resume`, and forward leases do not exist.

- [ ] **Step 3: Implement forward leases, suspension, and resume**

Extend `PortStatus` with `suspended`. Change `ForwardingManager.start` to
call `ConnectionLeaseController.retain(connectionId, ownerWebContentsId,
"forward")` before listening and release that lease when start fails or when a
forward stops. Store `ownerWebContentsId` and the lease ID internally but do
not expose either through renderer-facing forwarding data. Remove the legacy
optional `sessionId` field from `ForwardingInfo`; `connectionId` remains the
only owner-validated runtime reference.

```ts
public async start(connectionId: string, spec: ForwardingSpec, ownerWebContentsId: number): Promise<ForwardingInfo>
public async resume(forwardingId: string): Promise<ForwardingInfo>
public async stop(forwardingId: string): Promise<void>
public async releaseOwner(ownerWebContentsId: number): Promise<void>
```

Subscribe once to connection events. On `lost`, close the listener and set
each matching forward to `suspended` while retaining its lease. On `ready`,
restart only `127.0.0.1` and `::1` rules. A `0.0.0.0` rule stays suspended
until `resume`. If listener creation fails with `EADDRINUSE`, set `error` to
`LOCAL_PORT_IN_USE` and retain no listener. Update `PortService` to accept the
connection command interface introduced in Task 4.

- [ ] **Step 4: Run forwarding and existing Ports state tests**

Run: `npx vitest run electron/ports/forwarding-manager.test.ts src/features/ports/port-state.test.ts && npm run typecheck`

Expected: PASS. Closing a terminal lease cannot stop an active forward; an
owner release stops its forwards and releases their leases.

- [ ] **Step 5: Commit the forwarding lifecycle**

```bash
git add electron/ports/types.ts electron/ports/forwarding-manager.ts electron/ports/forwarding-manager.test.ts electron/ports/port-service.ts src/features/ports/port-state.ts
git commit -m "feat: recover connection-scoped port forwards"
```

## Task 6: Persist Safe Workspace Snapshots

**Files:**
- Create: `electron/storage/workspace-store.ts`
- Create: `electron/storage/workspace-store.test.ts`
- Modify: `electron/storage/types.ts`

**Interfaces:**
- Consumes the Task 1 layout shape and terminal dimensions as serializable data, without importing a renderer module into Electron storage.
- Produces `WorkspaceSnapshotStore.load()`, `saveWindow(snapshot)`, `removeWindow(workspaceId)`, and `flush()`.
- Produces `StoredWorkspaceDocument`, `StoredWorkspaceWindow`, and `StoredWorkspaceSession`.

- [ ] **Step 1: Write failing snapshot-store tests**

Test normalization, debounced atomic writes, removal, and explicitly absent
sensitive/runtime fields.

```ts
it("persists only validated workspace metadata", async () => {
  await store.saveWindow({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    maximized: false,
    sessions: [{ sessionId, hostId: "host-a", label: "G11", cols: 120, rows: 40, output: "must not persist" }],
    layout: { kind: "leaf", sessionId }
  } as unknown as StoredWorkspaceWindow)
  await store.flush()

  expect(await store.load()).toEqual(expect.objectContaining({
    version: 1,
    windows: [expect.objectContaining({ sessions: [expect.not.objectContaining({ output: expect.anything() })] })]
  }))
})

it("drops invalid layout leaves instead of blocking startup", async () => {
  await writeFile(filePath, JSON.stringify({
    version: 1,
    windows: [{
      workspaceId: "11111111-1111-4111-8111-111111111111",
      maximized: false,
      sessions: [{ sessionId, hostId: "host-a", label: "G11", cols: 120, rows: 40 }],
      layout: { kind: "leaf", sessionId: "missing-session" }
    }]
  }), "utf8")
  expect((await store.load()).windows).toEqual([])
})

it("keeps valid windows when another persisted entry is malformed", async () => {
  const validWindow: StoredWorkspaceWindow = {
    workspaceId: "11111111-1111-4111-8111-111111111111", maximized: false,
    sessions: [{ sessionId, hostId: "host-a", label: "G11", cols: 120, rows: 40 }],
    layout: { kind: "leaf", sessionId }
  }
  await writeFile(filePath, JSON.stringify({
    version: 1,
    windows: [validWindow, { workspaceId: "not-a-uuid", maximized: false, sessions: [] }]
  }), "utf8")

  expect((await store.load()).windows).toEqual([validWindow])
})
```

Import `writeFile` from `node:fs/promises` in this test. Use a temporary file
path created by the test setup and delete only that temporary directory in its
`afterEach` hook.

- [ ] **Step 2: Run the snapshot tests and confirm they fail**

Run: `npx vitest run electron/storage/workspace-store.test.ts`

Expected: FAIL because the workspace store and persisted types do not exist.

- [ ] **Step 3: Implement versioned snapshot validation and debounced writes**

Add the exact persisted shapes to `electron/storage/types.ts`. Keep
`StoredTerminalLayout` structurally equivalent to the renderer layout type so
the main process does not import from `src/`.

```ts
export type StoredTerminalLayout =
  | { kind: "leaf"; sessionId: string }
  | { kind: "split"; direction: "horizontal"; ratio: number; first: StoredTerminalLayout; second: StoredTerminalLayout }

export interface StoredWorkspaceSession {
  sessionId: string
  hostId: string
  label: string
  cols: number
  rows: number
}

export interface StoredWorkspaceWindow {
  workspaceId: string
  bounds?: { x: number; y: number; width: number; height: number }
  maximized: boolean
  activeSessionId?: string
  sessions: StoredWorkspaceSession[]
  layout?: StoredTerminalLayout
}

export interface StoredWorkspaceDocument {
  version: 1
  windows: StoredWorkspaceWindow[]
}
```

`workspaceId` and `sessionId` must be UUIDs, labels must be bounded strings,
dimensions must be valid terminal dimensions, and layout leaves must refer to
retained session IDs. Clamp split ratios to `0.2..0.8`. Strip every unknown
property before writing.

```ts
export class WorkspaceSnapshotStore {
  public async load(): Promise<StoredWorkspaceDocument>
  public saveWindow(window: StoredWorkspaceWindow): void
  public removeWindow(workspaceId: string): void
  public async flush(): Promise<void>
}
```

Use the existing `JsonStore` for atomic file replacement. The store keeps the
last normalized document in memory, schedules one short write timer after
mutations, and flushes the same normalized data on request. Invalid or
unreadable input returns `{ version: 1, windows: [] }`.

- [ ] **Step 4: Run snapshot tests and typecheck**

Run: `npx vitest run electron/storage/workspace-store.test.ts && npm run typecheck`

Expected: PASS. The serialized file has no output, credentials, connection ID,
channel generation, or forwarding listener fields; valid windows survive
alongside malformed entries; and `flush()` writes a scheduled update before
shutdown.

- [ ] **Step 5: Commit snapshot persistence**

```bash
git add electron/storage/types.ts electron/storage/workspace-store.ts electron/storage/workspace-store.test.ts
git commit -m "feat: persist terminal workspace metadata"
```

## Task 7: Wire Main Process, Windows, Settings, and Typed IPC

**Files:**
- Create: `electron/windows/workspace-window-manager.ts`
- Create: `electron/windows/workspace-window-manager.test.ts`
- Create: `electron/ipc/register.test.ts`
- Create: `electron/storage/settings-store.test.ts`
- Modify: `electron/main.ts`
- Modify: `electron/ipc/validation.ts`
- Modify: `electron/ipc/bridge-contract.ts`
- Modify: `electron/ipc/register.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/storage/types.ts`
- Modify: `electron/storage/settings-store.ts`
- Modify: `src/app/bridge.ts`

**Interfaces:**
- Consumes the managers and storage APIs from Tasks 3-6.
- Produces owner-scoped bridge APIs under `sessions`, `ports`, and `workspace`.
- Produces `WorkspaceWindowManager.createNew()`, `restoreWindows()`, `workspaceForWebContents(id)`, `removeWorkspaceForWindow(id)`, and shutdown markers.
- Produces settings `autoReconnect`, `reconnectMode`, `restorePreviousWorkspace`, and `confirmMultilinePaste`.

- [ ] **Step 1: Write failing IPC, window-owner, and settings tests**

Test that a session event is sent only to its owner web contents, that a
deliberate window close removes a workspace while app quit preserves it, and
that settings migration removes `portScanInterval`.

```ts
it("routes output only to the session owner", () => {
  sessions.emit({ ownerWebContentsId: 21, event: { kind: "output", packet } })

  expect(owner21.webContents.send).toHaveBeenCalledWith(ipcChannels.sessionEvent, expect.objectContaining({ kind: "output" }))
  expect(owner22.webContents.send).not.toHaveBeenCalled()
})

it("rejects a renderer request for a session owned by another window", async () => {
  sessions.ownerForSession.mockReturnValue(21)

  await expect(invokeFrom(owner22, ipcChannels.sessionClose, sessionId))
    .rejects.toThrow("Session is owned by another window")
})

it("uses the connection owner for an unknown Host Key prompt", async () => {
  connections.acquire.mockImplementationOnce(async (request) => {
    await promptForHostKey(request.ownerWebContentsId, { host: "host-a", port: 22, fingerprint: "sha256:abc" })
    throw new Error("Host Key rejected")
  })
  await expect(invokeFrom(owner21, ipcChannels.sessionOpen, validSessionOpenRequest)).rejects.toThrow("Host Key rejected")

  expect(promptForHostKey).toHaveBeenCalledWith(21, expect.objectContaining({ host: "host-a" }))
  expect(promptForHostKey).not.toHaveBeenCalledWith(22, expect.anything())
})

it("drops the obsolete scan interval during settings normalization", async () => {
  await writeFile(settingsPath, JSON.stringify({ ...defaultSettings, portScanInterval: 15 }), "utf8")

  expect(await new SettingsStore(settingsPath).get()).not.toHaveProperty("portScanInterval")
})

it("keeps snapshots during app quit but removes a manually closed window", async () => {
  windows.beginQuit()
  await windows.handleClosed(ownerId)
  expect(store.removeWindow).not.toHaveBeenCalled()

  windows.endQuitForTest()
  await windows.handleClosed(ownerId)
  expect(store.removeWindow).toHaveBeenCalledWith(workspaceId)
})
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `npx vitest run electron/windows/workspace-window-manager.test.ts electron/ipc/register.test.ts`

Expected: FAIL because owner-aware windows and the new IPC channels do not
exist.

- [ ] **Step 3: Implement owner-bound windows and generation-aware IPC**

Refactor `registerIpcHandlers` to register once without closing over the first
window. Resolve the owner from `event.sender.id` for every request. Use a
`WorkspaceWindowManager` map from web contents ID to persistent workspace ID.

Add these bridge operations and validate every identifier, owner, generation,
dimension, and input payload in the main process:

```ts
sessions.open({ sessionId, hostId, cols, rows, forceNewConnection?, restorePriority? })
sessions.write(sessionId, channelGeneration, data)
sessions.resize(sessionId, channelGeneration, cols, rows)
sessions.ackOutput(sessionId, channelGeneration, sequence)
sessions.reconnect(sessionId)
sessions.cancelReconnect(sessionId)
sessions.close(sessionId)
ports.scan(connectionId)
ports.start(connectionId, spec)
ports.resume(forwardingId)
workspace.load()
workspace.save(snapshot)
```

Expose those operations with the following ownership-preserving bridge shape.
The renderer never supplies `ownerWebContentsId` or a workspace ID; the main
process derives both from `event.sender.id`.

```ts
workspace.load(): Promise<StoredWorkspaceWindow | undefined>
workspace.save(snapshot: Omit<StoredWorkspaceWindow, "workspaceId">): Promise<void>
ports.scan(connectionId: string): Promise<DiscoveredPort[]>
ports.start(connectionId: string, spec: ForwardingSpec): Promise<ForwardingInfo>
```

Route terminal session events with the event's `ownerWebContentsId`, never
through a loop over all BrowserWindows. Resolve native Host Key dialogs from
the connection owner rather than the initial window. Register
`powerMonitor.on("resume")` to call `TerminalSessionManager.retryAfterResume()`.
Validate that every `sessionId` belongs to `event.sender.id` before write,
resize, acknowledgement, reconnect, cancellation, or close. Validate that a
`connectionId` used by Ports has the same owner. Strip the owner wrapper before
sending `TerminalSessionEvent` through the preload bridge. Delete the current
IPC-side `hasSessionsForConnection` / `stopForConnection` coupling: forwarding
leases, not a terminal close event, decide when a shared transport may end.

On application startup, load settings and snapshots. If restore is enabled,
create one BrowserWindow for each saved workspace; otherwise create one empty
window. On a manual window close, stop its forwards, release its terminal
owner, and remove its workspace snapshot. During app quit, mark shutdown,
flush the snapshot store, then release owners without removing snapshots.
For `workspace.save`, derive the workspace ID, current `BrowserWindow` bounds,
and maximized state in the main process; discard any renderer-supplied bounds
or workspace ID. `WorkspaceWindowManager.restoreWindows()` passes only the
validated saved bounds and maximized flag into BrowserWindow creation.

Migrate settings exactly as follows:

```ts
export interface AppSettings {
  locale: "en" | "zh-CN"
  sidebarWidth: number
  terminalFont: string
  terminalFontSize: number
  connectionTimeout: number
  autoReconnect: boolean
  reconnectMode: "limited" | "continuous"
  restorePreviousWorkspace: boolean
  confirmMultilinePaste: boolean
  bindAddress: "127.0.0.1" | "::1" | "0.0.0.0"
}
```

Set defaults to `true`, `"limited"`, `true`, and `true` for the four new or
formalized policies. Ignore legacy `portScanInterval` when reading settings and
do not write it again. Update the browser-preview bridge so renderer tests
receive the complete contract without Electron. Have the main-process request
resolver read `connectionTimeout` and pass `connectionTimeout * 1000` as
`ResolvedConnectionRequest.readyTimeoutMs` for each physical SSH connection.

- [ ] **Step 4: Run owner, IPC, settings, and type tests**

Run: `npx vitest run electron/windows/workspace-window-manager.test.ts electron/ipc/register.test.ts electron/storage/settings-store.test.ts electron/storage/workspace-store.test.ts && npm run typecheck`

Expected: PASS. A packet cannot cross BrowserWindow ownership, a resume signal
calls the session manager once, a Host Key prompt cannot cross BrowserWindow
ownership, and legacy scan interval data is omitted from normalized settings.

- [ ] **Step 5: Commit main-process and IPC wiring**

```bash
git add electron/windows/workspace-window-manager.ts electron/windows/workspace-window-manager.test.ts electron/ipc/validation.ts electron/ipc/bridge-contract.ts electron/ipc/register.ts electron/ipc/register.test.ts electron/preload.ts electron/main.ts electron/storage/types.ts electron/storage/settings-store.ts electron/storage/settings-store.test.ts src/app/bridge.ts
git commit -m "feat: wire terminal engine through owner-scoped IPC"
```

## Task 8: Build the Renderer Terminal Controller

**Files:**
- Create: `src/features/terminal/terminal-controller.ts`
- Create: `src/features/terminal/terminal-controller.test.ts`
- Create: `src/features/terminal/TerminalView.test.tsx`
- Modify: `src/features/terminal/TerminalView.tsx`
- Modify: `src/features/terminal/TerminalWorkspace.tsx`
- Modify: `src/features/terminal/TerminalWorkspace.test.tsx`

**Interfaces:**
- Consumes `TerminalOutputPacket`, `TerminalDimensions`, and session state from Tasks 1 and 7.
- Produces `TerminalController.attach`, `acceptOutput`, `setChannelGeneration`, `setConnected`, `applyPreferences`, `fit`, `focus`, and `dispose`.
- Produces controller callbacks `onInput(data)`, `onResize(dimensions)`, and `onAck(channelGeneration, sequence)` for App wiring.
- Adds `onController(sessionId, controller | undefined)` from `TerminalView` through `TerminalWorkspace`, so `App` can route byte events without storing controllers in React state.

- [ ] **Step 1: Write failing controller and workspace tests**

Use a fake xterm writer that completes writes manually. Define it in the test
file as `{ writes: Uint8Array[]; write(data, done); completeNextWrite();
focus(); dispose() }`. Prove that the controller writes byte packets in
sequence, acknowledges only after the write callback, ignores stale
generations and duplicate sequences, renders local notices only locally, and
keeps hidden session controllers mounted.

```ts
it("acknowledges a packet only after xterm accepts it", () => {
  controller.acceptOutput({ sessionId, channelGeneration: 2, sequence: 1, bytes: Uint8Array.of(0xe4) })

  expect(ack).not.toHaveBeenCalled()
  terminal.completeNextWrite()
  expect(ack).toHaveBeenCalledWith(2, 1)
})

it("never writes a stale or duplicate packet", () => {
  controller.setChannelGeneration(2)
  controller.acceptOutput({ sessionId, channelGeneration: 1, sequence: 99, bytes: Uint8Array.of(0x61) })
  controller.acceptOutput({ sessionId, channelGeneration: 2, sequence: 1, bytes: Uint8Array.of(0x62) })
  terminal.completeNextWrite()
  controller.acceptOutput({ sessionId, channelGeneration: 2, sequence: 1, bytes: Uint8Array.of(0x63) })

  expect(terminal.writes.map((bytes) => Buffer.from(bytes).toString("utf8"))).toEqual(["b"])
})

it("sends a resize only for a changed valid fitted grid", () => {
  fit.dimensions.mockReturnValueOnce(undefined).mockReturnValueOnce({ cols: 120, rows: 40 }).mockReturnValue({ cols: 120, rows: 40 })

  controller.fit()
  controller.fit()
  controller.fit()

  expect(resize).toHaveBeenCalledTimes(1)
  expect(resize).toHaveBeenCalledWith({ cols: 120, rows: 40 })
})

it("renders every session surface but hides non-visible layout leaves", () => {
  render(<TerminalWorkspace {...props} />)
  expect(screen.getAllByTestId("terminal-surface")).toHaveLength(3)
  expect(screen.getByTestId("terminal-surface-b")).toHaveAttribute("data-visible", "false")
})

it("confirms a multi-line paste and lets unselected Ctrl+C reach the shell", () => {
  const onInput = vi.fn()
  const session: WorkspaceSession = {
    id: "11111111-1111-4111-8111-111111111111", hostId: "host-a", label: "G11",
    state: "connected", channelGeneration: 1, dimensions: { cols: 120, rows: 40 }
  }
  vi.spyOn(window, "confirm").mockReturnValue(true)
  render(<TerminalView session={session} onInput={onInput} onResize={vi.fn()} confirmMultilinePaste />)
  fireEvent.paste(screen.getByTestId("terminal-surface"), { clipboardData: { getData: () => "a\nb" } })
  fireEvent.keyDown(screen.getByTestId("terminal-surface"), { key: "c", ctrlKey: true })

  expect(window.confirm).toHaveBeenCalledOnce()
  expect(onInput).toHaveBeenCalledWith("\u0003")
})
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `npx vitest run src/features/terminal/terminal-controller.test.ts src/features/terminal/TerminalView.test.tsx src/features/terminal/TerminalWorkspace.test.tsx`

Expected: FAIL because no controller class exists and the workspace only mounts
the active split surfaces.

- [ ] **Step 3: Implement xterm ownership, byte FIFO, and fit lifecycle**

Make `TerminalController` depend on a narrow xterm adapter in tests and build
the actual `Terminal` plus `FitAddon` in `TerminalView`. It serializes writes:
the next packet is written only after the previous callback. It stores the
current channel generation, ignores old packets, and calls the bridge
acknowledgement callback after a successful xterm write callback.

```ts
export interface TerminalWriteAdapter {
  write(bytes: Uint8Array, done: () => void): void
  focus(): void
  dispose(): void
  setDisableStdin(disabled: boolean): void
  setFont(fontFamily: string, fontSize: number): void
}

export interface TerminalFitAdapter {
  fit(): void
  dimensions(): TerminalDimensions | undefined
}

export class TerminalController {
  public constructor(
    private readonly terminal: TerminalWriteAdapter,
    private readonly fitAddon: TerminalFitAdapter,
    private readonly callbacks: {
      onInput(data: string): void
      onResize(dimensions: TerminalDimensions): void
      onAck(channelGeneration: number, sequence: number): void
    }
  ) {}

  public attach(): void
  public setChannelGeneration(generation: number): void
  public acceptOutput(packet: TerminalOutputPacket): void
  public writeLocalNotice(kind: "reconnected" | "restored-new-shell"): void
  public setConnected(connected: boolean): void
  public applyPreferences(fontFamily: string, fontSize: number): void
  public fit(): TerminalDimensions | undefined
  public focus(): void
  public dispose(): void
}
```

Update `TerminalView` so it creates one controller per stable session ID,
opens xterm with `scrollback: 10_000` before requesting a session, emits the
first valid fitted size, uses a `ResizeObserver` plus animation-frame
coalescing, and calls resize only when columns or rows changed. Use
`terminal.options.disableStdin` while the session is not connected. Apply live
font changes without disposing xterm, then schedule `fit()` so the changed grid
uses the normal generation-aware resize callback. On `notice` state events,
call `writeLocalNotice`; never send that text through `sessions.write`.

Update `TerminalWorkspace` to render all session surfaces, map visibility from
the layout tree, and call `fit` when a surface becomes visible. Do not pass an
output string through props. Forward `onController(sessionId, controller)` on
mount and `onController(sessionId, undefined)` on disposal; `App` stores those
objects only in its `useRef(Map)`.

- [ ] **Step 4: Run renderer controller tests and typecheck**

Run: `npx vitest run src/features/terminal/terminal-controller.test.ts src/features/terminal/TerminalView.test.tsx src/features/terminal/TerminalWorkspace.test.tsx src/features/terminal/session-state.test.ts && npm run typecheck`

Expected: PASS. Packets are direct byte writes, stale packets cannot change a
new shell, hidden sessions retain their controllers, font and visibility fits
emit only changed grids, and no component reads `session.output`.

- [ ] **Step 5: Commit the renderer terminal engine**

```bash
git add src/features/terminal/terminal-controller.ts src/features/terminal/terminal-controller.test.ts src/features/terminal/TerminalView.tsx src/features/terminal/TerminalView.test.tsx src/features/terminal/TerminalWorkspace.tsx src/features/terminal/TerminalWorkspace.test.tsx
git commit -m "feat: render terminal output through xterm controllers"
```

## Task 9: Integrate Workspace Restore and Terminal UI Controls

**Files:**
- Create: `src/features/terminal/TerminalConnectionOverlay.tsx`
- Create: `src/features/terminal/TerminalConnectionOverlay.test.tsx`
- Create: `src/features/settings/SettingsView.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Sidebar.test.tsx`
- Modify: `src/features/ports/PortsView.tsx`
- Modify: `src/features/ports/PortsView.test.tsx`
- Modify: `src/features/settings/SettingsView.tsx`
- Modify: `src/features/monitoring/MonitorSummary.tsx`
- Modify: `src/styles/components.css`
- Modify: `src/styles/layout.css`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh-CN.ts`

**Interfaces:**
- Consumes the bridge operations from Task 7 and `TerminalController` callbacks from Task 8.
- Produces renderer-side session event routing that sends output only to controller instances.
- Produces restore serialization through `workspace.save`, reconnect/cancel controls, loopback forwarding resume, and v0.3 settings controls.

- [ ] **Step 1: Write failing App, overlay, settings, and Ports view tests**

Cover restoration, direct packet routing, disabled input state, compact retry
controls, settings migration UI, keyboard handling, missing-host restoration,
and a suspended forward resume action. In `App.test.tsx`, install a complete
`window.rocker` fake before rendering. Its `events.onSessionEvent` stores a
listener in `sessionListener`; mock `TerminalWorkspace` so it immediately
calls its `onController` prop with a `controller` spy and exposes its received
workspace state through `latestWorkspace`.

```tsx
it("routes output packets to a controller without putting bytes in workspace state", () => {
  render(<App />)
  sessionListener!({ kind: "output", packet })

  expect(controller.acceptOutput).toHaveBeenCalledWith(packet)
  expect(latestWorkspace().sessions[0]).not.toHaveProperty("output")
})

it("keeps a missing restored host closable without opening a network session", async () => {
  bridge.workspace.load.mockResolvedValue({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    maximized: false,
    sessions: [{ sessionId: "22222222-2222-4222-8222-222222222222", hostId: "missing", label: "Old host", cols: 120, rows: 40 }]
  })
  bridge.hosts.list.mockResolvedValue([])
  render(<App />)

  expect(await screen.findByText("Old host")).toBeInTheDocument()
  expect(bridge.sessions.open).not.toHaveBeenCalled()
})

it("shows Cancel and Reconnect now while a session reconnects", () => {
  render(<TerminalConnectionOverlay session={reconnectingSession} onCancel={cancel} onReconnectNow={retry} />)
  expect(screen.getByRole("button", { name: "Cancel reconnect" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Reconnect now" })).toBeInTheDocument()
})

it("shows Resume only for a suspended forward", async () => {
  render(<I18nProvider><PortsView bridge={bridge} session={session} /></I18nProvider>)
  await screen.findByRole("button", { name: "Resume forwarding" })
  fireEvent.click(screen.getByRole("button", { name: "Resume forwarding" }))
  expect(bridge.ports.resume).toHaveBeenCalledWith("forward-1")
})

```

- [ ] **Step 2: Run the UI tests and confirm they fail**

Run: `npx vitest run src/app/App.test.tsx src/features/terminal/TerminalConnectionOverlay.test.tsx src/features/settings/SettingsView.test.tsx src/features/ports/PortsView.test.tsx src/components/Sidebar.test.tsx`

Expected: FAIL because the App still appends output to state, the overlay does
not exist, and the Ports/settings bridge APIs are absent from the renderer.

- [ ] **Step 3: Integrate session controllers, restoration, state UI, and settings**

Refactor `App.tsx` around a controller map stored in `useRef`. Register each
controller when `TerminalView` mounts. Route `{ kind: "output" }` events to
`controller.acceptOutput(packet)` and route only `{ kind: "state" }` events
through the workspace reducer.

```ts
const controllers = useRef(new Map<string, TerminalController>())

const handleSessionEvent = (event: TerminalSessionEvent): void => {
  if (event.kind === "output") {
    controllers.current.get(event.packet.sessionId)?.acceptOutput(event.packet)
    return
  }
  setWorkspace((current) => applyTerminalState(current, event))
}
```

Keep the runtime-only connection lookup outside the workspace reducer as well.
It is needed for the explicitly named Ports APIs but must not be persisted:

```ts
const connectionIds = useRef(new Map<string, string>())

if (event.kind === "state" && event.connectionId) {
  connectionIds.current.set(event.sessionId, event.connectionId)
}
```

Pass `connectionIds.current.get(activeSessionId)` to `PortsView` only while the
associated session is connected or reconnecting. Remove it when a session is
explicitly closed; never include it in `workspace.save`.

Load `workspace.load()` after settings and hosts. Build restored session state
and layout before opening any network connection. When each restored
controller reports its first valid dimensions, call `sessions.open` with its
stable session UUID and `restorePriority` of `active` or `background`. Do not
use a guessed grid. Debounce `workspace.save` after session, label, active
selection, layout, or dimension changes; the payload is the normalized
snapshot shape from Task 6. A snapshot whose `hostId` is absent from the host
list enters `error` with reason `configuration`, shows the localized host-not-
found copy, and never calls `sessions.open`. `App` sends the saved order and
the active ID so `TerminalSessionManager` can drain its one-at-a-time restore
queue with `active` first.

Render `TerminalConnectionOverlay` in the existing terminal HUD layer. It
shows a passive `connecting` state, attempt data and `Cancel` / `Reconnect
now` for `reconnecting`, and a single `Reconnect` action for `disconnected`
and `error`. Keep monitor metrics above terminal content. Sidebar rows add visual mappings for `idle`,
`restoring`, `reconnecting`, `disconnected`, and `closing` while retaining the
existing session context-menu actions.

Keep monitor sampling in its own reducer branch. A failed monitor request sets
only the HUD's unavailable state; it must not call `sessions.close`,
`sessions.reconnect`, or transition a terminal session. Add an App test that
rejects `bridge.monitor.sample()` for a connected session and asserts those
three session bridge methods were not called.

Use `terminal.attachCustomKeyEventHandler` and a container `paste` listener:
copy a selection with the platform copy shortcut, let no-selection `Ctrl+C`
reach the remote terminal, use Windows `Ctrl+Shift+C/V` and macOS `Cmd+C/V`,
and call `window.confirm` with localized text before a multi-line paste when
`confirmMultilinePaste` is enabled. Send accepted paste text through the same
generation-aware input callback.

Update Settings to remove Port recommendations interval controls and add
limited/continuous reconnect mode, restore-previous-workspace, and
multi-line-paste toggles. Update Ports to render `suspended` and invoke
`bridge.ports.resume`. Add all English and Simplified Chinese labels. Keep the
CSS compact, terminal-local, and free of a new persistent toolbar.

- [ ] **Step 4: Run all renderer tests and inspect a production build**

Run: `npx vitest run src/app/App.test.tsx src/features/terminal/TerminalConnectionOverlay.test.tsx src/features/terminal/TerminalWorkspace.test.tsx src/features/settings/SettingsView.test.tsx src/features/ports/PortsView.test.tsx src/components/Sidebar.test.tsx && npm run typecheck && npm run build`

Expected: PASS. Renderer tests prove output bypasses React state, state actions
appear only when valid, and every changed bridge method is type-safe in the
browser preview implementation.

- [ ] **Step 5: Commit renderer integration**

```bash
git add src/app/App.tsx src/app/App.test.tsx src/components/Sidebar.tsx src/components/Sidebar.test.tsx src/features/terminal/TerminalConnectionOverlay.tsx src/features/terminal/TerminalConnectionOverlay.test.tsx src/features/ports/PortsView.tsx src/features/ports/PortsView.test.tsx src/features/settings/SettingsView.tsx src/features/settings/SettingsView.test.tsx src/features/monitoring/MonitorSummary.tsx src/styles/components.css src/styles/layout.css src/i18n/en.ts src/i18n/zh-CN.ts
git commit -m "feat: restore terminal workspaces and recovery controls"
```

## Task 10: Run Cross-Layer Terminal Engine Regression Tests

**Files:**
- Create: `tests/fixtures/terminal-engine.ts`
- Create: `tests/terminal-engine-flow.test.ts`
- Modify: `tests/setup.ts` only if the controller test adapter needs a browser API polyfill.

**Interfaces:**
- Consumes `TerminalOutputPump` from Task 2 and `TerminalController` from Task 8; Task 4's PTY lifecycle has its own focused tests.
- Produces a deterministic, no-network regression test for the main-to-renderer acknowledgement path.

- [ ] **Step 1: Write a failing cross-layer flow test**

Create a fake SSH channel and fake xterm writer. Exercise bytes from the
output pump through a packet listener into the controller and back through
acknowledgements. Then simulate a recovered channel generation and prove an
old packet cannot write into the new terminal buffer.

```ts
it("drains SSH bytes through xterm acknowledgements and rejects stale output after reconnect", async () => {
  const sessionId = "11111111-1111-4111-8111-111111111111"
  const harness = createTerminalEngineHarness(sessionId)
  await harness.open()
  harness.channel.emitData(Buffer.from("before"))
  harness.terminal.completeAllWrites()
  expect(harness.channel.paused).toBe(false)

  await harness.dropAndRecover()
  harness.emitOldPacket({ sessionId, channelGeneration: 1, sequence: 99, bytes: Buffer.from("stale") })
  expect(harness.terminal.writes).not.toContainEqual(Buffer.from("stale"))
})
```

- [ ] **Step 2: Run the cross-layer test and confirm it fails**

Run: `npx vitest run tests/terminal-engine-flow.test.ts`

Expected: FAIL until the harness can connect the session event, controller
acknowledgement, and fake channel interfaces introduced by the prior tasks.

- [ ] **Step 3: Implement the deterministic test harness only**

Create `tests/fixtures/terminal-engine.ts`. It has no network, Electron, or
clock dependency. Its fake channel explicitly invokes the same output pump that
a PTY listener would invoke; its fake terminal invokes the controller's normal
acknowledgement callback only when the test calls `completeNextWrite`.

```ts
class FakeChannel {
  public paused = false
  public onData: (bytes: Uint8Array) => void = () => undefined
  public pause(): void { this.paused = true }
  public resume(): void { this.paused = false }
  public emitData(bytes: Uint8Array): void { this.onData(bytes) }
}

class ManualTerminal implements TerminalWriteAdapter {
  public readonly writes: Uint8Array[] = []
  private readonly completions: Array<() => void> = []
  public write(bytes: Uint8Array, done: () => void): void { this.writes.push(bytes); this.completions.push(done) }
  public completeNextWrite(): void { this.completions.shift()?.() }
  public completeAllWrites(): void { while (this.completions.length) this.completeNextWrite() }
  public focus(): void {}
  public dispose(): void {}
  public setDisableStdin(_disabled: boolean): void {}
  public setFont(_fontFamily: string, _fontSize: number): void {}
}

export function createTerminalEngineHarness(sessionId: string) {
  const channel = new FakeChannel()
  const terminal = new ManualTerminal()
  let generation = 1
  let pump: TerminalOutputPump
  const controller = new TerminalController(terminal, { fit: () => undefined, dimensions: () => ({ cols: 120, rows: 40 }) }, {
    onInput: () => undefined,
    onResize: () => undefined,
    onAck: (ackGeneration, sequence) => pump.acknowledge(ackGeneration, sequence)
  })
  const createPump = (): TerminalOutputPump => new TerminalOutputPump(channel, sessionId, generation, (packet) => controller.acceptOutput(packet))
  pump = createPump()
  channel.onData = (bytes) => pump.enqueue(bytes)
  return {
    channel,
    terminal,
    async open(): Promise<void> { controller.setChannelGeneration(generation) },
    async dropAndRecover(): Promise<void> { pump.close(); generation += 1; controller.setChannelGeneration(generation); pump = createPump() },
    emitOldPacket(packet: TerminalOutputPacket): void { controller.acceptOutput(packet) }
  }
}
```

- [ ] **Step 4: Run the cross-layer suite and the complete quality gate**

Run: `npx vitest run tests/terminal-engine-flow.test.ts && npm test && npm run typecheck && npm run build`

Expected: PASS. The full test count includes Electron main-process tests and
the renderer suite. Build output completes without a missing preload or typed
bridge export.

- [ ] **Step 5: Commit the regression harness**

```bash
git add tests/fixtures/terminal-engine.ts tests/terminal-engine-flow.test.ts tests/setup.ts
git commit -m "test: cover terminal engine recovery flow"
```

## Final Verification

Run the complete automated gate after all tasks:

```bash
npm test
npm run typecheck
npm run build
```

Perform the manual scenarios from the spec on a real SSH host:

1. Stream sustained logs and verify the window remains responsive.
2. Resize, maximize, restore, change font size, and split while running vim,
   htop, or tmux; confirm PTY dimensions remain correct.
3. Interrupt the network and restore it; verify one retry loop, a visible new
   shell notice, and no claim that the prior remote process survived.
4. Run two sessions and a loopback forward on one connection; close one
   session and confirm the other session and forward stay usable.
5. Restart Rocker; confirm windows, labels, active session, split layout, and
   dimensions return while terminal output and forwarding listeners do not.

Push only after the user requests a release. The user controls major and
minor version publication; do not change `package.json` version, create a tag,
or publish release assets as part of this implementation plan.
