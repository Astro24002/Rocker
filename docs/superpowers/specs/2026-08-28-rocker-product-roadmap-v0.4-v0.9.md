# Rocker Product Roadmap: v0.4.x to v0.9.0

Date: 2026-08-28 (updated 2026-09-10 for v0.5-A)
Status: Maintained product evolution baseline aligned with the approved workspace shell
Scope: Windows and macOS desktop application

## Version Policy

Rocker uses minor versions for planned product capability and patch versions
for bug fixes. The roadmap ends at `v0.9.0`, which is the release-candidate
milestone. Major-version release policy is intentionally outside this
roadmap.

```text
v0.3.1  Reliability baseline
v0.4.x  Terminal productivity and workspace-shell closeout
v0.5.0  Hosts and Trust
v0.6.0  Port Forwarding Manager
v0.7.0  SFTP Foundation
v0.8.0  Snippets and workspace productivity
v0.9.0  Release candidate hardening
```

Every version is independently releasable. A later version must not silently
change the security or ownership guarantees established by an earlier one.

## Audited Status at 2026-09-10

This roadmap distinguishes shipped behavior from code that only exists in the
current working tree. The published baseline is package `0.4.3`, tag `v0.4.3`,
and commit `5bbf9ae`. The current working tree contains unreleased Hosts and
workspace-shell work and must not be described as shipped until it is committed,
tagged, packaged, and verified through the defined release process.

Status terms used below:

- **Released**: present in the `v0.4.3` tagged product baseline.
- **Working tree**: implemented and locally testable, but not released.
- **Partial**: a lower-level capability exists, while the complete user workflow
  or lifecycle is missing.
- **Placeholder**: navigation exists, but no usable product capability exists.

| Product area | Audited status | Evidence and remaining work |
| --- | --- | --- |
| Terminal Engine and Sessions | Released | Direct xterm.js output, resize propagation, reconnect state, restore, owner-scoped PTYs, and verified connection reuse are established. Continue reliability maintenance rather than redesigning this layer. |
| Terminal productivity | Released | Search, Command Palette, context actions, appearance settings, and recent Session ordering shipped in v0.4.0. Permanent terminal toolbars remain intentionally absent from the approved shell. |
| Workspace shell and default theme | Released, with working-tree refinements | The frameless two-column shell, constrained resizable Sidebar, Rocker identity, and `#0AA344` theme baseline are shipped. Current Hosts/workspace alignment changes remain unreleased. |
| Local data protection | Released | Local-first storage, system-protected credentials, optional Vault, sanitized template export, encrypted migration export/import, rollback, and recovery shipped in v0.4.3. |
| Hosts | Working tree / v0.5-A implemented | Compact cards, bounded direct SSH entry, the shared New/Edit drawer, exact group filtering, safe duplicate/favorite/remove actions, Recent Hosts, and App-level save error propagation are implemented and locally verified. Trust management, tags, environment policy, connection testing, scale validation, and metadata application remain v0.5 work. |
| Host Key trust | Partial | First-use and changed-key verification plus persistence exist. A user-facing Trust inventory, audit history, removal/re-trust workflow, and owner-scoped management IPC do not. |
| Port Forwarding | Partial | Explicit scan, transient Local Forward lifecycle, leases, recovery, and owner cleanup exist. Persistent profiles and the full management workflow do not. |
| History | Partial | List, search, clear, and reconnect exist. Completed-session outcome and elapsed-time recording are not yet closed; current open records use a zero duration. |
| SFTP | Placeholder | The route exists, but no SFTP service, lease kind, IPC contract, file browser, or transfer queue exists. |
| Snippets | Placeholder | The route and Host editor association fields exist, but there is no Snippet store, expansion, preview, or execution path. |
| Named Workspaces | Partial | Automatic Session/split/layout recovery exists. User-named save/restore and forwarding intent do not. |
| Release engineering | Partial | Windows/macOS x64/arm64 packaging and a six-asset release allow-list exist. Signing, notarization, native launch smoke, and final migration/security/performance gates remain v0.9 work. |
| Product documentation | Partial | The roadmap now records v0.5-A working-tree progress and its verification evidence. README still reports v0.4.0, the architecture audit predates Vault/Host work, and the planned v0.4.3 verification record is absent. |

The audited automated baseline is 75 passing test files, one intentionally
skipped soak file, 626 passing tests, and one skipped test. React `act(...)`
warnings remain non-blocking test-hygiene debt. Native Windows/macOS launch
testing is intentionally deferred during the v0 line; the long soak is a v1
gate, not a v0 patch gate.

