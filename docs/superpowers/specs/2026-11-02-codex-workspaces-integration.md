# Workspace / Codex Workbench integration

Status: implemented on `feature/workspaces-codex`; published in v0.8.1-rc.4 (prerelease).
Baseline: `152cc0f5e888e8ddf0beff9c3cc80a86967b799b` (v0.8.1-rc.3 follow-up).

## Product behavior

- Workspace is a functional navigation destination containing project cards.
- A profile combines Local, Remote, or Cloud, a project directory, a Codex executable, and an SSH Host when needed.
- Cloud means a supplied SSH environment saved in Hosts, not the OpenAI Codex Cloud service. Rocker does not provision cloud machines.
- Single click selects a card; double click, Enter, or Open opens its graphical Codex conversation. Reopening the card selects its existing session. New session creates an independent conversation.
- All open sessions use the existing unified sidebar. CODE identifies a Codex session; the activity dot reflects a running task. Workspace navigation and individual sessions have separate selection states.
- Terminal is optional and initially closed. Opening it starts a separate shell inside the same target environment, without replacing or interrupting the Codex conversation.
- Switching destinations preserves the process, conversation, draft, and terminal output. No process lifecycle is attached to React unmount.
- Closing an active task requires confirmation. Cancel retains the session and task; closing the foreground session this way returns to Workspace. Cancelling a background session's close preserves the current view.
- Native window close and application quit also confirm active Codex tasks. Renderer destruction releases its owned processes and leases.
- Connection errors require an explicit reconnect. The previous thread is resumed when available; Rocker never replays the user's last task automatically.

## Runtime and protocol

`electron/workbench/service.ts` owns Codex processes, threads, approval requests, and optional PTYs. Ownership uses the existing webContents ID plus renderer generation.

Local runs `codex app-server --listen stdio://` as a child process in the chosen directory. Remote and Cloud use the existing `SshConnectionManager` and a dedicated `codex` lease. They execute Codex over an SSH exec channel without PTY. Shell paths and executable paths are quoted; renderer strings are not interpolated as unquoted shell fragments.

The NDJSON adapter handles initialization, thread start/resume, turn start/interrupt, message/tool events, command/file approvals, and structured input questions. Unknown server requests return a protocol error, never implicit approval. Pending calls fail on disconnect or protocol timeout. Messages and terminal history are bounded, and snapshot revisions reject stale renderer updates.

The optional terminal uses the app-server's separate `command/exec` PTY API and the existing xterm dependency. Write, resize, and terminate affect that shell only. Remote targets currently require a POSIX shell. The terminal uses Codex's configured command sandbox; it does not grant unrestricted remote shell access.

The preload exposes typed `workbench` operations through a narrow IPC dispatcher. The main process derives ownership from the IPC sender and validates inputs. There is no renderer-accessible generic app-server RPC proxy.

## Setup and compatibility

Validated protocol: Codex CLI **0.165.0**, using its generated TypeScript schema and actual app-server.

Install and sign in to Codex on the execution machine before opening the workspace. For Remote/Cloud, that is the SSH target. Credentials are neither copied from the local machine nor stored in the new profile file. If the desktop or noninteractive SSH PATH does not locate Codex, enter its absolute executable path. Project directories must already exist; use an absolute path, not a shell expression such as `~` or `$HOME`.

On Windows the transport supports the standard npm `codex.cmd` shim by invoking its Codex JavaScript entry with Electron in Node mode, avoiding shell interpolation. This branch has not yet received native Windows/macOS installation acceptance.

References:

- [OpenAI app-server documentation](https://learn.chatgpt.com/docs/app-server)
- [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)

The app-server protocol includes experimental APIs. Versions other than the validated version require compatibility testing, especially the optional PTY methods.

## Storage and migration

- New `workbenches.json`, schema `{ version: 1, profiles: [...] }`, uses the existing atomic JSON store and diagnostics.
- Existing Hosts, credentials, Settings, SSH/SFTP/PF configuration, and workspace snapshot formats are unchanged. No migration is required.
- The new runtime `kind: "codex"` is excluded from legacy session serialization. Existing records without `kind` continue to mean SSH.
- Rocker does not restore Codex sessions across application restarts. Profiles remain available. Codex may keep its own thread history on the execution machine, according to its configuration.
- Removing a workspace profile does not terminate its already-open sessions. Removing a Host releases that Host's Codex leases, alongside the existing Host cleanup.

## Limits and further acceptance

- Native Windows/macOS installation, external production SSH targets, and real authenticated model turns still require acceptance. A loopback SSH fixture is not an external-host acceptance test.
- No in-app Codex login manager, model picker, historical thread browser, diff editor, or image attachment UI is included in this increment.
- Workbench profiles are not included in the existing configuration export/import bundle yet.
- Duplicate in a new window is disabled for Codex sessions; New session creates a separate thread in the current window. Existing SSH/PF/SFTP window duplication is unchanged.
- Browser previews cannot launch local or remote processes. Browser UI verification uses an explicitly labeled fixture and is not evidence of real inference or SSH execution.
- Release tracking is separate: [v0.8.1-rc.4 verification](../../releases/v0.8.1-rc.4-verification.md). Main is not pushed as part of that release.
