# Rocker

Rocker is a local-first SSH desktop client for Windows and macOS. It combines
host management, multiple terminal sessions, Linux host monitoring, and a
TRAE-style Ports view where remote services are checked only when requested
and forwarded only after an explicit user action.

The implementation is independent of Tabby source code. Rocker uses Electron,
React, xterm.js, and `ssh2`.

## First-release features

- Local host profiles, groups, favorites, and OpenSSH config import.
- Password, private-key file, and SSH Agent authentication.
- First-use host fingerprint confirmation and changed-key blocking.
- Session-level duplicate, rename, horizontal split, and close actions backed by
  real SSH PTY channels.
- Matching sessions in one window reuse a verified SSH connection; new windows
  always create an independent connection.
- User-triggered Linux `ss`/`netstat` port recommendations and controlled local forwarding.
- Expandable CPU, memory, disk, network, and latency summary for the active host.
- Local connection history.
- English UI by default with optional Simplified Chinese.

## v0.4.0 release status

Rocker v0.4.0 is the Terminal Productivity release line. It includes
per-Session terminal search, the shared Command Palette, terminal and Session
context actions, recent-session navigation, and live terminal appearance
settings while preserving SSH, PTY, Host Key, and connection reuse contracts.

The release source uses package version `0.4.0` and tag `v0.4.0`. The GitHub
Actions release workflow publishes only the six Windows/macOS installer and
archive assets produced by the platform runners. Native Windows/macOS startup
coverage remains deferred for the v0 line, and the 30-minute long soak remains
a v1 release gate. See the [verification record](docs/releases/v0.4.0-implementation-verification.md)
and [smoke checklist](docs/releases/v0.4.0-smoke-checklist.md).

SFTP and Snippets are visible navigation placeholders. Cloud sync, mobile
clients, ProxyJump, remote forwarding, and Dynamic SOCKS5 are not part of the
first release.

## Requirements

- Node.js 20 or newer. CI uses Node.js 24.
- npm 10 or newer.
- Windows or macOS to run a native packaged build.

## Development

Install dependencies and launch the Electron development window:

```bash
npm install
npm run dev
```

Build all Electron process bundles without packaging:

```bash
npm run build
```

## Quality checks

```bash
npm test
npm run typecheck
npm run build
```

The test suite includes connection and terminal lifecycle fakes, host-key
verification, encrypted storage boundaries, Linux port/metric parsing,
forwarding lifecycle, state models, localization, and packaging metadata.

## Packaging

Build a Windows NSIS installer on Windows:

```bash
npm run dist:win
```

Build macOS DMG and ZIP artifacts on macOS:

```bash
npm run dist:mac
```

Apple code signing/notarization and Windows code signing require platform
credentials and are intentionally not enabled in local development builds.

## Local data

Rocker writes host metadata, settings, accepted host fingerprints, and
connection history under Electron's per-user application data directory:

- Windows: `%APPDATA%/Rocker`
- macOS: `~/Library/Application Support/Rocker`

Passwords and private-key passphrases are encrypted with Electron `safeStorage`
(DPAPI on Windows and Keychain-backed protection on macOS). Private key files are
not copied into Rocker; only their paths are stored.

## Project structure

```text
electron/        Electron main/preload, SSH, ports, monitoring, storage, IPC
src/             React renderer, features, localization, and desktop styles
tests/           Main-process, parser, storage, and packaging tests
build/           Rocker application icon resources
docs/            Approved product design and implementation plan
```
