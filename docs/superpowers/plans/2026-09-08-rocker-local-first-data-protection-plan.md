# Rocker Local-First Data Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-first data protection layer with optional encrypted Vault mode and portable configuration export/import without cloud synchronization.

**Architecture:** Keep Electron main-process storage as the authority. Separate security-critical credential data from recoverable application data, expose sanitized health and explicit migration IPC, and keep renderer state unaware of raw secrets. Extend the existing `JsonStore` recovery path before adding the export/import format.

**Tech Stack:** Electron 43, TypeScript, Node `fs/promises`, Electron `safeStorage`, Vitest, React renderer IPC bridge.

**Spec:** `docs/superpowers/specs/2026-09-08-rocker-local-first-data-protection-design.md`

**Implementation status:** Completed for the v0 desktop scope on 2026-09-08.
The implementation includes the recovery hardening, versioned Vault,
Keychain/Vault credential mode, migration bundle service, main-process IPC,
transaction journal, and Settings UI. The migration payload currently covers
persisted hosts and settings; encrypted bundles additionally cover associated
Host Keys and credential values. Snippets, forwarding definitions, workspace
state, and terminal history remain intentionally outside the v0 format.

## Global Constraints

- No cloud sync, account system, or remote backup in v0.
- Never write plaintext passwords, private keys, or passphrases.
- Never reset or overwrite existing data after an unreadable or unauthenticated input.
- Host-key fingerprint changes require explicit user confirmation.
- Diagnostics and renderer IPC responses must exclude credential values and absolute secret paths.
- Windows and macOS are the supported desktop platforms; mobile is out of scope.

---

### Task 1: Harden JSON Recovery Ordering

**Files:**
- Modify: `electron/storage/json-store.ts`
- Test: `electron/storage/json-store.test.ts`

**Interfaces:**
- Preserve `JsonStore.load`, `read`, `update`, `write`, and `health` signatures.
- Preserve `LoadResult` and `StorageHealth` status values.

- [ ] **Step 1: Add a failing regression test**

Add a test that makes the primary document malformed, makes the backup valid,
and makes the quarantine rename fail. Assert that `load()` returns
`{ status: "recovered", source: "backup" }` and does not return `blocked`.

- [ ] **Step 2: Run the focused test**

Run: `npm run test:electron -- electron/storage/json-store.test.ts`

Expected: FAIL because `loadUnlocked` currently quarantines before attempting
the backup.

- [ ] **Step 3: Implement backup-first recovery**

Read and validate the backup immediately after detecting a corrupt primary.
Restore the backup when valid. Attempt quarantine only after the backup has been
secured, and treat quarantine as best effort for a recoverable backup. Preserve
blocking behavior when both copies are unavailable or unreadable.

- [ ] **Step 4: Run storage tests and typecheck**

Run: `npm run test:electron -- electron/storage/json-store.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the recovery change**

```bash
git add electron/storage/json-store.ts electron/storage/json-store.test.ts
git commit -m "fix: recover storage from backup before quarantine"
```

### Task 2: Define Vault Format and Crypto Adapter

**Files:**
- Create: `electron/storage/vault-format.ts`
- Create: `electron/storage/vault-crypto.ts`
- Test: `electron/storage/vault-crypto.test.ts`
- Modify: `electron/storage/credentials.ts`

**Interfaces:**
- `createVault(password: string, values: Record<string, string>): Promise<EncryptedVault>`
- `openVault(password: string, vault: EncryptedVault): Promise<Record<string, string>>`
- `EncryptedVault` has `version`, `kdf`, `cipher`, and `ciphertext` fields.
- `openVault` rejects on wrong password, unsupported version, malformed metadata,
  or authentication failure without returning partial values.

- [ ] **Step 1: Add failing format and crypto tests**

Cover round-trip values, Unicode values, wrong password, tampered ciphertext,
unsupported version, and empty credential maps.

- [ ] **Step 2: Run the focused tests**

Run: `npm run test:electron -- electron/storage/vault-crypto.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement versioned authenticated encryption**