### Engineering Readiness

The core process boundaries are sound: SSH transports are reused through
owner-scoped leases, PTYs own their own lifecycle, storage has backup/recovery
and validated imports, and forwarding already survives independently of a
Terminal Session. These are suitable foundations for the remaining roadmap.

The coordination layer now needs a size boundary. At this audit, `App.tsx` is
about 1,300 lines and `electron/ipc/register.ts` is about 1,034 lines with 42
IPC registrations. v0.5 must extract Hosts state/workflow coordination and its
domain IPC registration instead of adding Trust behavior directly to those
files. v0.7 must begin with a separate SFTP service, lease contract, and IPC
module. `ConnectionManager` should remain the SSH transport authority rather
than absorb feature-specific file or forwarding workflows.

One current Hosts integration defect is release-blocking: the application shell
discards the Promise returned by Host save, so a persistence failure cannot
reach the editor's error state. Fix this boundary and add an App-level failure
regression before releasing the Hosts candidate.

### Release Classification

The working tree currently mixes patch and minor-version scope:

- Correcting the Windows user-data directory casing to `%APPDATA%/Rocker` and
  recording real History duration/outcome are bug fixes suitable for a v0.4.x
  patch chosen by the product owner.
- Compact Host cards, direct SSH entry, the shared Host editor, and new Host
  profile metadata are product capability and belong to the v0.5 line under the
  established version policy.

Do not describe or tag the combined dirty working tree as a completed patch or
completed v0.5 release. Separate the release scopes or finish the complete v0.5
acceptance boundary first.

## Product North Star

Rocker combines Termius-style host management, a reliable terminal engine, and
minimal SSH operations in a local-first native desktop application. The
product should optimize for fast repeated workflows, predictable recovery,
and clear security decisions rather than feature count.

## Current Product Shape

The approved desktop UI is a continuous two-column workspace, not a dashboard
with independent feature windows. The left Sidebar is the durable control
surface. The right Workspace is the only destination surface for terminal and
management workflows. Native window chrome occupies a visually blank strip at
the top of the right Workspace.

| Sidebar destination | Workspace role | Current roadmap status |
| --- | --- | --- |
| Sessions | Direct SSH terminal | Core product surface; remains the default working state. |
| Hosts | Host management workspace | Working-tree UI foundation; completion target is v0.5. |
| SFTP | Remote file workspace | Reserved destination; placeholder until v0.7. |
| Snippets | Command-library workspace | Reserved destination; placeholder until v0.8. |
| Port Forwarding | Forwarding management workspace | Existing runtime flow; manager workflow planned in v0.6. |
| History | Connection history workspace | Existing local workflow; outcome/duration closeout remains partial. |
| Settings | Device-local preferences and data protection | Existing local workflow. |

The Sidebar order is Hosts, SFTP, Snippets, Port Forwarding, History, and
Settings. Sessions remain a separate section below product navigation. A
feature must use its route in the right Workspace; it must not add a permanent
toolbar, monitoring panel, or side pane that reduces the SSH terminal's normal
working area.

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
- Local Terminal remains disabled and outside the current roadmap; no
  `node-pty` is introduced.

### v0.4 Release Status

The current published baseline is `v0.4.3`.

- `v0.4.0` shipped Terminal Productivity. Its verification record and manual
  smoke checklist are [available here](../../releases/v0.4.0-implementation-verification.md)
  and [here](../../releases/v0.4.0-smoke-checklist.md).
- `v0.4.1` established the approved frameless workspace shell and Rocker Dark
  visual baseline.
- `v0.4.2` completed product identity and application artwork integration.
- `v0.4.3` shipped the local-first data-protection model, optional Vault,
  protected credential storage, and safe configuration transfer workflows.

Current unreleased Host cards, the shared Host editor, platform metadata, and
user-data directory refinements are working-tree progress, not part of the
`v0.4.3` release. The user-data casing correction is v0.4 patch scope; the Host
capability is v0.5 scope.

The v0.4.0 manual smoke checklist remains entirely `PENDING`; its existence is
not evidence that native smoke was executed. The v0.4.3 implementation also
lacks its planned data-protection verification record. Both are documentation
and verification debt, even though the v0.4.3 CI build and release completed.

The GitHub Actions release workflow builds only the Windows/macOS installer and
archive targets. Native Windows/macOS startup coverage remains deferred for the
v0 line, while the 30-minute long soak remains a v1 release gate. This roadmap
remains the source of truth for the order and boundaries of v0.4 through v0.9.

### Current Workspace-Shell Baseline

