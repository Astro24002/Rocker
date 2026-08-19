# Rocker v0.3 Terminal Engine Design

Date: 2026-08-19

Status: Approved in conversation; implementation pending

This document defines the v0.3 terminal-engine work for Rocker. It
supersedes the terminal-output, reconnect, forwarding-lifecycle, and workspace
restore assumptions in the previous design documents where they conflict. The
existing desktop-only scope, host-management model, host-key policy, UI
direction, and per-window connection-reuse rule continue to apply.

## 1. Product Goal

Rocker v0.3 makes the terminal a reliable long-running desktop tool rather
than a React view that happens to display SSH output.

The user-facing result is:

```text
SSH connection -> independent shell sessions -> stable terminal surfaces
```

Users can leave Rocker running through sustained output, window changes,
temporary network loss, session duplication, splits, port forwarding, and an
application restart without silently losing state or exposing a service they
did not choose to expose.

The release is successful when a user can reasonably keep Rocker open for an
eight-hour work session.

## 2. Goals and Non-Goals

### Goals

1. Send SSH PTY output into xterm.js without accumulating terminal output in
   React state.
2. Make terminal input, output, resize, disposal, and reconnect explicit,
   session-scoped operations.
3. Use a bounded, acknowledgement-based output pipeline so sustained output
   cannot cause unbounded renderer memory or a React render storm.
4. Maintain separate logical terminal sessions and physical SSH connections.
5. Reconnect eligible sessions through one connection-level retry loop after
   an unexpected transport loss.
6. Keep a shared SSH connection alive while at least one terminal session or
   active port forward still consumes it.
7. Restore windows, sessions, split layouts, labels, and recent terminal
   dimensions after a restart, without claiming to restore a remote shell.
8. Retain Rocker's current dark, native-app-like terminal workspace. State
   feedback is compact and belongs in the existing terminal HUD layer, not a
   new permanent toolbar.

### Non-Goals

v0.3 does not add:

- AI assistants, cloud sync, teams, accounts, or mobile support.
- Deep SFTP, snippets execution, ProxyJump, SOCKS5, remote forwarding, or
  remote file browsing.
- True remote-process persistence. tmux or screen integration is a later
  capability.
- Terminal-output persistence across an application restart.
- A broad visual redesign beyond the terminal state affordances described
  here.
- Automatic discovery or creation of new port forwards.

## 3. Current Limitations

The existing implementation has a sound initial security and transport base:
Host Key verification, per-window reuse constraints, SSH shell channels, and
connection-scoped forwarding already exist in the Electron main process.

The terminal path remains too coupled to renderer state:

```text
ssh2 data event -> SessionEvent string -> React output string -> xterm.write
```

`WorkspaceSession.output` grows for the lifetime of a session. Every received
chunk can create a React state update and render work. UTF-8 bytes are decoded
per event before they reach xterm.js, so a multibyte character split across
chunks is not represented by a byte-preserving protocol. When the physical
connection closes, the current manager removes session records, which leaves
no logical session runtime to coordinate a controlled reconnect.

The current one-level split representation is also not durable enough to be a
workspace-restore format. It will be replaced with a layout tree while v0.3
continues to expose only the existing horizontal split action.

## 4. Architecture

### 4.1 Process Boundaries

```text
Renderer
  Workspace state and layout
  TerminalController per logical session
  xterm.js terminal buffer and input surface
        |
        | typed preload bridge
        v
Electron main process
  WorkspaceSnapshotStore
  TerminalSessionManager
  SshConnectionManager
  ForwardingManager
  Host, credential, and Host Key stores
```

The renderer owns presentation, active-session selection, split layout, and
the in-memory xterm.js terminal buffers. The main process owns credentials,
Host Key verification, SSH clients, PTY channels, connection recovery, output
backpressure, and all network listeners.

Terminal bytes never enter React state. React receives only small state
messages such as a session state, reconnect attempt, error category, or
connection identifier.

### 4.2 Main-Process Components

#### SshConnectionManager

This component owns a logical `SshConnection` record, its current `ssh2`
client, verified security context, consumer leases, and one retry controller.
It is the only component permitted to create or replace an SSH transport.

The reuse rule remains strict. A connection may be reused only when all of
the following match:

