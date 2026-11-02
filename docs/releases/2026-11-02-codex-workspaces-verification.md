# Codex Workspaces verification

Baseline HEAD: `152cc0f5e888e8ddf0beff9c3cc80a86967b799b`.
Implementation branch: `feature/workspaces-codex`. Subsequent prerelease tracking: [v0.8.1-rc.4](v0.8.1-rc.4-verification.md). Main is not pushed.

## Automated evidence

- `npx tsc --noEmit`: passes.
- `npm test -- --run`: 897 passed, 2 skipped; 93 test files passed and 1 skipped. The installed-Codex smoke is opt-in and was also run separately as recorded below.
- `npm run build`: Electron main, preload, and renderer build successfully.
- `ROCKER_CODEX_SMOKE=1 npx vitest run --project=electron electron/workbench`: 18 tests pass, including the installed Codex smoke.

The installed Codex test creates an ephemeral thread, opens a standalone PTY, checks streamed output, writes a harmless printf command, resizes, terminates, and closes the transport. It runs once locally and once through an actual SSH protocol connection to the local fixture, where the server starts the installed Codex binary. It does not submit a model turn or modify project files.

## Acceptance coverage

| Behavior | Evidence |
| --- | --- |
| Local / Remote / Cloud profile cards and configuration | React form tests; browser layout and interaction check |
| Default graphical conversation; optional terminal | App routing tests; component tests; actual app-server PTY smoke |
| Independent threads and windows' runtime ownership | Service tests with distinct IDs and renderer generations |
| Switching does not reconnect or close tasks | Component rerender/unmount tests and App navigation test |
| Pending storage/connection cancellation | Service tests for close, renderer release, window release, and Host deletion |
| Approvals, structured input, unsupported server requests | Service tests; approval UI tests |
| SSH exec without PTY, safe path quoting, isolated lease cleanup | SSH transport integration test preserving a sibling terminal lease |
| Disconnect, explicit resume, no task replay | Service protocol tests |
| Fragmented UTF-8, invalid JSON, output limit, request timeout | RPC tests; terminal decoder test |
| Narrow IPC ownership/validation boundary | IPC handler test |
| Close one session, retain another, cancel background close | App tests plus mixed SSH/SFTP/PF/Codex state tests |
| Existing SSH/SFTP/PF behavior | Full repository test suite |

## Browser inspection

Actual React components and styles were checked in headless Chromium at 1440 x 900 and 1040 x 680. The test exercises card selection/opening, native dialog layout, directory selection, save, conversation input, navigation away/back, and creating a second session. No page errors or horizontal overflow were observed; at 1040px the composer remains within the viewport.

Local screenshots: `/tmp/rocker-workbench-evidence/workspaces.png`, `workspace-dialog.png`, `workbench.png`, `workbench-narrow.png`. The browser's conversation explicitly identifies its test fixture. These screenshots verify UI only.

## Outstanding external acceptance

Real model execution with an authenticated account, approval of a real command/file edit, native Windows/macOS installation/use, actual external SSH disconnection/reconnection, and OS-level close confirmations remain to be accepted before a stable release. No such acceptance is inferred from browser fixtures or the loopback SSH smoke. Packaging is verified separately by the prerelease workflow.

Implementation and setup: [Workspace integration design](../superpowers/specs/2026-11-02-codex-workspaces-integration.md).
