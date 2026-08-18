# Rocker Session and Unified Window Design

Date: 2026-08-18
Status: Design approved in conversation; implementation pending

This document supersedes the first-release assumptions about terminal tabs and
the application toolbar in `2026-08-17-rocker-desktop-ssh-design.md`. The
existing host, storage, SSH, port, monitoring, and localization decisions stay
in effect unless this document explicitly changes them.

## 1. Goals and Non-Goals

This change has four goals:

1. Represent terminal work as sessions, not a top tab strip.
2. Reuse a verified SSH connection only when the security context is identical
   inside the current window.
3. Make port forwarding a user-confirmed recommendation flow, never an
   automatic action.
4. Make the entire client one unified desktop window with no white title-bar
   band and no application navigation/settings toolbar above the workspace.

The release still does not include mobile layouts, SFTP behavior, snippets
execution, remote forwarding, or dynamic SOCKS forwarding.

## 2. Unified Desktop Window

Rocker uses one continuous dark surface from the window edge through the
sidebar and terminal workspace. The native white title-bar area is removed.
The desktop shell uses a minimal custom window chrome only for:

- a draggable window region;
- the Rocker mark or current window title where useful; and
- platform window controls (minimize, maximize/restore, close).

The chrome has no product navigation, notification controls, workspace switcher,
or settings controls. It is not a second application toolbar.

The content below the chrome is the existing resizable sidebar plus the active
workspace. The sidebar starts at the top of the application content and the
terminal receives the remaining height without a white inset or browser-like
header. Windows and macOS use the same visual treatment; platform-specific
window-control placement is allowed, but color, spacing, and hierarchy remain
consistent.

Settings is a normal destination inside the sidebar, not a top-bar control. Its
page owns application preferences and utility controls in local sections:
Appearance, language, terminal, connection/reconnect policy, port-discovery
recommendations, and window behavior. Removing the top toolbar must not hide
access to settings.

The current `sidebar-tools` row is removed from the target design. The primary
navigation remains in the sidebar, with Settings placed as a peer destination
near the bottom of the navigation area. Sessions and current-host monitoring
remain visible in the sidebar below the navigation.

## 3. Session and Connection Model

The renderer distinguishes a visible `WorkspaceSession` from a main-process
`SshConnection`:

```text
WorkspaceSession 1..*  --->  SshConnection 1..1  --->  ssh2.Client
                                   |
                                   +-- shell channel per session
                                   +-- port forward listeners
```

`WorkspaceSession` owns its label, pane placement, terminal output, channel
state, and local session id. `SshConnection` owns the SSH client, verified host
fingerprint, security context, and reference-counted shell channels.

### Reuse rule

Within one BrowserWindow, an existing connection may be reused only when all of
these values match:

- the same saved host configuration revision;
- the same authentication method;
- the same credential revision or identity-file context; and
- the same verified host-key fingerprint.

The main process computes and compares this context. Plaintext passwords and
private-key contents never enter the renderer or a reuse key. If any value is
missing or different, a new `SshConnection` is created and host-key verification
is performed for that connection.

Connection reuse is scoped to the current BrowserWindow. A new window always
starts an independent connection, even when it targets an otherwise identical
host profile. This keeps window ownership and security decisions explicit.

### Lifecycle

- `Duplicate` creates a new shell channel in the current window and reuses the
  connection only when the reuse rule passes.
- `Split horizontally` creates a new session from the current host and applies
  the same reuse decision, then places the two sessions in horizontal panes.
- `Duplicate in a new window` creates a new BrowserWindow and forces a new SSH
  connection.
- `Close` closes only the selected shell channel. The underlying connection and
  its port forwards remain while another session references it.
- When the last session references a connection, the main process closes the
  SSH client and all connection-scoped forwarding listeners.
- A connection failure marks every dependent session disconnected and stops its
  forwarding listeners. Terminal output remains available for inspection and
  each session can reconnect explicitly.

## 4. Session Workspace Interaction

The top terminal tab strip is removed. The left sidebar is the canonical session
list, and the active workspace displays the selected session or split layout.

Each session row contains its state indicator, user label, and a context-menu
button. The menu contains exactly these session-level actions:

- `Duplicate`
- `Duplicate in a new window`
- `Rename`
- `Split horizontally`
- `Close`

Rename is local presentation state and does not change the saved host profile.
The session list remains usable while the active session is disconnected, and
the state indicator differentiates connecting, connected, reconnecting,
disconnected, and error states.

Split layout is intentionally limited to horizontal splitting in this release.
Each pane has one session surface and its own xterm instance. Closing one pane
collapses the remaining pane to the available workspace. A duplicate session
created without splitting appears in the sidebar and becomes active in the
single workspace.

The main process owns new-window creation. The renderer requests a new-window
duplicate through the typed preload bridge; the main process creates the window,
passes the sanitized host/session launch context after the renderer is ready,
and never passes credentials across windows.

## 5. Port Forwarding Recommendation Flow

Rocker does not infer or forward ports merely because a terminal session is
connected. Entering the Port Forwarding page does not scan automatically.

The page starts in an idle state with an explicit `Scan remote services` action.
Only after the user activates that action does the main process run its fixed
Linux probes (`ss`, then `netstat`) through the selected connection.

Discovered records are recommendations only. Each record may show the remote
port, process, source, user, and a suggested local port, but it never creates a
listener by itself. The user must click `Forward` for the specific record. The
local bind address and port remain editable before confirmation. Existing
forwardings are displayed by connection and can be copied, opened, or stopped.

Port services and forwarding managers therefore use `connectionId` as their
ownership key. A shell session closing does not stop a forwarding when another
session still references the same connection; closing the connection stops all
remaining listeners.

## 6. Main-Process and IPC Boundaries

The SSH manager becomes a connection pool plus channel registry. The typed
bridge adds session-level operations for duplicate, rename, split, and new
window, while preserving validation in the main process. Renderer-facing
objects contain only sanitized ids, labels, host ids, states, and output.

The main process tracks BrowserWindow ownership so connection reuse cannot cross
window boundaries accidentally. Host configuration and credential revisions are
read from the existing local stores. Host-key verification remains mandatory
for every newly created connection.

Forwarding IPC accepts a connection-backed target and validates all local and
remote addresses and ports as it does today. Port discovery is an explicit
request rather than a mount-time side effect.

## 7. Verification Plan

Before implementation is considered complete, tests must cover:

- two sessions in one window sharing one connection when all security-context
  fields match;
- a changed host revision, credential revision, or fingerprint creating a new
  connection;
- duplicate-in-new-window forcing a new connection;
- closing one channel while another session and its forwarding remain active;
- last-session close stopping the connection and all forwarding listeners;
- session reducer behavior for duplicate, rename, split, and close;
- no port scan when the Ports view mounts;
- explicit scan producing recommendations without starting a listener; and
- exact removal of the old terminal tab strip and top utility toolbar from the
  renderer shell.

The final verification command remains `npm test && npm run typecheck && npm
run build`, followed by a Windows and macOS packaging run through CI.