- BrowserWindow ownership;
- saved host configuration context;
- authentication method and resolved credential or identity context; and
- previously verified Host Key fingerprint.

The comparison is computed only in the main process. A hash may be used for a
security-context key, but plaintext passwords, passphrases, private-key
contents, and SSH Agent values never enter the renderer, a snapshot, an IPC
event, or diagnostic output.

`connectionId` identifies the logical connection record and remains stable
through a successful reconnect. `transportGeneration` increments whenever the
underlying `ssh2.Client` is replaced. This lets forwarding records retain
ownership while preventing stale transport callbacks from affecting the new
transport.

#### TerminalSessionManager

This component owns a logical terminal session and its current PTY channel.
It creates shell channels through the connection manager, validates input and
resize requests, runs the output pump, and emits session events to the owning
renderer only.

A terminal session has a stable UUID for its lifetime. That UUID is also the
workspace-session identifier used by the renderer and snapshot store. Each
new shell channel increments `channelGeneration`.

#### ForwardingManager

An active local forward receives a connection consumer lease. It is not
owned by a specific shell channel. Closing Terminal A must not stop a forward
when Terminal B or the forward itself still consumes the connection.

Monitoring is intentionally not a consumer. It samples a connected terminal
session when available and never keeps an SSH connection alive by itself.

#### WorkspaceSnapshotStore

The main process stores validated window snapshots in an atomically written
JSON document. It owns persistence because the renderer must not receive
filesystem privileges. The existing `JsonStore` atomic-write behavior is the
foundation for this store.

### 4.3 Renderer Components

#### TerminalController

Every logical session has one `TerminalController`. It owns exactly one
xterm.js `Terminal`, its `FitAddon`, output FIFO, write acknowledgement,
focus behavior, and current terminal dimensions.

The controller writes incoming bytes directly into xterm.js. It never routes
terminal output through a React reducer. React mounts the terminal surface and
provides the controller with session metadata, but does not own the terminal
screen buffer.

Inactive sessions keep their xterm.js instance and scrollback alive. Their
surfaces can be hidden from the active workspace, but their controllers are
not disposed merely because the user selected another session. On activation,
the controller fits the terminal to its visible surface and sends a resize if
the grid changed.

#### Workspace State

The renderer stores small, serializable presentation state only:

- session UUID, host ID, label, state, error category, and latest dimensions;
- active session ID;
- a horizontal split layout tree; and
- window-local UI state needed for restoration.

The `output` field is removed from `WorkspaceSession`. No screen content,
typed command, raw SSH response, credential, or runtime connection handle is
part of renderer workspace state.

## 5. Terminal Data Pipeline

### 5.1 Chosen Design

Rocker uses an acknowledgement-based byte pipeline rather than a plain
fire-and-forget IPC event stream.

```text
ssh2 ClientChannel Buffer
  -> per-session main-process byte queue
  -> ordered packet, at most 64 KiB
  -> typed IPC event: sessionId, channelGeneration, sequence, Uint8Array
  -> TerminalController FIFO
  -> xterm.write(bytes, acknowledgement callback)
  -> typed IPC acknowledgement
```

Binary payloads preserve the boundary between terminal bytes and display text.
xterm.js receives bytes directly, so it remains responsible for terminal
encoding, ANSI control sequences, and its own screen buffer.

### 5.2 Ordering and Stale Data

Each data packet includes:

```ts
interface TerminalOutputPacket {
  sessionId: string
  channelGeneration: number
  sequence: number
  bytes: Uint8Array
}
```

The renderer accepts only monotonically increasing packets for the currently
attached channel generation. A packet from an older channel, a closed session,
or a duplicate sequence is ignored. Input, resize, and acknowledgement calls
also carry the channel generation so a stale terminal surface cannot affect a
freshly reconnected shell.

### 5.3 Backpressure

The main-process queue has these v0.3 limits:

```text
Maximum packet size:        64 KiB
Pause high-water mark:       4 MiB queued or unacknowledged
Resume low-water mark:       1 MiB queued or unacknowledged
xterm scrollback:        10,000 lines per session
```