The workspace-shell and default-theme design is the visual baseline for all
later versions. Any remaining UI-alignment work uses a version selected by the
product owner; this roadmap does not classify it as a new product subsystem.

- Keep the terminal as the full default right-side surface when a Session is
  active.
- Keep Hosts as a dense card workspace with direct SSH entry and a shared
  New/Edit Host drawer.
- Keep SFTP and Snippets as honest placeholders until their respective
  backend, ownership, and safety contracts exist.
- Keep the workspace-internal Sidebar resize affordance invisible at rest;
  do not reintroduce a permanent gray divider or global title bar.
- Preserve the Rocker Dark `#0AA344` semantic accent system and the blank
  native workspace chrome.

The package version and release tag for UI-alignment work remain under
product-owner control. Before the next patch release, fix History completion
records so elapsed time and outcome are updated when a Session closes. Treat the
Windows user-data casing change as a patch fix, but keep new Hosts capability in
the v0.5 line.

## v0.5.0: Hosts and Trust

### Goal

Make the Host workspace the dependable starting point for opening a connection
and understanding its trust posture before a remote operation begins.

### User Scenarios

- Find a host by name, address, username, group, or tag.
- Assign an environment and receive an explicit warning for configured risky
  operations without cluttering the default Host card.
- Duplicate a host configuration without copying credentials unsafely.
- Review trusted Host Keys and remove an outdated trust entry.
- Understand which authentication method and connection policy a Session uses.

### UI Contract

- Hosts remains a full right-workspace destination, not a left/right split
  browser.
- The primary presentation is the approved compact host-card grid. A card
  shows platform identity, host label, and `SSH · username`; it does not expose
  address, ports, credentials, or decorative status lights by default.
- Single-click selects a card; double-click connects it. The edit affordance
  appears only on hover and must not trigger a connection.
- The top search field continues to support both saved-host search and the
  bounded direct command form `ssh [user@]host [-p port]`.
- New and Edit Host use the same right-side drawer and retain the existing
  redacted-key and protected-credential boundaries.

### Current Evidence and Remaining Scope

The current working tree now closes the first v0.5-A Host workflow slice. Groups
remain profile strings rather than managed entities, while exact group filtering,
safe duplicate/favorite/remove actions, Recent Hosts derivation, and the compact
selected-card action strip are implemented. The App now preserves rejected Host
save Promises so the editor can show a retryable generic error.

The Host workflow is still not the complete v0.5 milestone. Trust inventory and
Host Key management, tags, environment policy, connection testing, scale
validation, and Host charset/theme application remain open. Use
[v0.5-A Host Workflow Verification](../../releases/v0.5-a-host-workflow-verification.md)
for the exact automated evidence and native-manual PENDING checks.

`snippetsEnabled`, `snippetCollection`, `charset`, and `themeColor` in the Host
editor are reserved profile metadata. Snippets have no executable entity model,
and charset/theme values are not applied to terminal decoding or rendering yet.
The UI must not imply otherwise. Charset and theme become effective in v0.5;
Snippet association remains dormant until v0.8.

### Features

- Complete group management, platform marks, favorites, and recent Hosts, then
  add tags and environment metadata.
- Host search across name, address, username, group, and tags.
- Environment metadata with filtering and an explicit risk confirmation policy;
  do not add it to the compact card's default information set.
- Duplicate host configuration with credentials excluded by default.
- Connection test action with a bounded timeout.
- Apply the selected per-Host charset and terminal theme to new Sessions, with
  UTF-8 and Rocker Dark as the defaults.
- Trust view showing trusted Host Key metadata and change history. It is a
  focused management view, not a dashboard or telemetry center.
- Host Key removal and re-trust workflow.
- Session security summary: auth method, verified key status, and reuse state.

### Architecture Impact

- Extend `HostProfile` with optional tags and environment metadata.
- Add a versioned Host Key audit record without storing raw private material.
- Keep credential storage separate from host documents.
- Add owner-scoped security IPC read/write operations.
- Extract Hosts coordination from the application shell before adding Trust
  workflows; `App.tsx` must not become the permanent feature controller.
- Connect Host charset and theme preferences to Terminal Session creation while
  keeping Snippet association explicitly dormant until v0.8.

### Acceptance

- Searching 1,000 local hosts remains interactive.
- Duplicating a host never copies a password or passphrase into the host file.
- Production hosts show a clear confirmation before destructive or risky actions.
- The trust view can explain why a connection was accepted or rejected without
  exposing private key material, credentials, or raw diagnostics.
- Selecting a group uses exact group identity rather than substring matching.
- Delete, duplicate, favorite, and connection-test actions are reachable without
  weakening single-click select and double-click connect behavior.
