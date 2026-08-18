# Rocker Session and Unified Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace terminal tabs with security-aware sessions, connection reuse, explicit port-forward recommendations, and a unified frameless desktop window.

**Architecture:** The main process separates reusable SSH connections from shell channels and scopes reuse by BrowserWindow plus a sanitized security-context key. The renderer stores session/pane state and exposes session actions through the sidebar; port discovery remains explicit and forwarding is owned by a connection. Electron uses a custom dark window chrome with no native white title-bar band.

**Tech Stack:** Electron, React, TypeScript, `ssh2`, xterm.js, Vitest, electron-builder.

**Spec:** `docs/superpowers/specs/2026-08-18-rocker-session-window-design.md`

## Global Constraints

- Product remains a Windows/macOS desktop app; no mobile UI is added.
- Reuse is allowed only in the current BrowserWindow when host revision, authentication method, credential/identity context, and verified host fingerprint all match.
- New-window duplication always uses a new SSH connection.
- Port discovery is explicit; discovered ports are recommendations and never auto-forward.
- The top terminal tab strip and sidebar utility toolbar are removed.
- Settings is a normal sidebar destination and owns application preferences.
- Existing credential encryption, host-key verification, IPC validation, and Linux probe restrictions remain mandatory.
- Release version for this feature is `0.2.0`; installer filenames keep the existing versionless convention.

### Task 1: Refactor SSH Manager Into Connections and Channels

**Files:**
- Modify: `electron/ssh/ssh-manager.ts`
- Modify: `electron/ports/forwarding-manager.ts`
- Modify: `electron/ports/port-service.ts`
- Modify: `electron/ipc/bridge-contract.ts`
- Modify: `electron/ipc/register.ts`
- Test: `tests/ssh-session.test.ts`
- Test: `tests/forwarding-manager.test.ts`

**Interfaces:**
- `SshManager.open(request, options?: { windowId?: number; forceNewConnection?: boolean }): Promise<SessionInfo>`
- `SessionInfo` includes `connectionId` in addition to `sessionId` and `hostId`.
- `SshManager.getClientForConnection(connectionId: string): Client`
- `SshManager.close(sessionId)` closes one channel and releases its connection when unused.
- `ForwardingManager.start(connectionId, spec)` and `stopForConnection(connectionId)` own listeners by connection.

- [ ] Write failing tests for two sessions sharing one client in one window, a forced new connection, and cleanup after the final channel closes.
- [ ] Run the focused SSH and forwarding tests and confirm failure against the current one-client-per-tab implementation.
- [ ] Implement connection records with a verified fingerprint and security-context key; create one shell channel record per session and fan out client events to the owning session.
- [ ] Update reconnect and close behavior so channel close does not close a shared client until its reference count reaches zero.
- [ ] Change forwarding and port service APIs to use `connectionId`, preserving main-process validation.
- [ ] Run focused tests and typecheck; commit `feat: separate ssh connections from terminal sessions`.

### Task 2: Add Session Reducer and Session-Level Actions

**Files:**
- Modify: `src/features/terminal/session-state.ts`
- Modify: `src/features/terminal/session-state.test.ts`
- Modify: `src/app/types.ts`
- Modify: `electron/ipc/bridge-contract.ts`
- Modify: `electron/ipc/register.ts`

**Interfaces:**
- `WorkspaceSession` contains `id`, `hostId`, `connectionId?`, `sessionId?`, `label`, `state`, `output`, and `paneId`.
- Reducer helpers: `duplicateSession`, `renameSession`, `splitSession`, `closeSession`.
- Session actions are local renderer state except `duplicate in a new window`, which invokes a typed main-process window command.

- [ ] Add reducer tests for duplicate, rename, horizontal split, close-neighbor selection, and disconnected output retention.
- [ ] Run the reducer tests to verify the new expectations fail.
- [ ] Implement the reducer without retaining tab-specific names or top-strip assumptions.
- [ ] Add IPC contracts for `sessions.duplicate`, `sessions.newWindow`, and session metadata updates with strict id validation.
- [ ] Run reducer, IPC, and type tests; commit `feat: model terminal work as sessions`.

