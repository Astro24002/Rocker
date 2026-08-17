# Rocker

Rocker is a local-first SSH desktop client for Windows and macOS. It provides
host management, multiple terminal tabs, and a TRAE-style remote port view with
user-controlled local forwarding.

The first release is independent of Tabby source code and uses Electron,
React, xterm.js, and `ssh2`.

## Development

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Run the test suite and production build:

```bash
npm test
npm run typecheck
npm run build
```

## Packaging

Package targets are limited to Windows and macOS:

```bash
npm run dist:win
npm run dist:mac
```

Native signing and macOS notarization require platform credentials and are not
enabled in local builds.

## Local data

Host metadata, settings, and connection history live in Electron's per-user
application data directory. Passwords and private-key passphrases are stored
through the platform-backed Electron `safeStorage` API.

SFTP and Snippets are navigation placeholders in the first release. Terminal
split panes, cloud sync, mobile clients, remote forwarding, and Dynamic SOCKS5
are intentionally out of scope.