Use Node crypto with a memory-hard KDF available in the supported runtime and
AES-256-GCM. Generate a unique salt and nonce per Vault. Validate all decoded
lengths and KDF parameters before allocating or decrypting.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run test:electron -- electron/storage/vault-crypto.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the Vault primitive**

```bash
git add electron/storage/vault-format.ts electron/storage/vault-crypto.ts electron/storage/vault-crypto.test.ts electron/storage/credentials.ts
git commit -m "feat: add versioned encrypted vault format"
```

### Task 3: Add Credential Protection Mode

**Files:**
- Modify: `electron/storage/credential-store.ts`
- Modify: `electron/storage/safe-storage.ts`
- Modify: `electron/storage/types.ts`
- Test: `electron/storage/credential-store.test.ts`

**Interfaces:**
- `CredentialProtectionMode = "keychain" | "vault"`
- `CredentialStoreStatus` exposes mode and availability without exposing values.
- The store rejects writes when neither `safeStorage` nor an unlocked Vault is
  available; it never writes plaintext.

- [ ] **Step 1: Add failing mode-selection tests**

Test default Keychain mode, unavailable platform encryption, Vault unlock and
lock, and preservation of credential references when switching modes.

- [ ] **Step 2: Run focused tests**

Run: `npm run test:electron -- electron/storage/credential-store.test.ts`

Expected: FAIL until mode handling is implemented.

- [ ] **Step 3: Implement mode-aware credential access**

Keep raw values behind the existing credential abstraction. Store only encrypted
payloads and a mode/version marker. Return sanitized health information for IPC.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run test:electron -- electron/storage/credential-store.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit credential protection**

```bash
git add electron/storage/credential-store.ts electron/storage/safe-storage.ts electron/storage/types.ts electron/storage/credential-store.test.ts
git commit -m "feat: support keychain and vault credential modes"
```

### Task 4: Add Versioned Configuration Export and Import Services

**Files:**
- Create: `electron/storage/config-bundle.ts`
- Create: `electron/storage/config-bundle.test.ts`
- Modify: `electron/storage/host-store.ts`
- Modify: `electron/storage/history-store.ts`
- Modify: `electron/storage/types.ts`

**Interfaces:**
- `exportTemplate(input: ExportSnapshot): ConfigTemplate`
- `exportEncryptedBundle(input: ExportSnapshot, password: string): Promise<EncryptedConfigBundle>`
- `inspectBundle(input: Uint8Array, password?: string): Promise<ImportPreview>`
- `importBundle(input: Uint8Array, resolution: ConflictResolution): Promise<ImportResult>`
- Exported payloads exclude terminal output, system Keychain records, and raw
  private-key material unless inside the authenticated encrypted payload.

- [ ] **Step 1: Add failing export/import tests**

Cover template exclusion of secrets, encrypted round-trip, malformed bundle,
wrong password, duplicate host IDs, and changed Host Key fingerprints.

- [ ] **Step 2: Run focused tests**

Run: `npm run test:electron -- electron/storage/config-bundle.test.ts`

Expected: FAIL until the service is implemented.

- [ ] **Step 3: Implement manifest and payload validation**

Use a versioned manifest, bounded strings and arrays, stable host IDs, and
authenticated decryption before parsing sensitive payloads. Reject invalid input
before mutating any existing store.

- [ ] **Step 4: Implement preview and conflict resolution**

Return counts for new, matching, conflicting, and secret-bearing records. Apply
only the explicit per-record resolution supplied by the caller.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm run test:electron -- electron/storage/config-bundle.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit configuration migration**

```bash
git add electron/storage/config-bundle.ts electron/storage/config-bundle.test.ts electron/storage/host-store.ts electron/storage/history-store.ts electron/storage/types.ts
git commit -m "feat: add portable configuration export and import"
```

### Task 5: Expose Safe IPC and Recovery Actions

**Files:**
- Modify: `electron/ipc/bridge-contract.ts`
- Modify: `electron/ipc/register.ts`
- Modify: `electron/preload.ts`
- Test: `electron/ipc/register.test.ts`