### Task 3: Replace Terminal Tabs With Sidebar Sessions and Split Workspace

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/features/terminal/TerminalWorkspace.tsx`
- Modify: `src/features/terminal/TerminalView.tsx`
- Delete or replace: `src/features/terminal/TerminalTabs.tsx`
- Modify: `src/styles/layout.css`
- Modify: `src/styles/components.css`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Sidebar receives `WorkspaceSession[]` and callbacks for duplicate, new-window duplicate, rename, split, and close.
- Terminal workspace receives the active session layout and renders one or two horizontal panes.
- Context menu actions call the reducer/bridge operations and never render a tab strip.

- [ ] Add renderer tests asserting no terminal tab strip and that each session row exposes the five session actions.
- [ ] Run the renderer tests and confirm they fail with the current tab UI.
- [ ] Implement sidebar session context menus, inline rename, and active-session navigation.
- [ ] Implement horizontal pane layout with stable dimensions and per-pane xterm instances.
- [ ] Update close/disconnect/reconnect/input/resize handlers to target shell session ids while forwarding and monitoring use connection ids.
- [ ] Run renderer tests, full unit tests, and typecheck; commit `feat: add session workspace interactions`.

### Task 4: Make Port Forwarding Explicit and Connection-Scoped

**Files:**
- Modify: `src/features/ports/PortsView.tsx`
- Modify: `src/features/ports/port-state.ts`
- Modify: `src/features/ports/port-state.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh-CN.ts`

**Interfaces:**
- Ports view starts with `idle` state and a user-triggered `scan` action.
- A scan produces `DiscoveredPort` recommendation rows without calling `ports.start`.
- Forwarding list is filtered by `connectionId` and remains active across shell-session changes on that connection.

- [ ] Add tests proving mount state does not scan and applying recommendations does not create forwarding records.
- [ ] Run focused port tests and confirm failure against mount-time scan behavior.
- [ ] Remove the mount-time scan side effect, add explicit scan copy, and retain per-port editable local port fields.
- [ ] Update forwarding calls and empty/error states to refer to the active connection, not only the active shell session.
- [ ] Run focused ports tests and typecheck; commit `feat: make port forwarding user-confirmed`.

### Task 5: Implement Unified Frameless Window and Settings Ownership

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/ipc/bridge-contract.ts`
- Modify: `electron/ipc/register.ts`
- Modify: `electron/preload.ts`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/features/settings/SettingsView.tsx`
- Modify: `src/styles/base.css`
- Modify: `src/styles/layout.css`
- Modify: `src/styles/components.css`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh-CN.ts`
- Test: `tests/scaffold.test.ts`

**Interfaces:**
- `BrowserWindow` uses a unified dark custom chrome with platform window controls and no native white title-bar content.
- Main process can create a new window for duplicate-in-new-window and pass only sanitized launch metadata after ready.
- Settings page owns appearance, language, terminal, connection, port recommendation, and window sections.

- [ ] Add shell tests for frameless/window metadata and absence of the old sidebar utility toolbar.
- [ ] Run the shell tests and confirm failure against the current native-window/toolbar implementation.
- [ ] Configure the custom window chrome and typed window-control/new-window IPC while retaining context isolation and sandboxing.
- [ ] Remove the top utility row and add the Settings destination/content sections.
- [ ] Verify the screenshot-aligned dark surface at the existing minimum dimensions; run renderer tests and typecheck.
- [ ] Commit `feat: add unified desktop window shell`.

### Task 6: End-to-End Verification and v0.2.0 Release

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `.github/workflows/build.yml` only if release metadata needs the new version.

- [ ] Update package and lock versions to `0.2.0` without changing versionless installer filenames.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build` and inspect all output for failures.
- [ ] Run the Linux directory packaging smoke check and validate the resulting archive contents do not include renderer source maps, docs, or internal debug executables.
- [ ] Commit `release: prepare v0.2.0`.
- [ ] Push `main`, create and push tag `v0.2.0`, monitor Windows/macOS CI, and verify the Release contains only `Rocker-x64/arm64` `.exe`, `.dmg`, and `.zip` assets.

