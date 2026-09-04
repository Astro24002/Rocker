# Rocker Product Roadmap: v0.4.0 to v0.9.0

Date: 2026-08-28 (updated 2026-09-04)
Status: Maintained product evolution baseline
Scope: Windows and macOS desktop application

## Version Policy

Rocker uses minor versions for planned product capability and patch versions
for bug fixes. The roadmap ends at `v0.9.0`, which is the release-candidate
milestone. Major-version release policy is intentionally outside this
roadmap.

```text
v0.3.1  Reliability baseline
v0.4.0  Terminal productivity
v0.5.0  Hosts and Security Center
v0.6.0  Port Forwarding manager
v0.7.0  SFTP foundation
v0.8.0  Snippets and workspace productivity
v0.9.0  Release candidate hardening
```

Every version is independently releasable. A later version must not silently
change the security or ownership guarantees established by an earlier one.

## Product North Star

Rocker combines Termius-style host management, a reliable terminal engine, and
minimal SSH operations in a local-first native desktop application. The
product should optimize for fast repeated workflows, predictable recovery,
and clear security decisions rather than feature count.

## v0.4.0: Terminal Productivity

### Goal

Make the terminal comfortable for long daily sessions without changing the
underlying SSH protocol or introducing a large visual redesign.

### User Scenarios

- Search a large terminal buffer without losing the current cursor position.
- Copy, paste, clear, and select terminal content using familiar shortcuts.
- Adjust font size and terminal appearance while a Session is open.
- Find and execute a frequently used command without leaving the terminal.
- Understand the active Session, its connection state, and its recovery action.

### Features

- In-terminal search with match count and next/previous controls.
- Command Palette for terminal actions and navigation.
- Explicit Clear, Copy, Paste, Select All, and Focus actions.
- Configurable scrollback limit and cursor behavior.
- Minimal platform shortcut policy with Linux shell pass-through.
- Session rename and recent-session ordering.
- Improved connection overlay copy and retry/close affordances.
- Terminal context menu for common actions.

### Architecture Impact

- Keep xterm.js as the buffer owner.
- Add a terminal command registry consumed by Command Palette and context
  menu actions.
- Keep the two platform shortcut entry points renderer-owned; do not persist
  arbitrary shortcut bindings.
- Do not send terminal output through React state.

### Acceptance

- Search remains responsive with 10,000 lines of scrollback.
- All default shortcuts work on Windows and macOS with platform modifiers.
- Font changes do not lose the PTY channel or create a new SSH connection.
- Every command has a disabled/ unavailable state when no Session is active.

### Out of Scope

- tmux integration, terminal recording, AI command generation, and shell
  process restoration.

### v0.4 Design Decision Log

The approved detailed design is [v0.4 Terminal Productivity Design](./2026-09-02-rocker-v0.4-terminal-productivity-design.md).

- Command Palette is a centered terminal-first command surface with essential
  application navigation.
- Terminal Search is an xterm.js-backed floating overlay with per-Session
  state and no React output accumulation.
- Only `Ctrl/Cmd+Shift+F` and `Ctrl/Cmd+Shift+P` are global shortcuts. Common
  Linux shell combinations remain untouched.
- Session recency appears in Command Palette; Sidebar order and split layout
  remain stable, and recency is not persisted.
- Terminal appearance changes apply to all Sessions in the current window with
  debounced SettingsStore persistence.
- Local Terminal remains a placeholder in v0.4; no `node-pty` is introduced.

### v0.4 Release Status

The v0.4 Terminal Productivity implementation is complete after Tasks 1
through 6 and is released from package version `0.4.0` and tag `v0.4.0`. The
release verification record and manual smoke checklist are [available here](../../releases/v0.4.0-implementation-verification.md)
and [here](../../releases/v0.4.0-smoke-checklist.md).

The GitHub Actions release workflow builds only the Windows/macOS installer and
archive targets. Native Windows/macOS startup coverage remains deferred for the
v0 line, while the 30-minute long soak remains a v1 release gate. This roadmap
remains the source of truth for the order and boundaries of v0.4 through v0.9.

## v0.5.0: Hosts and Security Center

### Goal

Make host selection, environment awareness, and SSH trust decisions easy to
understand before a connection is opened.

### User Scenarios

- Find a host by name, address, username, group, or tag.
- See immediately whether a host is Production, Staging, or Development.
- Duplicate a host configuration without copying credentials unsafely.
- Review trusted Host Keys and remove an outdated trust entry.
- Understand which authentication method and connection policy a Session uses.

### Features

- Host groups, tags, favorites, and recent hosts.
- Host search across name, address, username, group, and tags.
- Environment badge with configurable risk color and confirmation policy.
- Duplicate host configuration with credentials excluded by default.
- Connection test action with a bounded timeout.
- Security Center showing trusted Host Key metadata and change history.
- Host Key removal and re-trust workflow.
- Session security summary: auth method, verified key status, and reuse state.

### Architecture Impact

- Extend `HostProfile` with optional tags and environment metadata.
- Add a versioned Host Key audit record without storing raw private material.
- Keep credential storage separate from host documents.
- Add owner-scoped security IPC read/write operations.

### Acceptance

- Searching 1,000 local hosts remains interactive.
- Duplicating a host never copies a password or passphrase into the host file.
- Production hosts show a clear confirmation before destructive or risky actions.
- Security Center can explain why a connection was accepted or rejected.

### Out of Scope

- Cloud host sync, team sharing, secret managers, and new authentication types.

## v0.6.0: Port Forwarding Manager

### Goal

Turn the existing explicit port forwarding flow into a dependable, independent
resource manager.

### User Scenarios

