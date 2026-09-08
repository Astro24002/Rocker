# Rocker Local-First Data Protection Design

Date: 2026-09-08

Status: Implemented for the v0 desktop scope

Scope: Rocker desktop application for Windows and macOS

## 1. Product Decision

Rocker uses a local-first data model. The application must be usable without an
account or network service. Sensitive credentials use the operating system
credential protection by default, while users may opt into a portable encrypted
Vault. Configuration can be exported as either a non-sensitive template or an
encrypted migration bundle that can be imported on another Rocker installation.

This design does not introduce cloud sync, a Rocker account, or remote backup.

## 2. Threat Model and Goals

The data protection model addresses two different risks:

1. Confidentiality: passwords, private keys, and passphrases must not be stored
   as readable JSON or included in diagnostics and ordinary exports.
2. Integrity and availability: a failed read or interrupted write must not
   silently replace valid local data with an empty/default document.

The model is not intended to recover a forgotten Vault password, restore a
remote shell process, or guarantee recovery from a physically lost device.

## 3. Storage Tiers

### 3.1 Tier A: Security-Critical Data

Includes:

- password and private-key passphrase values;
- private-key material when Rocker owns the material rather than a file path;
- verified SSH host-key fingerprints;
- host profiles when they contain credential references that must remain
  consistent.

Rules:

- Use Electron `safeStorage` backed by the operating system credential store in
  the default mode.
- Never fall back to plaintext JSON when platform encryption is unavailable.
- A read, decrypt, or integrity failure is fail-closed for the affected
  operation; never silently reset the store.
- Diagnostics contain store status and sanitized reason only, never values,
  fingerprints, or absolute credential paths.

### 3.2 Tier B: Recoverable Application Data

Includes workspace layout, window bounds, settings, connection history,
Snippets, and non-sensitive host metadata.

Rules:

- Keep atomic same-directory writes and one or more validated backups.
- On read failure, attempt a valid backup before quarantining or rebuilding the
  primary file.
- If only workspace persistence fails, keep the running terminal usable in
  memory and show that later changes will not be saved.
- Default values may be used only after the user-visible recovery state has been
  recorded; no destructive reset is implicit.

## 4. Default Local Mode

The default mode has no Vault password and no cloud dependency:

- non-sensitive data is stored in the existing per-user Electron `userData`
  directory;
- credential values are stored through `safeStorage` in the credentials store;
- host-key verification data remains separate from credentials;
- the app can run offline after the local files are available.

If `safeStorage.isEncryptionAvailable()` is false, Rocker must explain that a
credential cannot be persisted securely and offer the user a Vault setup path.
It must not write a plaintext replacement.

## 5. Optional Vault Mode

Vault mode is an explicit user choice in Settings. The user creates a Vault
password, and Rocker derives an encryption key using a memory-hard KDF such as
Argon2id or scrypt. The encrypted payload uses an authenticated cipher such as
AES-256-GCM. The serialized Vault is versioned and contains only the minimum
metadata needed to decrypt it:

```text
vaultVersion
kdf: { name, salt, parameters }
cipher: { name, nonce }
ciphertext
```

The Vault password is never persisted, logged, exported to diagnostics, or sent
to a Rocker service. Losing it means the encrypted credential values cannot be
recovered by Rocker.

When Vault mode is enabled, credential references remain stable so switching
between default mode and Vault does not change host profile identities.

## 6. Configuration Export

### 6.1 Non-Sensitive Template

The v0 template export contains persisted host address, port, username, auth
method, identity-file path, group, labels, notes, and selected application
settings. It excludes passwords, private-key bytes, passphrases, system
Keychain records, verified Host Keys, and terminal output.

Snippets, persisted forwarding definitions, and terminal history are not yet
part of the v0 migration format because Rocker does not yet maintain those
models as exportable configuration data. They can be added through a later
format version without weakening the current template's no-secrets guarantee.

The format is versioned JSON with an explicit manifest:

```json
{
  "format": "rocker-config",
  "version": 1,
  "containsSecrets": false,
  "createdAt": "2026-09-08T00:00:00.000Z",
  "hosts": [],
  "snippets": [],
  "forwarding": [],
  "settings": {}
}
```

### 6.2 Encrypted Migration Bundle

The migration bundle is intended for moving configuration to another Windows
or macOS installation. It is encrypted with a password entered at export and
again at import. The bundle must use an authenticated, versioned format such as
AES-256-GCM with Argon2id or scrypt key derivation.

Logical v0 contents:

```text
manifest.json
hosts.json
settings.json
host-keys.json (only endpoints represented by exported hosts)
credential-values.enc
```

The physical bundle may be a single encrypted file; the logical names describe
the payload and are not exposed before authentication. System Keychain entries
are never copied directly because they are bound to the source OS account.

## 7. Import and Conflict Rules

Import is preview-first and never replaces the current workspace silently. The
preview reports counts for new records, matching records, conflicts, and
encrypted credentials.

For each host conflict the user can choose:

- keep the local record;
- use the imported record;
- create an imported copy;
- skip the record.

Host-key conflicts are stricter. A changed fingerprint is shown as a security
warning with old and new values, and cannot be replaced without an explicit
confirmation. Importing any Host Key is opt-in; when it is not selected, no
Host Key conflict needs a resolution. Existing local credential values are
never overwritten by a migration: only missing credential references are
added. A malformed or unauthenticated bundle is rejected without touching
existing stores.

Import is serialized in the Electron main process. Before persisted hosts,
settings, or Host Keys are changed, Rocker records a pending, secret-free
rollback journal. An immediate failure compensates completed writes; an
interrupted pending import is recovered on the next launch. The journal stores
only record identities and expected values, never credential values or Vault
passwords.

## 8. Recovery UX

Storage warnings must identify the affected capability and consequence rather
than only saying that local data is unavailable. Recommended copy:

- `Workspace saving is temporarily unavailable.`
- `The current terminal remains usable, but layout changes may not persist.`
- Actions: `Retry`, `Restore backup`, `Export diagnostics`.

Credential or host-key failures remain blocking for the affected action. A
workspace failure is non-blocking for an already-running SSH session. There is
no automatic “clear all data” action.

## 9. Existing Implementation Alignment

The implementation builds on these current boundaries:

- `electron/storage/safe-storage.ts` remains the platform encryption adapter.
- `electron/storage/credential-store.ts` remains the security-critical value
  store.
- `electron/storage/json-store.ts` owns atomic writes, backups, quarantine, and
  storage health.
- `electron/storage/workspace-store.ts` remains the workspace snapshot adapter.
- `electron/windows/workspace-window-manager.ts` controls whether workspace
  persistence is writable.
- `electron/ipc/register.ts` and `electron/ipc/bridge-contract.ts` expose only
  sanitized status and explicit import/export commands.

Before implementation, `JsonStore` recovery order must be corrected so a valid
`.bak` is attempted before a failed quarantine can block recovery. Quarantine
remains best effort and must never destroy the only recoverable copy.

The v0 implementation now uses that recovery ordering, a serialized mutation
queue for configuration-changing IPC, a versioned scrypt/AES-256-GCM Vault,
and main-process-only migration tickets. Renderer code receives only statuses,
previews, result counts, and selected file paths.

## 10. Non-Goals

- No cloud synchronization or Rocker account in v0.
- No automatic secret discovery from arbitrary files.
- No plaintext credential export.
- No remote shell/process restoration.
- No silent overwrite of existing hosts, credentials, or Host Keys.