When pending bytes reach the high-water mark, the manager pauses the readable
SSH channel. When renderer acknowledgements reduce pending bytes below the
low-water mark, it resumes the channel. This protects the renderer without
silently discarding remote output.

An output acknowledgement is sent only from xterm.js's write completion
callback. The main process therefore measures work accepted by the terminal,
not merely work posted to Electron IPC.

If a session is closed, the output queue is discarded, the channel is ended,
and future packets for its generation are ignored. A renderer reload or
destroyed window releases its owned sessions and leases rather than leaving an
unbounded, invisible output queue in the main process.

### 5.4 Local Notices

Connection and restoration notices are written by the terminal controller as
visibly distinct local lines. They never travel to the remote shell and are
not persisted. Examples include a successful reconnection separator and a
notice that a restored session is a new shell.

## 6. Dimensions and Layout

### 6.1 Initial PTY Size

Rocker must not open a new PTY using a guessed `100 x 30` grid. The terminal
surface is mounted first, xterm.js opens, `FitAddon.fit()` determines the
first valid grid, and only then does the renderer request the SSH session.

Every controller stores its latest valid `cols` and `rows`. Resize events are
coalesced to an animation frame and are sent only when the grid changes.

The complete resize path is:

```text
window, split, or font change
  -> TerminalController fit
  -> changed cols and rows
  -> validated preload request
  -> ClientChannel.setWindow(rows, cols)
  -> remote PTY
```

On an inactive surface, the controller retains the most recent grid. It fits
again on activation. A reconnect initially uses the retained grid and then
accepts the next real fit update.

### 6.2 Font Changes

The existing terminal font and font-size settings apply to all live terminal
controllers, not just future sessions. A changed font invalidates terminal
measurements, triggers a fit, and follows the normal resize path without
disposing the xterm buffer.

### 6.3 Layout Tree

The persisted layout uses a tree even though v0.3 exposes only a horizontal
split command. In this document, `horizontal` means a horizontal divider that
creates upper and lower panes, matching the existing workspace behavior.

```ts
type TerminalLayout =
  | { kind: "leaf"; sessionId: string }
  | {
      kind: "split"
      direction: "horizontal"
      ratio: number
      first: TerminalLayout
      second: TerminalLayout
    }
```

`ratio` is clamped to a safe range before persistence and defaults to `0.5`.
Closing a pane removes its leaf and collapses an ancestor with one remaining
child. This gives restoration an unambiguous layout without exposing vertical
splits in v0.3.

## 7. Session and Connection Lifecycle

### 7.1 State Model

Terminal sessions expose these states:

```text
idle
restoring
connecting
connected
reconnecting
disconnected
error
closing
```

`idle` represents a locally created session awaiting a terminal grid.
`restoring` represents an entry recovered from a workspace snapshot and
waiting for its restore queue. `disconnected` is a normal shell-channel exit
or an explicitly cancelled reconnect. `error` is a connection or
configuration failure that requires user action. `closing` is transient and
cannot accept input.

The main process tracks a related physical connection state internally:

```text
creating -> ready -> retrying -> ready
                           -> failed
ready or failed -> closing -> closed
```

### 7.2 Expected and Unexpected Closure

- A user `Close` cancels retries, ends the selected shell channel, releases
  its terminal lease, removes the workspace session, and never restores it.
- A shell channel that ends normally becomes `disconnected`. Its output stays
  inspectable and the user may choose `Reconnect`; automatic reconnect does
  not start for this case.
- An unexpected transport failure changes all eligible dependent sessions to
  `reconnecting`. The controller freezes the existing buffer and disables
  input while recovery is in progress.
- When recovery succeeds, each eligible logical session gets a new PTY channel
  and a new `channelGeneration`. The prior screen remains visible above a
  local reconnection separator. This is a new remote shell, not a recovered
  remote process.
- When the retry limit is exhausted, eligible sessions become `error` with
  the final safe failure reason and retain a manual `Reconnect` action. A
  later manual reconnect may reuse the logical `connectionId` but always
  creates a new `transportGeneration` after a fresh Host Key check.

### 7.3 Shared Connection Lifecycle

```text
SshConnection
  |- terminal session A lease
  |- terminal session B lease
  |- local port-forward lease
  `- future SFTP lease
