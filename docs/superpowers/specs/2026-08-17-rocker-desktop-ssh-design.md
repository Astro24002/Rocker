# Rocker Desktop SSH Client Design

Date: 2026-08-17
Status: Approved in conversation

## 1. Product Definition

Rocker is a lightweight SSH desktop client for Windows and macOS. It uses an
independent Electron implementation with the same broad desktop and terminal
technology direction as Tabby, while using a Termius 7-style information
hierarchy and an original Rocker interface.

The product name is `Rocker`. The repository directory, package name,
application identifier, executable name, and internal namespace use `rocker`.

The first release focuses on three workflows:

1. Organizing and connecting to SSH hosts.
2. Running multiple terminal sessions in tabs.
3. Discovering and forwarding ports from a connected Linux host.

The application is local-first. It has no account system, cloud backend, or
mobile client.

## 2. Supported Platforms

Rocker ships desktop builds for:

- Windows
- macOS, including Intel and Apple Silicon packaging targets

The renderer is designed for desktop windows only. The minimum supported
window size is 1040 by 680 pixels. No mobile navigation, touch-specific flow,
or phone-sized responsive layout is included.

The SSH terminal can connect to any server that implements the required SSH
protocols. Remote port discovery and host monitoring are guaranteed first for
Linux hosts. Unix-like systems may work through compatible commands, but
Windows Server monitoring and automatic port discovery are outside the first
release guarantee.

## 3. Technology Choice

The first release uses:

- Electron for the Windows and macOS desktop shell.
- React and TypeScript for the renderer.
- Vite for renderer development and production builds.
- `ssh2` for SSH authentication, sessions, PTY channels, and forwarding.
- xterm.js for terminal rendering and input.
- Electron `safeStorage` for encrypted credential storage.
- electron-builder for Windows and macOS packaging configuration.

Rocker does not copy or fork Tabby source code. This keeps the implementation
and product license independent from Tabby's GPL-licensed codebase.

## 4. Process Architecture

Rocker is split across three security boundaries.

### Electron Main Process

The main process owns all privileged and stateful desktop work:

- Window lifecycle and desktop menus.
- Host configuration persistence.
- Credential encryption and decryption.
- SSH connections and PTY channels.
- SSH host key verification.
- Remote listening-port discovery.
- Local SSH port-forward listeners.
- Remote host metric sampling.
- Connection history.

### Preload Bridge

The preload script exposes a narrow, typed API to the renderer. Its public
surface is grouped by responsibility:

- `hosts.list`, `hosts.save`, `hosts.remove`, `hosts.importSshConfig`
- `sessions.open`, `sessions.write`, `sessions.resize`, `sessions.close`
- `ports.scan`, `ports.forward`, `ports.stop`, `ports.openAddress`
- `monitor.subscribe`, `monitor.refresh`
- `settings.get`, `settings.update`
- `history.list`, `history.clear`

Events flowing back to the renderer include terminal output, connection state,
host-key prompts, authentication errors, discovered ports, forwarding state,
and monitoring samples.

### React Renderer

The renderer owns presentation and ephemeral view state only:

- Host and group navigation.
- Session tabs and active-tab selection.
- xterm.js terminal instances.
- Port forwarding table.
- Expandable host monitoring summary.
- Settings, history, and localization.

The renderer has no direct Node.js, filesystem, socket, or credential access.
Electron context isolation is enabled and Node integration is disabled.

## 5. Module Layout

The replacement repository uses the following top-level structure:

```text
electron/
  main.ts
  preload.ts
  ipc/
  ssh/
  ports/
  monitoring/
  storage/
src/
  app/
  components/
  features/hosts/
  features/terminal/
  features/ports/
  features/monitoring/
  features/history/
  features/settings/
  i18n/
  styles/
build/
  icon.svg
tests/
```

Each feature exposes typed inputs and outputs so SSH internals, persistence,
and UI rendering can be tested or replaced independently.

## 6. Core Data Flow

### Startup

1. The main process loads host metadata, settings, connection history, and
   accepted host fingerprints from the application data directory.
2. Encrypted credentials remain encrypted until a connection requests them.
3. The renderer requests a sanitized startup snapshot through the preload API.
4. The renderer restores the language, sidebar width, navigation state, and
   host list without receiving plaintext credentials.

### SSH Session

