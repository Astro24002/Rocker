# Rocker Architecture Audit

Date: 2026-08-28

## Current Runtime Shape

```text
electron/main.ts
  -> WorkspaceWindowManager
  -> IpcDependencies
       -> SshConnectionManager
       -> TerminalSessionManager
       -> ForwardingManager
       -> PortService
       -> LinuxMetricsSampler
       -> storage stores

electron/preload.ts
  -> typed context-isolated RockerBridge

src/app/App.tsx
  -> workspace/session state
  -> TerminalWorkspace / PortsView / SettingsView / HistoryView
```

The main process owns SSH clients, PTY channels, port listeners, host-key
verification, credentials, and persistent data. The renderer owns display
state and xterm controllers; it does not accumulate terminal output.

## Ownership Rules

- One verified SSH connection may serve multiple terminal leases in one
  window when host, credentials, and host-key identity match.
- Terminal sessions own PTY channels and release their connection lease when
  closed or when the renderer owner disappears.
- Port forwards own independent forwarding leases and remain listable while
  suspended, even when no terminal is active.
- Window close, renderer reload, and application shutdown release renderer
  resources and flush native window bounds.

## Removed Legacy Code

- `electron/ssh/ssh-manager.ts`: superseded by the lease-based connection and
  terminal managers; it had no production imports.
- `tests/ssh-session.test.ts`: tests for the removed manager.
- `src/components/SessionTabs.tsx`: unused tab UI left over from the earlier
  tab-based design; Rocker now models independent sessions.

Historical design documents remain under `docs/superpowers/` as project
history. They are not runtime dependencies.

## Verification

- `npm test`: full Vitest suite passes.
- `npm run typecheck`: strict TypeScript check passes.
- `npm run build`: Electron main, preload, and renderer bundles build.
- `git diff --check`: no whitespace errors.

## Follow-up Risks

- There is no dedicated lint script; formatting and static checks are covered
  by TypeScript and the test suite today.
- `out/` and `release/` are generated and ignored. They should not be checked
  into source control or used as release inputs without a fresh build.
- The historical live SSH-server test was tied to the removed manager. The
  current suite covers the new managers with deterministic transport fakes;
  adding a live-server integration test for the new manager is a useful future
  hardening task.
