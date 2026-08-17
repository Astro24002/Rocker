# Rocker Desktop SSH Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Docker runtime project with a local-first Rocker Electron desktop SSH client for Windows and macOS, including host management, multi-tab terminals, TRAE-style port discovery/forwarding, and an expandable current-host monitor.

**Architecture:** Electron main process owns SSH, PTY, port forwarding, host persistence, encryption, and monitoring. A context-isolated preload exposes typed IPC APIs to a React renderer, which renders the resizable Termius-inspired workspace and xterm.js terminals.

**Tech Stack:** Electron, React, TypeScript, Vite, electron-vite, `ssh2`, `@xterm/xterm`, `@xterm/addon-fit`, `lucide-react`, Vitest, jsdom, Testing Library, electron-builder.

**Spec:** `docs/superpowers/specs/2026-08-17-rocker-desktop-ssh-design.md`

## Global Constraints

- Product name is `Rocker`; repository/package/executable/application identifier use `rocker`.
- Only Windows and macOS desktop targets are supported; no mobile layout or package is generated.
- Default UI language is English; Simplified Chinese is selectable without restarting.
- Host metadata is local-only; credentials use Electron `safeStorage` and never enter renderer state or logs.
- SSH supports password, private-key file, and SSH Agent authentication.
- First-release port behavior is Linux remote-port discovery plus user-initiated SSH local forwarding; no remote forwarding or Dynamic SOCKS5 UI.
- Terminal supports multiple independent tabs and no split panes.
- SFTP and Snippets are navigation placeholders only; History is functional and peer-level with them.
- Sidebar defaults to 220px, is draggable between 180px and 360px, and persists its width.
- Linux is the guaranteed remote platform for port discovery and monitoring; terminal connections may target any SSH server.

## File Map

Create a new root Node project after removing the old Go/React Docker project:

```text
package.json                    # package metadata, scripts, deps, electron-builder config
tsconfig.json                   # shared TypeScript compiler settings
vite.config.ts                  # renderer build and test aliases
electron.vite.config.ts        # main, preload, and renderer bundling
index.html                      # renderer entry document
electron/main.ts                # BrowserWindow, app lifecycle, IPC registration
electron/preload.ts             # context-isolated typed bridge
electron/ipc/*.ts               # IPC request validation and handlers
electron/ssh/*.ts               # SSH connection/session/host-key services
electron/ports/*.ts             # Linux port parser and forwarding manager
electron/monitoring/*.ts        # Linux metric commands and parsers
electron/storage/*.ts            # JSON store and safeStorage credentials
src/main.tsx                     # React renderer entry
src/app/App.tsx                  # shell routing and global state
src/app/types.ts                 # renderer-safe domain contracts
src/app/window.d.ts              # typed window.rocker declaration
src/components/*.tsx             # reusable shell controls
src/features/hosts/*.tsx         # host list and editor drawer
src/features/terminal/*.tsx     # xterm tabs and session state
src/features/ports/*.tsx        # Ports table and actions
src/features/monitoring/*.tsx   # current-host monitor summary
src/features/history/*.tsx      # connection history page
src/features/settings/*.tsx     # settings page
src/i18n/*.ts                    # English and Simplified Chinese dictionaries
src/styles/*.css                 # design tokens and desktop layout
build/icon.svg                   # original Rocker vector mark
tests/*.test.ts                  # main-process and parser tests
README.md                        # desktop development/build instructions
```

## Task 1: Replace the Repository with a Desktop Scaffold

**Files:**
- Delete: old `cmd/`, `internal/`, `web/`, `fixtures/`, `go.mod`, `go.sum`, `Makefile`, the old root `README.md`, and the old Docker-specific files `docs/superpowers/specs/2026-05-07-rocker-mvp-architecture-design.md` and `docs/superpowers/plans/2026-05-07-rocker-mvp-implementation-plan.md`.
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/styles/base.css`, `electron/main.ts`, `electron/preload.ts`, `build/icon.svg`, `README.md`.

**Interfaces:**
- Produces a runnable Electron window loading the Vite renderer and a typed `window.rocker` placeholder bridge for later tasks.

- [ ] **Step 1: Write the failing scaffold smoke test**

Create `tests/scaffold.test.ts` that reads `package.json` and asserts `name === "rocker"`, `build.appId === "rocker"`, and scripts `dev`, `build`, `test`, and `typecheck` exist.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run tests/scaffold.test.ts`

Expected: FAIL because the old repository has no root `package.json`.

- [ ] **Step 3: Remove old project files and create the minimal Electron/Vite scaffold**