1. The user selects a host and opens a terminal tab.
2. The main process resolves password, private-key, or SSH Agent credentials.
3. The host fingerprint is verified before authentication completes.
4. The main process opens an SSH shell with a PTY sized to the xterm.js view.
5. Terminal data is streamed through session-scoped IPC events.
6. Input and resize requests are validated and routed only to that session.
7. Disconnecting retains terminal output in the tab, disables input, stops
   associated forwarding listeners, and offers reconnect.

Each tab has an independent SSH session. Split panes are not included.

### Port Discovery and Forwarding

1. After connection, the main process runs a fixed Linux listening-port probe,
   preferring `ss` and falling back to `netstat` where possible.
2. The parser produces normalized records containing remote port, bind address,
   process, remote user, and discovery source.
3. The Ports view shows discovered records without opening local listeners.
4. A listener is created only after the user selects **Forward**.
5. The chosen local address and port are bound, then tunneled through the SSH
   session to the remote target.
6. The user can stop forwarding, copy the local address, or open HTTP/HTTPS
   addresses in the system browser.

The first release exposes this TRAE-style remote-to-local workflow, equivalent
to SSH local forwarding. Remote forwarding and dynamic SOCKS5 forwarding are
not exposed in the first release.

### Host Monitoring

The active SSH session periodically gathers a small Linux metrics snapshot
using fixed, non-interactive commands. The snapshot contains:

- Connection state and round-trip latency.
- CPU utilization.
- Memory utilization.
- Root filesystem utilization.
- Aggregate network receive and transmit rates where available.
- Sampling time and availability state.

Monitoring failure never interrupts the terminal. Unsupported metrics display
as unavailable rather than zero.

## 7. Local Data and Security

Host metadata is stored locally and includes names, addresses, ports,
usernames, groups, favorites, notes, authentication type, and private-key file
paths. Private-key contents are never copied into Rocker's configuration.

Passwords and private-key passphrases are encrypted with Electron
`safeStorage`, which uses the platform protection available on Windows and
macOS. Plaintext secrets are not placed in React state, serialized IPC
responses, application logs, or connection history.

Importing `~/.ssh/config` reads supported non-secret fields including `Host`,
`HostName`, `Port`, `User`, and `IdentityFile`. Unsupported directives are
preserved outside Rocker rather than silently rewritten.

Host key handling follows these rules:

- A first connection requires explicit fingerprint confirmation.
- An accepted fingerprint is persisted locally for later checks.
- A changed fingerprint blocks connection and requires an explicit update.
- There is no global "accept all host keys" mode.

IPC handlers validate identifiers, paths, ports, addresses, payload sizes, and
state transitions in the main process. Remote port discovery and monitoring use
fixed command templates and do not interpolate arbitrary user commands.

## 8. Interface Design

The repository reference image `Snipaste_2026-08-17_17-58-09.png` defines the
first-release layout proportions and information hierarchy.

### Desktop Shell

- The app uses a quiet dark terminal workspace with a compact title area.
- The left sidebar and terminal surface are the two dominant regions.
- Decorative cards, marketing panels, and mobile navigation are excluded.
- The terminal receives the largest uninterrupted area of the window.

### Resizable Sidebar

The sidebar defaults to approximately 220 pixels and can be resized by dragging
its right edge. It is constrained to 180 through 360 pixels and its width is
persisted locally. Content truncates deliberately at narrow widths without
changing row heights.

Its information order is:

1. Personal workspace selector and compact utility actions.
2. Hosts.
3. SFTP.
4. Port Forwarding.
5. Snippets.
6. History.
7. Current-host monitoring summary at the bottom.

SFTP and Snippets are visible navigation entries but open a clear
"Coming soon" state in the first release. History is a working, peer-level
navigation destination rather than a fixed bottom panel.

### Host Monitoring Summary

The bottom sidebar region belongs to the currently active host. It is compact
and collapsed by default. Its collapsed state shows connection health, latency,
CPU, and memory. Expanding it reveals disk, network, and last-sampled details.
When there is no active connection it shows a lightweight empty state.

### Terminal Workspace

Session tabs appear above the terminal and display host name, connection state,
and close action. The workspace supports multiple tabs but no split panes.
Terminal actions use familiar icons for reconnect, disconnect, clear, and new
session, with tooltips where the meaning is not universal.

### Ports View

The Ports view is a dense table rather than a card dashboard. Its columns are:

- Port
- Forwarded address
- Process
- Source
- User
- Status
- Actions

