# Task 1 Report: Bounded Terminal Appearance Preferences

## Files changed

- `electron/storage/types.ts`: extended `AppSettings` with bounded scrollback, cursor style, cursor blink, and terminal bell fields.
- `electron/storage/settings-store.ts`: added exact defaults and legacy-safe normalization while keeping the required legacy keys unchanged.
- `electron/storage/settings-store.test.ts`: added normalization and legacy snapshot coverage.
- `electron/ipc/register.ts`: accepted only approved appearance values at the IPC update boundary.
- `electron/diagnostics/diagnostic-export.test.ts`, `electron/ssh/connection-resolver.test.ts`, `src/app/bootstrap-state.test.ts`, `src/components/RecoveryBanner.test.tsx`, `src/app/bridge.ts`, and `src/app/App.test.tsx`: updated typed settings fixtures and bridge coverage.
- `src/app/App.tsx`: loaded appearance preferences through bootstrap, fanned updates to every live controller immediately, debounced persistence by 300 ms, and exposed unavailable persistence status while retaining temporary runtime changes.
- `src/features/settings/SettingsView.tsx`: added native bounded scrollback/cursor controls and persistence-unavailable status handling.
- `src/features/settings/SettingsView.test.tsx`: covered bounded control values and one typed update per change.
- `src/features/terminal/terminal-controller.ts`: introduced the typed `TerminalPreferences` object and in-place controller application contract.
- `src/features/terminal/terminal-controller.test.ts`: verified appearance application does not resize, reconnect, or dispose.
- `src/features/terminal/TerminalView.tsx`: initialized and mutates xterm appearance options in place without replacing the xterm instance.
- `src/features/terminal/TerminalView.test.tsx`: covered live updates for all appearance options while retaining one xterm instance.
- `src/features/terminal/TerminalWorkspace.tsx` and `src/features/terminal/TerminalWorkspace.test.tsx`: migrated workspace wiring to the typed preferences object.
- `src/i18n/en.ts`, `src/i18n/zh-CN.ts`: added English and Simplified Chinese labels, hints, options, and unavailable-persistence messaging.
- `src/styles/components.css`: styled the unavailable-persistence status.
- `tests/fixtures/terminal-engine.ts`: migrated the terminal adapter fixture to the typed preferences method.

## Design decisions

- Used the exact bounded values and defaults from the brief: scrollback `10000`, cursor style `bar`, cursor blink enabled, and terminal bell enabled.
- Kept new appearance fields optional at the storage-read boundary by leaving `requiredSettingsKeys` unchanged; normalization materializes defaults for legacy snapshots and rejects unknown, non-integer, or out-of-range scrollback values.
- Replaced positional font arguments with one typed `TerminalPreferences` object and one `setPreferences` adapter method. Existing terminal callers were migrated deliberately in the controller, view, workspace, App, and test fixtures.
- Applied preferences through mutable xterm options. No terminal instance recreation, disposal, reconnect, PTY resize, or React-owned terminal output state was introduced.
- Kept non-terminal settings updates immediate. Appearance updates apply to all registered live controllers immediately and persist through one 300 ms trailing debounce. Failed or blocked persistence leaves the runtime state active and displays the existing unavailable-state message rather than claiming the value was saved.
- Settings capability blocking disables non-terminal settings while appearance controls remain usable temporarily, as required for blocked persistence.
- No theme editor, search, Command Palette, menu, SSH, PTY, reconnect, Host Key, monitor, or sidebar behavior was changed.

## TDD and verification

The required focused tests were run before implementation and failed as expected:

```text
npm test -- electron/storage/settings-store.test.ts src/features/settings/SettingsView.test.tsx src/features/terminal/terminal-controller.test.ts
Test Files  3 failed (3)
Tests       12 failed | 15 passed (27)
```

Final verification commands and results:

```text
npm test -- electron/storage/settings-store.test.ts src/features/settings/SettingsView.test.tsx src/features/terminal/terminal-controller.test.ts src/features/terminal/TerminalView.test.tsx src/features/terminal/TerminalWorkspace.test.tsx
Test Files  5 passed (5)
Tests       35 passed (35)

npm test -- electron/storage/settings-store.test.ts src/features/settings/SettingsView.test.tsx src/features/terminal/terminal-controller.test.ts src/features/terminal/TerminalView.test.tsx src/features/terminal/TerminalWorkspace.test.tsx src/app/App.test.tsx
Test Files  6 passed (6)
Tests       54 passed (54)

npm test
Test Files  55 passed | 1 skipped (56)
Tests       386 passed | 1 skipped (387)

npm run typecheck
Passed: tsc --noEmit

git diff --check
Passed: no whitespace errors
```

## Commit

- Implementation: `7edf0dec1f449272dc0a9956fadadae62fdc0262` (`feat: add live terminal preferences`)

## Concerns

- The installed `@xterm/xterm` 6.0.0 package documents `bellStyle` in source comments but omits it from the public TypeScript option declaration. The implementation uses a narrow local type extension to preserve the required `sound`/`none` contract; a real bell-event check against the packaged runtime remains advisable.
- Pre-existing user-owned image changes (`Snipaste_2026-08-17_17-58-09.png` deletion and untracked `1.png`) were intentionally left unstaged and unmodified.