Use a root package with scripts `dev: electron-vite dev`, `build: electron-vite build`, `typecheck: tsc --noEmit`, `test: vitest run`, `electron: electron-vite dev`, `dist: npm run build && electron-builder --win --mac`, `dist:win: npm run build && electron-builder --win`, and `dist:mac: npm run build && electron-builder --mac`.

Configure `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `minWidth: 1040`, and `minHeight: 680`. In development load the Vite URL; in production load `dist/index.html`.

- [ ] **Step 4: Run scaffold checks**

Run: `npm install && npm test -- --run tests/scaffold.test.ts && npm run typecheck && npm run build`

Expected: PASS, with a renderer bundle in `dist/`.

- [ ] **Step 5: Commit the scaffold replacement**

Run: `git add -A && git commit -m "chore: replace runtime project with rocker desktop scaffold"`

## Task 2: Define Local Domain Contracts and Secure Storage

**Files:**
- Create: `electron/storage/types.ts`, `electron/storage/json-store.ts`, `electron/storage/credentials.ts`, `electron/storage/host-store.ts`, `src/app/types.ts`.
- Test: `tests/storage.test.ts`, `tests/ssh-config.test.ts`.

**Interfaces:**
- `HostProfile`: `{ id, name, host, port, username, authMethod, identityFile?, group?, favorite, notes }`.
- `ConnectionHistoryItem`: `{ id, hostId, connectedAt, durationMs, outcome }`.
- `CredentialVault.get(hostId, kind): Promise<string | undefined>` and `.set(hostId, kind, value): Promise<void>`.
- `HostStore.list(): Promise<HostProfile[]>`, `.save(profile)`, `.remove(id)`, `.importOpenSSHConfig(text)`.
- `CredentialVault.set(hostId, kind, value)` and `.clear(hostId, kind)` are callable only from main-process IPC handlers; renderer receives no credential values back.

- [ ] **Step 1: Write failing tests for host normalization and credential boundaries**

Test that an imported `Host dev\n  HostName 10.0.0.8\n  User root\n  Port 2222\n  IdentityFile ~/.ssh/id_ed25519` yields a sanitized profile with an expanded identity path; test that serialized host metadata has no password or private-key content; test that missing credentials return `undefined`.

- [ ] **Step 2: Run the focused tests**

Run: `npm test -- --run tests/storage.test.ts tests/ssh-config.test.ts`

Expected: FAIL because storage and parser modules do not exist.

- [ ] **Step 3: Implement storage and OpenSSH config parsing**

Use `app.getPath("userData")/rocker.json` for non-secret state, atomic write via a temporary file plus rename, and strict JSON schemas at load time. Parse `Host`, `HostName`, `Port`, `User`, and `IdentityFile`; skip wildcard entries and preserve unknown directives in the source file only.

Use `safeStorage.encryptString`/`decryptString` behind `CredentialVault`, keyed by host ID and credential kind. In tests inject an in-memory encryption adapter instead of invoking Electron APIs.

- [ ] **Step 4: Run focused and type checks**

Run: `npm test -- --run tests/storage.test.ts tests/ssh-config.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit storage contracts**

Run: `git add electron/storage src/app/types.ts tests && git commit -m "feat: add local host storage and secure credentials"`

## Task 3: Build SSH Sessions and the Typed Preload Bridge

**Files:**
- Create: `electron/ssh/ssh-session.ts`, `electron/ssh/ssh-manager.ts`, `electron/ssh/host-keys.ts`, `electron/ipc/bridge-contract.ts`, `electron/ipc/register.ts`, `electron/preload.ts`.
- Test: `tests/ssh-session.test.ts`, `tests/host-keys.test.ts`, `tests/ipc-validation.test.ts`.

**Interfaces:**
- `SshManager.open(request): Promise<SessionInfo>`.
- `SshManager.write(sessionId, data)`, `.resize(sessionId, cols, rows)`, `.exec(sessionId, command): Promise<string>`, `.close(sessionId)`, `.reconnect(sessionId)`.
- Events: `session:data`, `session:state`, `session:host-key`, `session:error`.
- `window.rocker.sessions.open/write/resize/exec/close` and `window.rocker.events.onSessionEvent`.

- [ ] **Step 1: Write failing mock-server tests**

