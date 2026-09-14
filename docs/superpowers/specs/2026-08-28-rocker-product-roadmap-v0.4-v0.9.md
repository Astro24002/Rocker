# Rocker Product Roadmap: v0.4.x to v0.9.0

Date: 2026-08-28 (updated 2026-09-11 for v0.5-A through v0.5-D and the deferred runtime-capability boundary)
Status: Maintained product evolution baseline aligned with the approved workspace shell and v0.5.x quality sequence
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
v0.5.1-v0.5.5  UI quality and native-shell closure patches
v0.6.0  Port Forwarding Manager
v0.7.0  SFTP Foundation
v0.8.0  Snippets and workspace productivity
v0.9.0  Release candidate hardening
```

Every version is independently releasable. A later version must not silently
change the security or ownership guarantees established by an earlier one.
`v0.5.0` is the capability milestone; `v0.5.1` through `v0.5.5` are ordered
quality and integration patches within the same product line. The product owner
controls whether and when each patch tag is published.

## Audited Status at 2026-09-11

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
| Hosts | Working tree / v0.5-A through v0.5-D implemented | Compact cards, bounded direct SSH entry, the shared New/Edit drawer, exact group/environment/tag filtering, safe duplicate/favorite/remove actions, Recent Hosts, production deletion warnings, explicit fresh-transport connection testing, and App-level save error propagation are implemented and locally verified. Runtime metadata application is intentionally deferred; scale benchmarking is non-blocking engineering evidence. |
| Host Key trust | Working tree / v0.5-B and v0.5-D integration implemented | First-use and changed-key verification, persistence, a user-facing Trust inventory, bounded audit history, expected-fingerprint removal, owner-scoped management IPC, and shared Host Key checks for Connection Test are implemented and locally verified. Re-trust remains the existing native confirmation path; release packaging and native manual checks remain open. |
| Port Forwarding | Partial | Explicit scan, transient Local Forward lifecycle, leases, recovery, and owner cleanup exist. Persistent profiles and the full management workflow do not. |
| History | Partial | List, search, clear, and reconnect exist. Completed-session outcome and elapsed-time recording are not yet closed; current open records use a zero duration. |
| SFTP | Placeholder | The route exists, but no SFTP service, lease kind, IPC contract, file browser, or transfer queue exists. |
| Snippets | Placeholder | The route and Host editor association fields exist, but there is no Snippet store, expansion, preview, or execution path. |
| Named Workspaces | Partial | Automatic Session/split/layout recovery exists. User-named save/restore and forwarding intent do not. |
| Release engineering | Partial | Windows/macOS x64/arm64 packaging and a six-asset release allow-list exist. Signing, notarization, native launch smoke, and final migration/security/performance gates remain v0.9 work. |
| Product documentation | Partial | The roadmap records v0.5-A through v0.5-D and the completed v0.5.1-v0.5.5 quality sequence with design, implementation, and verification records. README still reports v0.4.0, the architecture audit predates Vault/Host work, and release tags remain product-owner controlled. |

The audited pre-v0.5.1 automated baseline is 76 passing test files, one intentionally
skipped soak file, 652 passing tests, and one skipped test. React `act(...)`
warnings remain non-blocking test-hygiene debt. Native Windows/macOS launch
testing is intentionally deferred during the v0 line; the long soak is a v1
gate, not a v0 patch gate.

The v0.5.1 accessibility patch, v0.5.2 localization/protection-form patch,
v0.5.3 platform-aware window-shell patch, v0.5.4 workspace-resilience patch,
and v0.5.5 visual-polish patch are implemented and locally verified in the
working tree. Their release tags remain product-owner controlled. The full
automated gate is 77 passing test files, one intentionally skipped file, 676
passing tests, one skipped test, a passing typecheck, a passing production
build, and a clean diff check. Native launch remains pending by v0 policy and
long-running soak remains a v1 gate.

### Engineering Readiness

The core process boundaries are sound: SSH transports are reused through
owner-scoped leases, PTYs own their own lifecycle, storage has backup/recovery
and validated imports, and forwarding already survives independently of a
Terminal Session. These are suitable foundations for the remaining roadmap.

The coordination layer now needs a size boundary. At this audit, `App.tsx` is
about 1,379 lines and `electron/ipc/register.ts` is about 1,082 lines with 46
IPC registrations. The current Trust slice keeps only a narrow inventory
refresh/removal integration in `App.tsx`; before the v0.5 release boundary,
Hosts and Trust coordination should move behind feature hooks/modules instead
of growing the shell controller. v0.7 must begin with a separate SFTP service,
lease contract, and IPC module. `ConnectionManager` should remain the SSH
transport authority rather than absorb feature-specific file or forwarding
workflows.

The prior Hosts integration defect in which the application shell discarded the
Host save Promise is fixed in the current working tree, with an App-level
failure regression preserving the editor error state. Keep that boundary test
green before releasing the Hosts candidate.

### Release Classification

The working tree currently mixes patch and minor-version scope:

- Correcting the Windows user-data directory casing to `%APPDATA%/Rocker` and
  recording real History duration/outcome are bug fixes suitable for a v0.4.x
  patch chosen by the product owner.
- Compact Host cards, direct SSH entry, the shared Host editor, and new Host
  profile metadata are product capability and belong to the v0.5 line under the
  established version policy.

Do not describe or tag the combined dirty working tree as a completed patch or
completed v0.5 release. Separate the release scopes or finish the current v0.5
capability boundary and its focused verification records first.

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
| Trust | Host Key trust workspace | Working-tree v0.5-B inventory, audit, and expected-fingerprint removal; native re-trust remains the connection confirmation flow. |
| SFTP | Remote file workspace | Reserved destination; placeholder until v0.7. |
| Snippets | Command-library workspace | Reserved destination; placeholder until v0.8. |
| Port Forwarding | Forwarding management workspace | Existing runtime flow; manager workflow planned in v0.6. |
| History | Connection history workspace | Existing local workflow; outcome/duration closeout remains partial. |
| Settings | Device-local preferences and data protection | Existing local workflow. |

The Sidebar order is Hosts, Trust, SFTP, Snippets, Port Forwarding, History,
and Settings. Sessions remain a separate section below product navigation. A
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

The current working tree closes the first v0.5-A Host workflow slice, the
v0.5-B Trust slice, the v0.5-C Host organization slice, and the v0.5-D
Connection Test slice. Groups remain
profile strings rather than managed entities, while exact group/environment/tag
filtering, normalized optional tags, production deletion warnings, safe
duplicate/favorite/remove actions, Recent Hosts derivation, the compact
selected-card action strip, a focused Trust inventory, bounded Host Key audit
history, and expected-fingerprint removal are implemented. The App preserves
rejected Host save Promises so the editor can show a retryable generic error,
and Host/Trust mutations remain owner-scoped and serialized in the main process.
Connection testing now uses a fresh, no-PTY SSH probe with the existing
credential resolver and Host Key confirmation flow; it does not acquire a
lease, register a reusable connection, or add History records.

The Host, Trust, and Connection Test work closes the v0.5.0 capability boundary.
The quality patches in the ordered v0.5.x route remain separate from the
capability milestone. Session security summaries and Host runtime preferences
are intentionally deferred because they cross the Session, connection, Host
Key, IPC, and terminal-output boundaries. Scale validation is retained as
non-blocking engineering evidence rather than a v0.5 product gate. Use
[v0.5-A Host Workflow Verification](../../releases/v0.5-a-host-workflow-verification.md)
and [v0.5-B Trust Verification](../../releases/v0.5-b-trust-verification.md),
plus [v0.5-C Host Organization Verification](../../releases/v0.5-c-host-organization-verification.md)
and [v0.5-D Connection Test Verification](../../releases/v0.5-d-connection-test-verification.md)
for the exact automated evidence and native-manual PENDING checks.

`snippetsEnabled`, `snippetCollection`, `charset`, and `themeColor` in the Host
editor are reserved profile metadata. Snippets have no executable entity model,
and charset/theme values are not applied to terminal decoding or rendering yet.
The UI must not imply otherwise. The fields remain storage-compatible for a
future Session and Terminal Runtime track; they are not v0.5 acceptance items.
Snippet association remains dormant until v0.8.

### Features

- Complete group management, platform marks, favorites, and recent Hosts.
- Host search across name, address, username, group, and tags.
- Environment metadata with filtering and an explicit risk confirmation policy;
  do not add it to the compact card's default information set.
- Duplicate host configuration with credentials excluded by default.
- Explicit Connection Test action with a fresh no-PTY transport, shared Host Key
  confirmation, safe failure categories, and a 30-second maximum probe timeout.
- Trust view showing trusted Host Key metadata and change history. It is a
  focused management view, not a dashboard or telemetry center.
- Host Key removal and re-trust workflow.

### Architecture Impact

- Extend `HostProfile` with optional tags and environment metadata.
- Add a versioned Host Key audit record without storing raw private material.
- Keep credential storage separate from host documents.
- Extract Hosts coordination from the application shell before adding Trust
  workflows; `App.tsx` must not become the permanent feature controller.
- Keep reserved Host profile metadata storage-compatible without exposing
  unsupported runtime behavior as if it were active.

### Acceptance

- Duplicating a host never copies a password or passphrase into the host file.
- Production hosts show a clear confirmation before destructive or risky actions.
- The trust view can explain why a connection was accepted or rejected without
  exposing private key material, credentials, or raw diagnostics.
- Selecting a group uses exact group identity rather than substring matching.
- Delete, duplicate, favorite, and connection-test actions are reachable without
  weakening single-click select and double-click connect behavior.
- Host save failure is covered at the App integration boundary and leaves the
  editor open with an actionable retry state.
- Unsupported runtime preferences are not presented as active behavior.

### Out of Scope

- Cloud host sync, team sharing, secret managers, and new authentication types.

### Exit Decision

Do not declare v0.5 complete because Host fields or cards exist. The v0.5.0
capability milestone closes when Host organization, operations, trust
inspection, and connection testing are delivered and verified. The ordered
v0.5.x quality patches then close their own evidence rows; deferred runtime
capabilities do not block either boundary.

## Deferred Cross-Layer Capability Tracks

These items remain designed product work, but are deliberately excluded from
v0.5 because they change shared runtime contracts:

| Track | Candidate route | Reason for deferral |
| --- | --- | --- |
| Session Security Summary | v0.6+ Session and Security | Requires a stable read-only model spanning Session lifecycle, connection reuse, Host Key trust, and owner-scoped IPC. |
| Host Charset / Terminal Theme Runtime | v0.6+/v0.7+ Terminal Runtime | Changes SSH byte decoding, xterm rendering, channel-generation reset, and reconnect behavior. |
| 1,000-host benchmark | Engineering gate after the list contract is stable | A benchmark is evidence, not a product surface; it should measure the final interaction architecture and must not block v0.5 feature delivery. |

The exact target version for the first two tracks will be selected during the
corresponding large-version design review. Until then, the current Host profile
fields remain backward-compatible metadata and are not claimed to affect active
Sessions.

## v0.5.x: UI Quality and Native Shell Closure

### Purpose

The v0.5 capability work is followed by a bounded quality sequence derived from
the UI audit. These patches do not add a new product surface or change the
Hosts/Trust boundary. They make the approved desktop shell usable with a
keyboard, complete in English and Simplified Chinese, platform-aware, and
resilient at the supported minimum window. Deferred Session security and Host
runtime preferences are explicitly outside this line.

Design and implementation details live in the [v0.5.x UI quality design](2026-09-11-rocker-v0.5-ui-quality-and-native-shell-design.md)
and [v0.5.x implementation plan](../plans/2026-09-11-rocker-v0.5-ui-quality-and-native-shell-implementation-plan.md).

### Ordered Patch Route

| Patch | Focus | Release outcome | Explicit non-goals |
| --- | --- | --- | --- |
| `v0.5.1` | Accessibility and keyboard semantics | Visible focus states, correct selected/expanded semantics, keyboard Host connect, keyboard Session menus, and accessible resize behavior | No new global shortcut family or visual redesign |
| `v0.5.2` | Localization and protection-form clarity | Complete English/简体中文 copy for audited routes plus visible Vault/migration labels, inline errors, and submit feedback | No credential-encryption or migration-format change |
| `v0.5.3` | Native desktop shell | Platform-appropriate Windows/macOS window controls and drag regions while preserving blank Workspace chrome | No native launch/soak release gate or global title bar |
| `v0.5.4` | Workspace interaction resilience | Sidebar collapse/resize, destination switching, Session focus return, and minimum-window layout remain stable without terminal state loss | No new Session metadata, runtime charset/theme behavior, or new destinations |
| `v0.5.5` | Visual polish and desktop resilience | Reduced-motion support, token-only overlays, readable typography, minimum-size header resilience, and visual regression coverage | No new destinations, Host-card information, or deferred runtime capability |

### Release Gates

- Each patch has focused tests for its own behavior before implementation and a
  recorded entry in `docs/releases/v0.5.x-ui-quality-verification.md`.
- Every patch keeps `npm run typecheck`, the full `npm test` suite, the
  production build, and `git diff --check` green before its tag is considered.
- Native Windows/macOS manual checks are recorded when runners are available;
  native launch remains explicitly deferred as a v0 gate when they are not.
- The long-running soak is a v1 release gate and is not pulled into any
  `v0.5.x` patch release.
- A patch may be skipped only when its acceptance evidence is included in a
  later patch without reversing the order of the quality dependencies.

### Out of Scope

SFTP, Snippets execution, Local Terminal, monitoring, Mobile, AI, cloud sync,
ProxyJump, SOCKS5, remote forwarding, Session Security Summary, Host Charset /
Terminal Theme Runtime, 1,000-host product-scale acceptance, a new global
shortcut family, and a redesign of the approved Hosts card information
architecture remain outside the v0.5.x sequence.

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
2. Complete v0.5.0 Hosts and Trust plus the ordered v0.5.x UI quality patches
   before starting SFTP. This closes the Host, credential, verified-key, and
   desktop interaction control plane that every later remote operation depends
   on.
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