```

Closing one terminal releases only its lease. The physical connection remains
alive while another terminal or a running forward retains a lease. When the
last lease is released, the manager closes the client and stops any remaining
connection-scoped resources.

Connection reuse remains scoped to one BrowserWindow. A duplicate in a new
window forces a separate connection even when the host and credentials are
otherwise identical.

### 7.4 Ownership and Event Routing

Every terminal session, connection, forward, and Host Key prompt has an owner
BrowserWindow. Terminal bytes and state events are sent only to that owner;
they are never broadcast to every Rocker window. Closing a window releases all
of that window's terminal and forwarding leases, stops its local listeners,
and disconnects its connections after its snapshot is saved.

This corrects the current behavior in which session events can be sent to all
open windows.

## 8. Reconnection and Security Policy

### 8.1 Retry Policy

Reconnect runs once per physical connection, not once per session.

```text
attempt delay: 1s, 2s, 4s, 8s, 16s, then 30s maximum
jitter:        plus or minus 20 percent
default limit: 8 attempts
optional mode: retry continuously
```

The default `autoReconnect` setting is enabled. A limited retry policy is the
default; Settings may select continuous retry. Backoff values remain code
constants in v0.3 rather than a user-facing tuning surface.

Only unexpected transport and temporary network-class failures are retried.
Authentication failure, invalid private-key input, an unavailable credential,
an invalid host configuration, Host Key mismatch, and a user cancellation stop
automatic retries immediately.

`Reconnect now` advances the one shared retry loop immediately. `Cancel` in a
single session removes that session's desire to recover; it does not cancel a
connection retry needed by another terminal or port forward. If no consumer
still wants recovery, the connection is released.

The main process also triggers an immediate eligible retry after a desktop
resume event. It does not treat a browser `online` flag as proof that an SSH
route is usable.

### 8.2 Host Key and Authentication

Every newly created physical transport, including one created during retry,
performs Host Key verification. An unknown key requires the existing native
main-process trust confirmation. A changed key is never trusted silently; the
native confirmation explicitly identifies the change and requires a deliberate
replacement trust decision after the user verifies the fingerprint.

Host Key prompts target the owner window. Credentials continue to be resolved
only by the main process through the encrypted credential vault. No error,
diagnostic, workspace snapshot, or renderer state serializes a secret.

### 8.3 Port Forward Recovery

Port forwarding remains entirely user initiated. A discovered port is only a
recommendation and never creates a forward automatically.

When a live SSH transport fails:

1. Each active forward becomes `suspended` and its listener is closed.
2. Its configuration remains associated with the logical connection.
3. After successful reconnect, a forward originally bound only to `127.0.0.1`
   or `::1` is restored automatically.
4. A forward originally bound to `0.0.0.0` remains suspended and requires a
   visible user `Resume` action before it opens a listener again.
5. A listener that cannot reclaim its local port becomes `error` with a
   local-port-conflict reason.

While a forward is suspended and still enabled for recovery, it retains its
connection consumer lease. That lease allows a connection with no terminal
sessions to retry for the forward alone. Stopping or cancelling the forward
releases the lease and can close the connection when no other consumer
remains.

Automatic restoration in step 3 restores an already user-confirmed loopback
rule. It does not scan, recommend, or create a new forwarding rule.

Forwards are never restored across an application restart. Closing the owning
window also stops them. These boundaries prevent an invisible or newly opened
Rocker window from exposing a local network service.

## 9. Workspace Restoration

### 9.1 Persisted Data

The `WorkspaceSnapshotStore` writes a versioned document such as:

```ts
interface StoredWorkspaceDocument {
  version: 1
  windows: StoredWorkspaceWindow[]
}

interface StoredWorkspaceWindow {
  workspaceId: string
  bounds?: { x: number; y: number; width: number; height: number }
  maximized: boolean
  activeSessionId?: string
  sessions: StoredWorkspaceSession[]
  layout?: TerminalLayout
}