Start a local `ssh2.Server` with a deterministic host key and shell handler. Assert an opened session emits `connected`, receives shell output, accepts input, resizes, and emits `closed`. Add a test that a host-key mismatch rejects before authentication and a test that IPC rejects invalid session IDs and dimensions.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --run tests/ssh-session.test.ts tests/host-keys.test.ts tests/ipc-validation.test.ts`

Expected: FAIL because the SSH manager and bridge are absent.

- [ ] **Step 3: Implement host-key verification and SSH manager**

Create one `ssh2.Client` and one PTY channel per session. Accept password, `privateKey` loaded from the selected path, or `agent` from `SSH_AUTH_SOCK`. Hash the presented host key with SHA-256, compare with stored fingerprints, and emit a user confirmation request for unknown keys. Reject changed fingerprints until the store explicitly updates them.

Validate all IPC payloads in the main process using small pure guards: ports 1-65535, cols/rows positive and <= 500, data <= 64 KiB per request, and session IDs matching generated IDs.

- [ ] **Step 4: Run the mock-server and type checks**

Run: `npm test -- --run tests/ssh-session.test.ts tests/host-keys.test.ts tests/ipc-validation.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the SSH engine**

Run: `git add electron/ssh electron/ipc electron/preload.ts tests && git commit -m "feat: add secure ssh sessions and ipc bridge"`

## Task 4: Add Linux Port Discovery, Local Forwarding, and Monitoring

**Files:**
- Create: `electron/ports/linux-port-parser.ts`, `electron/ports/forwarding-manager.ts`, `electron/ports/port-service.ts`, `electron/monitoring/linux-metrics.ts`.
- Test: `tests/linux-port-parser.test.ts`, `tests/forwarding-manager.test.ts`, `tests/linux-metrics.test.ts`.

**Interfaces:**
- `parseListeningPorts(output, source): DiscoveredPort[]`.
- `ForwardingManager.start(sessionId, spec): Promise<ForwardingInfo>` and `.stop(forwardingId)`.
- `PortService.scan(sessionId): Promise<DiscoveredPort[]>`.
- `LinuxMetricsSampler.sample(sessionId): Promise<HostMetrics>`.

- [ ] **Step 1: Write failing parser and forwarding tests**

Use fixtures for `ss -ltnp` with IPv4, IPv6, wildcard, process and user fields. Assert normalized port/process/source values. Test forwarding state transitions, cleanup on session close, and deterministic rejection when the local port is already bound. Test metric parsing for `/proc/stat`, `/proc/meminfo`, `df -P`, and unavailable fields.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npm test -- --run tests/linux-port-parser.test.ts tests/forwarding-manager.test.ts tests/linux-metrics.test.ts`

Expected: FAIL because the port and monitoring modules do not exist.

- [ ] **Step 3: Implement fixed remote probes and forwarding**

Run only fixed commands through `ssh.exec`: `ss -ltnp`, then `netstat -ltnp`; do not interpolate host-provided strings. Parse process names and users when present, mark missing values as unavailable, and label source as `ss`, `netstat`, or `manual`.

For each forward, bind the requested local address and port with Node `net.createServer`; for each socket call `client.forwardOut` to the remote bind address and port. Track `discovered`, `starting`, `forwarding`, `stopping`, `stopped`, and `error`. Stop all listeners when their session closes.

Sample fixed Linux metrics at the configured interval; retain the previous sample for CPU and network deltas, and return availability states instead of fake zeroes.

- [ ] **Step 4: Run focused tests and type checks**

Run: `npm test -- --run tests/linux-port-parser.test.ts tests/forwarding-manager.test.ts tests/linux-metrics.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit port and monitoring services**

Run: `git add electron/ports electron/monitoring tests && git commit -m "feat: discover ports and monitor linux hosts"`

## Task 5: Build the Renderer Shell and Visual System

**Files:**
- Create: `src/app/App.tsx`, `src/components/Sidebar.tsx`, `src/components/NavItem.tsx`, `src/components/SessionTabs.tsx`, `src/components/IconButton.tsx`, `src/styles/tokens.css`, `src/styles/layout.css`, `src/styles/components.css`, `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/index.ts`.
- Modify: `src/main.tsx`, `index.html`, `package.json`.
- Test: `tests/i18n.test.ts`, `src/app/App.test.tsx`.

**Interfaces:**
- `App` consumes `window.rocker` and produces the desktop workspace.
- `useI18n()` returns `{ locale, setLocale, t }`.
- `Sidebar` accepts `{ width, onWidthChange, activeNav, onNavigate }`.

- [ ] **Step 1: Write failing renderer and i18n tests**