Discovered ports begin in `Discovered`. User action moves them through
`Starting`, `Forwarding`, `Stopping`, `Stopped`, or `Error`. Available actions
include forward, stop, copy address, and open address.

### Host Editor

Creating or editing a host uses a right-side drawer. Fields include display
name, host, port, username, authentication method, private-key path, group,
favorite state, and notes. Authentication-specific fields appear only when
relevant.

### Settings and Localization

English is the default interface language. Simplified Chinese is selectable in
Settings. All visible strings and user-facing errors are stored in localization
dictionaries from the first release.

Settings also cover terminal font family and size, connection timeout, reconnect
behavior, port scan interval, and default local bind address.

## 9. Error Handling

User-facing errors distinguish actionable causes:

- DNS failure, timeout, connection refusal, and SSH negotiation failure.
- Incorrect password, unreadable private key, incorrect passphrase, and
  unavailable SSH Agent.
- First-seen host key and changed host key.
- Local forwarding port conflict and bind permission failure.
- Remote port discovery unsupported or command unavailable.
- Monitoring command unsupported or metric unavailable.

An SSH disconnect preserves terminal output, disables input, marks associated
forwarding rules stopped, and offers reconnect. A monitoring or discovery error
never terminates a healthy terminal session.

## 10. Testing Strategy

### Unit Tests

- Host metadata persistence and credential encryption boundaries.
- SSH config parsing and import normalization.
- Linux `ss` and `netstat` output parsing.
- Port-forward state transitions and conflict handling.
- Monitoring metric parsing and unavailable states.
- Localization completeness and language switching.
- Sidebar width constraints and persistence.

### Integration Tests

- Typed IPC request validation and event routing.
- SSH connection, PTY input/output, resize, close, and reconnect against a mock
  SSH server.
- Isolation between multiple session tabs.
- First-seen and changed host fingerprint flows.
- Port discovery and local forwarding lifecycle.
- Cleanup of forwarding listeners after disconnect.

### Renderer Tests

- Hosts empty, loading, connected, and error states.
- Session tab creation, switching, and close behavior.
- Ports table actions and state rendering.
- Expandable monitoring summary.
- English and Simplified Chinese UI.
- Resizable sidebar keyboard and pointer behavior.

### Build Verification

Development checks cover TypeScript, linting, unit tests, renderer production
build, and Electron startup. CI defines Windows and macOS packaging jobs only.
Code signing, Apple notarization, app-store submission, and automatic updates
are later release work.

## 11. First-Release Scope

Included:

- Local host creation, editing, duplication, grouping, favorites, and deletion.
- Import from `~/.ssh/config`.
- Password, private-key file, and SSH Agent authentication.
- Verified SSH host fingerprints.
- Multiple terminal tabs with real SSH PTY sessions.
- Linux remote-port discovery and user-initiated local forwarding.
- Local connection history.
- Expandable current-host monitoring.
- English and Simplified Chinese.
- Windows and macOS packaging configuration.

Not included:

- Mobile clients or mobile-responsive interface.
- Accounts or cloud synchronization.
- Terminal split panes.
- SFTP file management.
- Snippet content management.
- Remote forwarding or dynamic SOCKS5 forwarding.
- ProxyJump and multi-hop connection chains.
- Guaranteed Windows Server monitoring and port discovery.
- Automatic updates, store publishing, signing, or notarization.

## 12. Acceptance Criteria

The first release is accepted when all of the following are demonstrated:

1. Rocker starts as an Electron desktop app using the `rocker` identifier and
   exposes Windows and macOS package configurations.
2. A user can create a host or import one from `~/.ssh/config`.
3. Password, private-key, and SSH Agent flows produce clear success and failure
   states without exposing plaintext secrets to the renderer.
4. A first connection asks for host-fingerprint confirmation and a changed key
   blocks connection.
5. Two or more terminal tabs maintain independent SSH sessions and output.
6. A disconnected tab retains output and can reconnect.
7. A Linux host's listening ports appear without automatically opening local
   listeners.
8. A user can start and stop forwarding, and a local port conflict produces a
   specific error.
9. The current-host monitoring summary expands and collapses without resizing
   the terminal unexpectedly.
10. The sidebar can be resized within its constraints and restores its width on
    restart.
11. English is the default and Simplified Chinese can be selected without
    restarting the application.
12. SFTP and Snippets show explicit first-release placeholder states.
13. Automated tests cover session isolation, fingerprint verification, port
    forwarding lifecycle, monitoring parsing, localization, and persistence.