interface StoredWorkspaceSession {
  sessionId: string
  hostId: string
  label: string
  cols: number
  rows: number
}
```

The snapshot does not contain terminal output, typed commands, connection IDs,
PTY handles, forwarded-listener state, credentials, private-key material, or
Host Key decisions.

### 9.2 Save Behavior

The renderer submits a validated current-window snapshot after workspace
changes through the typed bridge. The main store debounces writes for a short
interval and atomically replaces the file. During application quit, the main
process flushes a pending valid snapshot before resources are released.

A deliberate user window close removes that window's workspace from the
snapshot, just as a deliberate session close removes that session. During
application quit, window-close callbacks are marked as shutdown cleanup and
do not remove the saved workspaces; this preserves the previous workspace for
the next launch.

Malformed persisted entries are discarded individually. An unreadable or
invalid document falls back to an empty workspace rather than blocking launch.
Future versions must migrate from the immediately preceding document version
before exposing it to the renderer.

### 9.3 Restore Behavior

`restorePreviousWorkspace` defaults to enabled and is available in Settings.
When enabled, Rocker recreates all previously open Rocker windows with their
saved bounds, session list, active session, and split layout.

The visual workspace appears before network work starts. Restored sessions
begin as `restoring`; the foreground window's active session reconnects first,
then the remaining sessions reconnect through a global restore queue with a
concurrency limit of one. This prevents a cold launch from causing many
simultaneous SSH connections or Host Key dialogs.

If a saved host no longer exists, its session becomes `error` with a
host-not-found reason and remains closable. A successful restore opens a new
shell and writes a local restored-session notice. It never claims the old
remote process survived.

## 10. Terminal Interaction and State UI

The terminal workspace remains visually quiet. It does not gain a conventional
tab strip or a broad global toolbar.

- The sidebar session row always shows the session-state indicator and label.
- `connecting` and `reconnecting` appear in a compact terminal HUD status
  layer with attempt information and `Cancel` / `Reconnect now` controls.
- `disconnected` and `error` keep their output available for inspection,
  disable input, and show a compact `Reconnect` control in the terminal
  surface.
- The existing context menu retains session-scoped `Duplicate`, `Duplicate in
  a new window`, `Rename`, `Split horizontally`, and `Close` actions.
- `Duplicate` and split request the normal reuse decision. A new-window
  duplicate always forces a distinct connection.
- A non-active session does not steal focus. Selecting it fits the retained
  terminal and can focus the terminal surface after the session selection is
  complete.

Platform keyboard behavior is:

- With a terminal selection, copy uses the platform copy shortcut.
- Without a selection, `Ctrl+C` remains terminal input and sends interrupt.
- Windows copy and paste use `Ctrl+Shift+C` and `Ctrl+Shift+V`.
- macOS copy and paste use `Cmd+C` and `Cmd+V`.
- Multi-line paste confirmation defaults to enabled and is configurable in
  Settings.

All new visible status and error strings are localized in English and
Simplified Chinese.

## 11. Settings Changes

The existing `connectionTimeout` becomes the SSH connection-ready timeout
rather than an unused preference. The existing font and font-size preferences
apply to active terminal controllers as described in Section 6.

v0.3 adds or formalizes:

```text
autoReconnect: boolean, default true
reconnectMode: limited | continuous, default limited
restorePreviousWorkspace: boolean, default true
confirmMultilinePaste: boolean, default true
```

The obsolete `portScanInterval` preference is removed. Remote port discovery
is always explicitly user triggered. The existing default local bind-address
preference remains unchanged.

## 12. Typed IPC Contract

The preload bridge keeps all privileged work in the main process and gains
generation-aware terminal operations. Exact naming may follow the repository's
existing `rocker:sessions:*` convention, but the contract has these semantics:

```ts
open({ sessionId, hostId, cols, rows, forceNewConnection? })
write(sessionId, channelGeneration, data)
resize(sessionId, channelGeneration, cols, rows)
ackOutput(sessionId, channelGeneration, sequence)
reconnect(sessionId)
cancelReconnect(sessionId)
close(sessionId)
```

Events include:

```ts
type TerminalSessionEvent =
  | { kind: "output"; packet: TerminalOutputPacket }
  | {
      kind: "state"
      sessionId: string
      connectionId?: string
      channelGeneration: number
      state: TerminalSessionState
      reason?: TerminalFailureReason
      attempt?: number
      nextRetryAt?: string
    }