Assert English is the default, Simplified Chinese can switch without reload, every navigation key has both translations, and sidebar width clamps to 180-360.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --run tests/i18n.test.ts src/app/App.test.tsx`

Expected: FAIL because renderer components and dictionaries do not exist.

- [ ] **Step 3: Implement the reference layout**

Use a dark terminal-first shell inspired by the committed reference image. Build a draggable sidebar with a 4px resize hit target, workspace selector, Hosts/SFTP/Port Forwarding/Snippets/History navigation, current-host monitor summary, and a main workspace with session tabs. Use `lucide-react` icons inside icon buttons and add tooltips with `aria-label`/`title` for unfamiliar actions. Keep the terminal area unframed and avoid nested cards.

Use CSS grid/flex dimensions rather than viewport-scaled fonts. Persist sidebar width and selected locale through the preload settings API, with an in-memory fallback for browser tests.

- [ ] **Step 4: Run renderer tests, build, and type checks**

Run: `npm test -- --run tests/i18n.test.ts src/app/App.test.tsx && npm run typecheck && npm run build`

Expected: PASS and a production renderer bundle.

- [ ] **Step 5: Commit the renderer shell**

Run: `git add src package.json index.html tests && git commit -m "feat: add rocker desktop workspace shell"`

## Task 6: Implement Hosts, Host Editor, History, and Session Tabs

**Files:**
- Create: `src/features/hosts/HostList.tsx`, `src/features/hosts/HostEditor.tsx`, `src/features/hosts/host-state.ts`, `src/features/history/HistoryView.tsx`, `src/features/terminal/TerminalTabs.tsx`, `src/features/terminal/TerminalView.tsx`, `src/features/terminal/session-state.ts`.
- Modify: `src/app/App.tsx`, `electron/ipc/register.ts`, `electron/storage/host-store.ts`.
- Test: `src/features/hosts/host-state.test.ts`, `src/features/terminal/session-state.test.ts`.

**Interfaces:**
- Host actions: `createHost`, `updateHost`, `duplicateHost`, `deleteHost`, `toggleFavorite`, `importSshConfig`.
- Session state: `openTab(hostId)`, `closeTab(sessionId)`, `activateTab(sessionId)`, `reconnectTab(sessionId)`.

- [ ] **Step 1: Write failing host and tab state tests**

Test CRUD and favorite behavior, group filtering, imported host display, independent tab IDs, active-tab fallback after close, and retention of terminal output after a disconnect.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npm test -- --run src/features/hosts/host-state.test.ts src/features/terminal/session-state.test.ts`

Expected: FAIL because feature state modules do not exist.

- [ ] **Step 3: Implement host list/editor and history**

Render host rows with name, user, address, last state, favorite, and more actions. Use a right-side drawer for create/edit, with password/passphrase inputs sent directly to the credential API and then cleared. Import SSH config through a file picker in the main process, then show a reviewable list before saving.

Render History as a peer navigation page with search, date, host, duration, and outcome. Add quick reconnect without duplicating credentials into history records.

- [ ] **Step 4: Implement xterm.js session tabs**

Create one `Terminal` and `FitAddon` per tab, attach session event listeners by session ID, send `onData` and `onResize` through preload, and dispose terminal resources on tab close. Use explicit states `connecting`, `connected`, `disconnected`, `error`, and `reconnecting`.

- [ ] **Step 5: Run focused tests, build, and type checks**

Run: `npm test -- --run src/features/hosts/host-state.test.ts src/features/terminal/session-state.test.ts && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit hosts and terminal tabs**

Run: `git add src/features/hosts src/features/history src/features/terminal src/app electron tests && git commit -m "feat: add host management history and terminal tabs"`

## Task 7: Implement Ports, Monitoring, Settings, and Placeholder Navigation

**Files:**
- Create: `src/features/ports/PortsView.tsx`, `src/features/ports/port-state.ts`, `src/features/monitoring/MonitorSummary.tsx`, `src/features/monitoring/monitor-state.ts`, `src/features/settings/SettingsView.tsx`, `src/components/ComingSoonView.tsx`.
- Modify: `src/app/App.tsx`, `src/components/Sidebar.tsx`, `electron/ipc/register.ts`.
- Test: `src/features/ports/port-state.test.ts`, `src/features/monitoring/monitor-state.test.ts`.

**Interfaces:**
- Port state consumes `DiscoveredPort` and `ForwardingInfo` events and exposes `forward`, `stop`, `copyAddress`, `openAddress`.
- Monitor state consumes `HostMetrics` events and exposes `expanded`, `toggleExpanded`, and `refresh`.

- [ ] **Step 1: Write failing ports and monitor state tests**

Assert discovered ports do not become forwarding automatically, forward/stop actions update state, errors retain the remote record, monitor summaries collapse by default, and unavailable metrics render as unavailable rather than zero.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npm test -- --run src/features/ports/port-state.test.ts src/features/monitoring/monitor-state.test.ts`

