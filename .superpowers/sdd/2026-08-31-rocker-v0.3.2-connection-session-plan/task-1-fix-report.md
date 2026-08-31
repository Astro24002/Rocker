# Task 1 Fix Report

Date: 2026-08-31
Base: `48ddb0f`
Commit message: `fix: classify local ssh auth failures`

## Findings fixed

- Malformed or unsupported private-key errors thrown by `ssh2` from
  `client.connect()` are classified as `configuration`, do not schedule a
  retry, and are replaced with a bounded message without the identity path or
  key material.
- Configured SSH-agent endpoint failures from ssh2, including `ENOENT`,
  `EACCES`, and the generic agent socket failure, are classified as
  `configuration`, do not schedule a retry, and do not expose the endpoint.

## TDD evidence

- Added focused regressions in `electron/ssh/connection-manager.test.ts`.
- RED: the focused command failed with the four new cases while the existing
  36 tests passed.
- GREEN: the focused command passed with 40 tests across both SSH test files.

## Verification

- `npm test`: 47 test files and 230 tests passed.
- `npm run typecheck`: passed.
- `git diff --check`: passed.
- Only the two Task 1 implementation/test files and this required report are
  staged for this fix; the unrelated image changes remain unstaged and
  untouched.

RuntimeOwner reuse, IPC payload shape, and the production keepalive defaults of
15,000 milliseconds and 3 missed responses are unchanged.