**Interfaces:**
- Add explicit `configExportTemplate`, `configExportBundle`,
  `configImportPreview`, and `configImportApply` channels.
- Add `storageRetry` and `storageRestoreBackup` channels scoped to an allowed
  store name.
- IPC returns previews, statuses, and file paths only; never credential values.

- [ ] **Step 1: Add failing IPC contract tests**

Assert that malformed requests are rejected, unknown stores cannot be selected,
and export/import handlers do not return raw secrets.

- [ ] **Step 2: Run focused IPC tests**

Run: `npm run test:electron -- electron/ipc/register.test.ts`

Expected: FAIL until channels and validation are present.

- [ ] **Step 3: Implement handlers and validation**

Use native save/open dialogs in the main process. Re-check current window owner
before applying an import or recovery action. Keep all file writes in the main
process.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run test:electron -- electron/ipc/register.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit IPC surface**

```bash
git add electron/ipc/bridge-contract.ts electron/ipc/register.ts electron/preload.ts electron/ipc/register.test.ts
git commit -m "feat: expose safe storage migration IPC"
```

### Task 6: Add Settings and Recovery UX

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/RecoveryBanner.tsx`
- Modify: `src/renderer/i18n/en.ts`
- Modify: `src/renderer/i18n/zh-CN.ts`
- Create: `src/renderer/components/DataProtectionSettings.tsx`
- Test: `src/renderer/components/RecoveryBanner.test.tsx`

**Interfaces:**
- Settings exposes current protection mode, Vault lock/unlock, template export,
  encrypted bundle export, and import preview.
- Recovery banner distinguishes blocking credential/Host Key failures from
  non-blocking workspace persistence failures.

- [ ] **Step 1: Add failing renderer tests**

Cover workspace degraded copy, retry action, backup restore action, and absence
of secret values in rendered diagnostics or preview text.

- [ ] **Step 2: Run focused renderer tests**

Run: `npm run test -- src/renderer/components/RecoveryBanner.test.tsx`

Expected: FAIL until the new status props and actions exist.

- [ ] **Step 3: Implement non-blocking workspace recovery UX**

Keep an active SSH terminal usable while disabling only persistence-dependent
controls. Show `Workspace saving is temporarily unavailable` and provide Retry,
Restore backup, and Export diagnostics actions.

- [ ] **Step 4: Implement Settings controls**

Add explicit Keychain/Vault status, password entry only in transient component
state, export mode selection, import preview, and conflict resolution. Do not
render credential contents.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm run test -- src/renderer/components/RecoveryBanner.test.tsx`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the user-facing flow**

```bash
git add src/renderer/App.tsx src/renderer/components/RecoveryBanner.tsx src/renderer/components/DataProtectionSettings.tsx src/renderer/i18n/en.ts src/renderer/i18n/zh-CN.ts src/renderer/components/RecoveryBanner.test.tsx
git commit -m "feat: add data protection and recovery controls"
```

### Task 7: End-to-End Verification

**Files:**
- Create: `docs/releases/v0.4.3-data-protection-verification.md`
- Modify: `docs/architecture-audit.md`

- [ ] **Step 1: Run the complete automated suite**

Run: `npm run typecheck && npm run test`

Expected: PASS with no plaintext-secret test failures.

- [ ] **Step 2: Exercise local recovery fixtures**

Verify malformed primary plus valid backup, unavailable quarantine, interrupted
write, missing Keychain, wrong Vault password, and unauthenticated import. In
each case confirm that existing data is not overwritten.

- [ ] **Step 3: Exercise desktop workflows**

On Windows and macOS, create a host, store a credential, export a template,
export an encrypted bundle, import it into a clean profile, and confirm that a
changed Host Key requires explicit confirmation.

- [ ] **Step 4: Record evidence**

Document commands, platform results, file permissions, recovery outcomes, and
known limitations in the release verification document. Do not include exported
credentials or Vault passwords in evidence.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/releases/v0.4.3-data-protection-verification.md docs/architecture-audit.md
git commit -m "docs: define data protection verification evidence"
```