Expected: FAIL because feature state modules do not exist.

- [ ] **Step 3: Implement the Ports view**

Render the dense TRAE-style table with Port, Forwarded address, Process, Source, User, Status, and actions. Show a clear empty state, scan progress, unsupported probe state, and local conflict error. Forwarding requires an explicit click and uses a user-selected local port, defaulting to the same port only when available.

- [ ] **Step 4: Implement the current-host monitor and settings**

Render the compact collapsed summary in the sidebar and an expandable details popover/section with latency, CPU, memory, disk, network, and sample time. Build Settings for language, font, timeout, reconnect, scan interval, and bind address using the same typed settings API.

- [ ] **Step 5: Implement SFTP and Snippets placeholders**

Make both navigation entries selectable and render `ComingSoonView` with a concise English/Chinese message. Do not create fake file or snippet data.

- [ ] **Step 6: Run focused tests, build, and type checks**

Run: `npm test -- --run src/features/ports/port-state.test.ts src/features/monitoring/monitor-state.test.ts && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit ports and supporting views**

Run: `git add src/features/ports src/features/monitoring src/features/settings src/components src/app electron tests && git commit -m "feat: add ports monitor settings and navigation states"`

## Task 8: Packaging, Build Metadata, and Documentation

**Files:**
- Modify: `package.json`, `electron/main.ts`, `README.md`, `vite.config.ts`.
- Create: `electron-builder.yml`, `.github/workflows/build.yml`, `build/icon.svg` if not already present.

**Interfaces:**
- `npm run dist:win` generates a Windows installer target.
- `npm run dist:mac` generates a macOS DMG/ZIP target.

- [ ] **Step 1: Write a packaging metadata test**

Assert the builder config has `appId: "rocker"`, `productName: "Rocker"`, Windows `nsis` target, macOS `dmg` and `zip` targets, and excludes Linux/mobile targets.

- [ ] **Step 2: Run it to verify failure**

Run: `npm test -- --run tests/packaging.test.ts`

Expected: FAIL until builder metadata exists.

- [ ] **Step 3: Configure package targets and original icon**

Set `appId` and executable name to `rocker`, product display name to `Rocker`, minimum window constraints, and icon paths. Configure Windows NSIS and macOS DMG/ZIP for x64 and arm64 where supported. Keep signing/notarization variables unset in local builds.

- [ ] **Step 4: Document development and platform build commands**

README must include Node version floor, `npm install`, renderer development, Electron development, tests, typecheck, Windows packaging, macOS packaging, local data location, and the fact that signing/notarization require platform credentials.

- [ ] **Step 5: Run packaging metadata and all static checks**

Run: `npm test -- --run tests/packaging.test.ts && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit packaging and docs**

Run: `git add package.json electron-builder.yml .github README.md build && git commit -m "build: configure rocker windows and macos packaging"`

## Task 9: End-to-End Verification and Cleanup

**Files:**
- Modify: any source files required by verified failures; `docs/superpowers/plans/2026-08-17-rocker-desktop-ssh.md` checkboxes.
- Test: all `tests/**/*.test.ts` and renderer tests.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test -- --run && npm run typecheck && npm run build`

Expected: all tests pass and Vite emits a production bundle.

- [ ] **Step 2: Run Electron smoke verification**

Run: `npm run electron` with a local mock SSH server fixture. Verify app startup, sidebar resize persistence, host creation, two independent terminal tabs, disconnect/reconnect, port discovery without auto-forwarding, forward/stop, monitor expand/collapse, History, and SFTP/Snippets placeholder views.

- [ ] **Step 3: Run the production packaging commands available on the current host**

Run: `npm run dist:win` and `npm run dist:mac` when the local host/toolchain supports them; otherwise run electron-builder metadata validation and document the platform limitation without claiming a native installer was produced.

- [ ] **Step 4: Review the final diff for forbidden scope**

Run: `git diff --stat main...HEAD`, `rg -n "docker|compose|mobile|TODO|TBD" --glob '!docs/superpowers/specs/**' --glob '!docs/superpowers/plans/**'`.

Expected: no old Docker implementation remains, no mobile package is configured, and no unfinished placeholder exists outside the explicitly approved SFTP/Snippets views.

- [ ] **Step 5: Commit verification fixes and update the plan**

Run: `git add -A && git commit -m "test: verify rocker desktop acceptance criteria"`.

Mark every completed checkbox in this plan and record any platform-only packaging checks in the final handoff.