- Host save failure is covered at the App integration boundary and leaves the
  editor open with an actionable retry state.
- A Host's supported charset and theme take effect for a new Session; selecting
  an unsupported value cannot create a misleading saved preference.

### Out of Scope

- Cloud host sync, team sharing, secret managers, and new authentication types.

### Exit Decision

Do not declare v0.5 complete because Host fields or cards exist. The milestone
closes only when Host organization, operations, trust inspection, connection
testing, security summary, and the 1,000-host interaction target are delivered.

## v0.6.0: Port Forwarding Manager

### Goal

Turn the existing explicit port forwarding flow into a dependable, independent
resource manager.

### UI Contract

Port Forwarding remains a full right-workspace destination. It does not live
inside a terminal toolbar and does not infer a forwarding request from port
discovery. Its editor, status list, warnings, and recovery actions must use
the same restrained tool-UI language as Hosts.

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
- Generalize connection-consumer leases without weakening the existing rule:
  only the same window, Host configuration, authentication identity, and
  verified Host Key may share a transport.

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

### UI Contract

SFTP occupies its reserved full right-workspace destination. It is not a
permanent terminal side panel and does not open a separate application window.
The first release is a remote-only file workspace: a compact path/action bar,
a central remote file table, and a persistent transfer queue at the bottom.
Upload uses a native file chooser or drag-and-drop; download uses the native
save-location flow. A dual-pane local browser is not part of the foundation.

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
- Introduce a dedicated SFTP manager/service and typed IPC module rather than
  expanding the existing application shell or monolithic IPC registration file.
- Make transfer ownership, cancellation, channel disposal, and connection-lease
  release explicit before implementing the file table.

### Acceptance

- SFTP failure never closes or mutates the Terminal PTY.
- Transfer cancellation releases channels and does not leak leases.
- Path traversal and invalid operation requests are rejected at IPC boundaries.
- The queue remains usable with multiple concurrent transfers per host.

### Out of Scope

- Dual-pane local browsing, remote code editing, directory synchronization,
  offline cache, and file diff.

## v0.8.0: Snippets and Workspace Productivity

### Goal

Reduce repetitive operational work while preserving explicit user control over
commands and workspace state.

### UI Contract

Snippets occupies its reserved full right-workspace destination. It must not
add persistent controls above the terminal; command selection and confirmation
remain explicit workspace interactions.

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
- Activate Host snippet associations only after a real Snippet entity exists;
  a stored collection name alone is not an executable capability.

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
- Split renderer and main-process bundles where measurements justify it, and
  tighten CI permissions to the minimum needed by verify, package, and release.
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
- Local Terminal and host-monitoring UI remain out of scope for this roadmap.
- SSH credentials and private key contents never enter logs, diagnostics, or
  source-controlled fixtures.
- All main-process resources remain owner-scoped and lease-managed.
- New renderer features consume typed IPC contracts rather than importing main
  process implementation details.
- Every persisted data structure has validation, migration coverage, and a
  backward-compatible failure mode.
- Persisted Host charset, theme, and Snippet association fields must be labelled
  as reserved until a consuming engine makes them effective.
- The two-column desktop workspace is a cross-version layout contract:
  management features render in the right Workspace, while active SSH Sessions
  retain their terminal-first surface.
- SFTP, forwarding, and future background consumers can share a verified SSH
  transport only through owner-scoped leases. They must never close, mutate, or
  expose terminal content as part of their own failure handling.

## Recommended Delivery Sequence

1. Partition the current working tree into patch fixes and the v0.5 feature
   candidate. Correct History completion metadata and the Host save Promise
   boundary, refresh README/architecture verification records, and rerun source
   verification before either release scope is tagged.
2. Complete v0.5 Hosts and Trust before starting SFTP. This closes the Host,
   credential, and verified-key control plane that every later remote operation
   depends on.
3. Complete v0.6 persistent Local Forward management. Its independent consumer
   lifecycle is the proving ground for generalized SSH connection leases.
4. Build v0.7 SFTP on the generalized lease, typed IPC, and owner-cleanup model;
   do not build file UI against transient terminal-session ownership.
5. Add real Snippet entities and named Workspaces in v0.8, then activate the
   currently reserved Host associations.
6. Freeze features for v0.9 and close signing, native smoke, migrations,
   accessibility, performance, security, diagnostics, and release operations.

This order remains the recommended route. Starting SFTP before v0.5 Trust and
v0.6 lease lifecycle completion would duplicate connection ownership logic and
make file-operation security harder to explain and test.
