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

## Concerns

Workspace window bootstrap still owns the compatibility `load()` call and may
be migrated to owner-scoped status loading by Task 3. The adapter now exposes
the status needed for that migration without returning protected values.