- Create, edit, name, start, stop, and remove a Local Forward.
- Save a forward to a Host without starting it automatically.
- See suspended forwards even after all Terminal Sessions are closed.
- Understand local bind exposure and port conflicts before starting.
- Recover loopback forwards after a transport reconnect.

### Features

- Saved forwarding profiles attached to a host.
- Manual Local Forward editor with validation.
- Forward names, descriptions, status filters, and search.
- Local port conflict check and actionable `LOCAL_PORT_IN_USE` errors.
- Explicit startup policy: off by default, opt-in per forwarding profile.
- Bind exposure warning for `0.0.0.0`.
- Independent forwarding lifecycle and connection dependency display.
- Import/export of forwarding profiles as sanitized JSON.

### Architecture Impact

- Persist forwarding profiles separately from transient forwarding records.
- Keep `ForwardingManager` as the listener/lease owner.
- Add a stable forwarding status event stream for renderer updates.
- Never infer forwarding requests from discovered remote ports.

### Acceptance

- Closing a Terminal does not stop an explicitly retained forward.
- Closing the owner window stops its forwards and releases leases.
- A suspended loopback forward can recover exactly once per ready transport.
- Non-loopback forwards require explicit user resume after reconnect.

### Out of Scope

- Remote Forward, Dynamic SOCKS5, ProxyJump, and shared/team forwarding.

## v0.7.0: SFTP Foundation

### Goal

Provide a small, reliable remote file workflow on top of the existing SSH
connection model.

### User Scenarios

- Browse a remote directory for the active host.
- Upload and download a file with visible progress.
- Create directories, rename files, and delete files with confirmation.
- Recover a failed transfer without losing the Terminal Session.

### Features

- Remote directory listing with path navigation.
- Upload, download, and drag-and-drop transfer queue.
- Create directory, rename, delete, and refresh actions.
- File size, modified time, permissions, and owner display where available.
- Transfer progress, cancellation, retry, and error state.
- Separate SFTP Session lease sharing the verified SSH Connection.

### Architecture Impact

- Add an SFTP consumer to the connection lease model.
- Keep file operations in the main process; renderer receives typed results.
- Enforce path and operation validation before invoking `ssh2` SFTP APIs.
- Do not expose private key material or remote file contents to logs.

### Acceptance

- SFTP failure never closes or mutates the Terminal PTY.
- Transfer cancellation releases channels and does not leak leases.
- Path traversal and invalid operation requests are rejected at IPC boundaries.
- The queue remains usable with multiple concurrent transfers per host.

### Out of Scope

- Remote code editor, directory synchronization, offline cache, and file diff.

## v0.8.0: Snippets and Workspace Productivity

### Goal

Reduce repetitive operational work while preserving explicit user control over
commands and workspace state.

### User Scenarios

- Store a command globally or for one host.
- Preview variable expansion before sending a command.
- Execute a multi-line snippet only after confirmation.
- Restore named workspaces with Sessions, splits, and saved forwarding intent.

### Features

- Global and host-scoped Snippets.
- Categories, search, favorites, and recent snippets.
- Safe variables such as host name, username, date, and current path.
- Preview and confirmation for multi-line or destructive snippets.
- Workspace names and explicit save/restore actions.
- Restore Session layout and forwarding profiles without silently starting
  unsafe listeners.

### Architecture Impact

- Add versioned local Snippet and Workspace stores.
- Keep command expansion in a pure, tested renderer-side module.
- Keep command execution through the existing owner-scoped Session IPC.
- Add explicit workspace migration versions instead of mutating old files in
  place without validation.

### Acceptance

- Snippets never execute on single click without the configured confirmation.
- Host-scoped snippets cannot be executed against another host accidentally.
- Restoring a workspace is idempotent and respects active/background ordering.
- Saved forwarding intent is displayed before any listener is started.

### Out of Scope

- AI-generated commands, cloud synchronization, team libraries, and shell
  history ingestion.

## v0.9.0: Release Candidate Hardening

### Goal

Prepare Rocker as a release candidate by closing release-quality gaps, not by
adding a new product subsystem.

### Features and Quality Work

- Windows and macOS signed-build pipeline preparation.
- macOS notarization and Windows signing documentation with secret checks.
- Auto-update design validation, but no forced update behavior.
- Startup, reconnect, terminal-output, and workspace-restore performance
  measurements.
- Crash-safe local log rotation and diagnostic export validation.
- Accessibility pass for keyboard navigation, labels, focus, and contrast.
- Packaging smoke tests on clean Windows and macOS environments.
- Upgrade/migration tests for every persisted document version.
- Security review of IPC ownership checks and sensitive-data boundaries.
- Release notes, known limitations, support checklist, and rollback procedure.

### Acceptance

- All v0.3.1-v0.8.0 acceptance criteria remain green.
- Install, launch, connect, reconnect, update settings, and uninstall work on
  clean supported desktop environments.
- No known blocker or critical security issue remains open.
- Release artifacts are reproducible from a tagged commit and have checksums.
- Release notes, known limitations, support steps, and rollback procedures are
  documented.

### Out of Scope

- Enabling automatic release promotion or adding new user-facing capabilities
  solely to justify a major version.

## Cross-Version Guardrails

- Local-first remains the default; no automatic telemetry or cloud sync.
- Mobile clients remain out of scope.
- SSH credentials and private key contents never enter logs, diagnostics, or
  source-controlled fixtures.
- All main-process resources remain owner-scoped and lease-managed.
- New renderer features consume typed IPC contracts rather than importing main
  process implementation details.
- Every persisted data structure has validation, migration coverage, and a
  backward-compatible failure mode.