```

The main process validates UUIDs, owner-window membership, dimensions, input
size, channel generation, and terminal state transitions. It rejects a
renderer request for a session owned by another window.

Port APIs take and validate `connectionId` by name. They do not call a
connection identifier a session identifier. Workspace snapshot APIs accept
only the small persisted schema from Section 9.

## 13. Failure Reasons and Diagnostics

The renderer receives a safe failure category and localized copy, not raw
credential-bearing implementation details. Categories include:

```text
network
timeout
dns
authentication
host-key-changed
host-key-rejected
configuration
channel-ended
local-port-in-use
cancelled
unknown
```

Internal diagnostics may record counters such as bytes received, packets
acknowledged, maximum queued bytes, channel pauses/resumes, reconnect attempts,
and error category. Diagnostics never record terminal contents, host command
output, passwords, passphrases, private-key contents, or decrypted credential
values.

Monitoring failure stays isolated from the terminal. It changes only the
monitor HUD availability and never disconnects a session or triggers retry.

## 14. Verification Plan

All automated tests run without public-network dependencies. Unit tests use
fake channels, fake clocks, and fake terminal writers. Connection integration
tests may use a local `ssh2` server fixture.

### Required Automated Coverage

1. Byte pipeline preserves packet ordering, UTF-8 bytes split across source
   chunks, ANSI sequences, and acknowledgement order.
2. A high-output stream reaches the high-water mark, pauses its channel, and
   resumes only below the low-water mark without dropping queued output.
3. Old `channelGeneration` output, input, resize, and acknowledgements cannot
   affect a reconnected session.
4. React workspace state contains no full terminal-output field and terminal
   output does not cause reducer updates.
5. Initial fit, window resize, split resize, activation, maximize/restore,
   and font changes update the PTY with the final valid grid.
6. Shared-session reuse opens distinct shell channels on one verified
   connection when the security context matches, and does not reuse across a
   changed context or a new window.
7. Unexpected transport loss runs one deterministic backoff sequence for all
   eligible consumers; normal shell exit does not auto-reconnect; close and
   cancel stop the right leases.
8. Loopback forwards suspend and restore after a successful reconnect;
   non-loopback forwards remain suspended until explicit resume; the last
   consumer rule is enforced.
9. Host Key mismatch and authentication errors never enter automatic retry or
   auto-trust.
10. Snapshot validation, atomic persistence, layout-tree restoration,
    host-not-found handling, one-at-a-time restore ordering, and no-output/no-
    credential persistence are covered.
11. Session output and Host Key prompts route only to their owner window.
12. State HUD, disabled input, reconnect controls, keyboard handling, and
    session-menu behavior are covered in renderer tests.

### Manual Acceptance Scenarios

```text
1. SSH to a host and stream sustained logs. The interface stays responsive.
2. Resize, maximize, restore, alter font size, and split a session. Full-screen
   programs such as vim, htop, and tmux retain a correct PTY grid.
3. Interrupt the network. The UI reports reconnecting, then reconnects after
   the route returns. The new shell is clearly marked as new.
4. Run Terminal A, Terminal B, and a local forward on one connection. Close
   Terminal A; Terminal B and the forward remain usable.
5. Restart Rocker. Windows, sessions, labels, split layouts, and dimensions
   reappear, while each restored terminal establishes a new shell.
```

### Quality Gates

Before a v0.3 release candidate is accepted, run:

```bash
npm test
npm run typecheck
npm run build
```

GitHub Actions must then build the existing Windows and macOS installer
artifacts. The feature does not introduce a new runtime dependency unless the
implementation plan identifies a concrete requirement that cannot be met by
Electron, ssh2, xterm.js, and the existing test stack.

## 15. Migration and Compatibility

Existing host profiles, encrypted credentials, accepted Host Keys, connection
history, language selection, sidebar width, and default bind address remain
valid. There is no legacy workspace snapshot to migrate in the current
release, so v0.3 introduces snapshot document version `1`.

The current in-memory session list is replaced on application restart by the
new snapshot model. Existing open sessions during upgrade are not preserved
across the application shutdown, which is expected because v0.2 has no durable
session identity or shell restoration contract.

This design does not alter installer identity, supported platforms, release
tagging, or the GitHub release artifact policy.
