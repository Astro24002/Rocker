# Task 2 Report: Persistence Adapter Policies

Status: complete

## TDD Evidence

The adapter matrix was run before production changes:

```text
npx vitest run electron/storage/settings-store.test.ts \
  electron/storage/workspace-store.test.ts \
  electron/ssh/host-key-store.test.ts \
  tests/storage.test.ts tests/history-store.test.ts
```

RED was observed in 5 test files: 9 tests failed. The failures were the
expected missing `loadWithStatus`/`health` APIs and lost concurrent settings,
history, and host mutations caused by independent read-modify-write paths.

The same matrix passed after each adapter mutation path was moved to
`JsonStore.update` or, for Workspace's existing debounce, queued
`JsonStore.write`.

## Implementation

- Settings, History, Hosts, and Workspace now construct `JsonStore` with an
  explicit store kind, default, normalizer, and recovery policy.
- Settings, History, Hosts, and Workspace expose `loadWithStatus()` while
  retaining their existing `get`, `list`, and `load` value APIs.
- Settings, History, Hosts, Credentials, and Host Keys use the generic queued
  update transaction for complete read-normalize-modify-write operations.
- Credential and Host Key adapters expose health-only async APIs. Their health
  results contain no document or protected value data.
- Host Key's adapter-specific mutation tail was removed; compare-and-swap now
  occurs inside the generic file queue.
- Workspace keeps its in-memory debounce and pending mutation behavior, but
  all durable snapshots pass through queued `JsonStore.write` calls.

## Policy Decisions

- Settings and Workspace top-level schema mismatches return
  `defaulted/corrupt`; valid legacy settings fields are normalized while
  newer optional fields receive defaults.
- History top-level mismatches return `defaulted/corrupt`.
- Hosts, Credentials, and Host Keys reject malformed top-level documents and
  malformed protected items so they return `blocked` rather than silently
  manufacturing an empty protected document.
- Missing files retain JsonStore's first-run behavior. Protected stores only
  block missing data when a matching quarantine marker exists.
- Workspace `load()` remains a value-returning compatibility wrapper and
  returns safe defaults for normal defaultable corruption; blocked filesystem
  outcomes are preserved as `StorageBlockedError`, while `loadWithStatus()`
  exposes the typed blocked result for bootstrap gating.

## Verification

Pre-review verification:

```text
npx vitest run electron/storage/json-store.test.ts \
  electron/storage/settings-store.test.ts \
  electron/storage/workspace-store.test.ts \
  electron/ssh/host-key-store.test.ts \
  tests/storage.test.ts tests/settings-store.test.ts tests/history-store.test.ts
PASS: 7 files, 36 tests

npm run typecheck
PASS

npm test
PASS: 50 files, 321 passed, 1 skipped
```

`git diff --check` also passes. Existing user image changes were not touched.

## Review Fixes

The independent review found that a cached Workspace document prevented a
repaired primary or backup from being observed on retry, and that a failed
write left an in-memory document ahead of a blocked JsonStore health state.
`loadWithStatus({ reload: true })` now performs a fresh queued load, consumes
stale non-blocked health, rechecks corrupt-default results, and replaces the
cached document only after a valid load. Regression tests cover repaired
backup recovery and repaired-primary recovery after a blocked write.

The public `HostKeyStore` interface now declares optional health-only status,
and HostStore accepts only a file path so callers cannot inject a legacy
identity JsonStore that bypasses the Hosts blocked policy. Tests use the
policy-configured path constructor.

Post-review verification:

```text
npx vitest run electron/storage/workspace-store.test.ts \
  electron/ssh/host-key-store.test.ts tests/storage.test.ts \
  tests/history-store.test.ts electron/storage/settings-store.test.ts
PASS: 5 files, 23 tests

npm test
PASS: 50 files, 334 passed, 1 skipped

npm run typecheck
BLOCKED by unrelated uncommitted Task 3 changes in the shared worktree:
electron/main.ts, electron/preload.ts, electron/ipc/register.test.ts,
src/app/bridge.ts, and electron/windows/workspace-window-manager.test.ts.
```

## Concerns

Workspace window bootstrap still owns the compatibility `load()` call and may
be migrated to owner-scoped status loading by Task 3. The adapter now exposes
the status and explicit reload path needed for that migration without
returning protected values.
