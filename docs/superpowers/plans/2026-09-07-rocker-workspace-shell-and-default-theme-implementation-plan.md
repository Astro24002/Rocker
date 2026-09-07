# Rocker Workspace Shell and Default Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Rocker into a continuous two-column SSH workspace with a
resizable Sidebar, a blank native workspace chrome, a terminal-first right
surface, a refined Session menu, no Host Monitor or Local Terminal UI, and
the Rocker Dark default theme based on #0AA344.

**Architecture:** Preserve the Electron main-process ownership model for SSH,
PTY sessions, ports, storage, Host Keys, diagnostics, and native windows.
Move only workspace-shell behavior into renderer components. The Sidebar stays
presentational; a workspace-owned resize handle owns resize interaction.
xterm.js remains the terminal buffer and reads terminal colors from the CSS
token contract at construction time. Removing Host Monitoring removes its
complete renderer-to-main IPC chain rather than hiding it.

**Tech Stack:** Electron, React, TypeScript, xterm.js, Lucide React, Vitest,
Testing Library, existing typed preload bridge, existing SettingsStore.

**Spec:** docs/superpowers/specs/2026-09-07-rocker-workspace-shell-and-default-theme-design.md

**Version and release policy:** Do not change package.json, package-lock.json,
electron-builder.yml, GitHub Actions, release assets, tags, or package version
in this work. The product owner chooses release versions separately.

## Global Constraints

- Keep the SSH output path direct from the main-process session stream into
  xterm.js. Do not use React state as a terminal-output buffer.
- Keep existing PTY resize, reconnect, Host Key, ownership, session restore,
  forwarding, workspace persistence, and diagnostic-sanitization behavior.
- Keep Search and Command Palette behavior, but remove their permanent
  workspace buttons. Only Ctrl/Cmd+Shift+F and Ctrl/Cmd+Shift+P remain global
  shortcuts.
- Never intercept common shell keys such as Ctrl+C, Ctrl+D, Ctrl+Z, Ctrl+L,
  Ctrl+A, Ctrl+E, Ctrl+F, Ctrl+K, Ctrl+U, or Ctrl+W.
- Preserve same-window connection reuse only for the existing verified identity:
  same host configuration, authentication method and credential identity, and
  verified Host Key identity. Duplicate in a new window remains independent.
- Port discovery remains manual and forwarding remains user-approved. Do not
  add automatic detection or auto-forwarding.
- Do not add a theme picker, custom theme persistence, SFTP implementation,
  Snippets implementation, a Local Terminal backend, mobile support, AI,
  cloud sync, ProxyJump, SOCKS5, or remote forwarding.
- Do not introduce a global title bar, a large permanent divider, a monitor
  preference, a hidden monitor sampler, or a replacement Local Terminal
  placeholder.
- Use CSS semantic tokens. Do not introduce new scattered green, gray, or
  ANSI hex literals in components.
- Preserve English and Simplified Chinese translation completeness.
- Do not make unrelated refactors while implementing this plan.

---

## File Map

### Create

- src/shared/sidebar-width.ts
- src/shared/sidebar-width.test.ts
- src/components/WorkspaceResizeHandle.tsx
- src/components/WorkspaceResizeHandle.test.tsx
- src/components/WindowChrome.test.tsx
- src/features/settings/ThemePreview.tsx
- src/features/settings/ThemePreview.test.tsx
- src/features/terminal/terminal-theme.ts
- src/features/terminal/terminal-theme.test.ts

### Modify

- build/icon.svg
- build/icon.png
- src/app/App.tsx
- src/app/App.test.tsx
- src/app/bridge.ts
- src/app/bridge.test.ts
- src/app/types.ts
- src/components/Sidebar.tsx
- src/components/Sidebar.test.tsx
- src/components/NavItem.tsx
- src/components/ComingSoonView.tsx
- src/components/WindowChrome.tsx
- src/features/commands/command-registry.ts
- src/features/commands/command-registry.test.ts
- src/features/commands/CommandPalette.test.tsx
- src/features/settings/SettingsView.tsx
- src/features/settings/SettingsView.test.tsx
- src/features/terminal/TerminalView.tsx
- src/features/terminal/TerminalView.test.tsx
- src/features/terminal/TerminalWorkspace.tsx
- src/features/terminal/TerminalWorkspace.test.tsx
- src/i18n/en.ts
- src/i18n/zh-CN.ts
- src/styles/tokens.css
- src/styles/layout.css
- src/styles/components.css
- electron/storage/settings-store.ts
- electron/storage/settings-store.test.ts
- tests/settings-store.test.ts
- electron/ipc/bridge-contract.ts
- electron/ipc/register.ts
- electron/ipc/register.test.ts
- electron/preload.ts
- electron/main.ts
- electron/diagnostics/diagnostic-types.ts
- electron/diagnostics/sanitize.ts
- electron/diagnostics/sanitize.test.ts
- electron/ssh/terminal-soak.ts
- electron/ssh/terminal-soak.test.ts
- electron/ssh/test-fixtures/ssh-server.test.ts
- tests/i18n.test.ts
- tests/packaging.test.ts
- README.md
- docs/architecture-audit.md

### Delete

- src/features/monitoring/MonitorSummary.tsx
- src/features/monitoring/monitor-state.ts
- src/features/monitoring/monitor-state.test.ts
- electron/monitoring/linux-metrics.ts
- tests/linux-metrics.test.ts

Do not delete the full docs/superpowers history. Historical documents remain
historical records; this plan supersedes only their conflicting UI behavior.

## Spec Traceability

| Design requirement | Implementation task |
| --- | --- |
| Rocker Dark token system and static preview | Task 1 |
| Two-column shell, blank workspace chrome, and workspace-internal resize target | Task 2 |
| Navigation order, Local Terminal removal, hidden command controls, Duplicate submenu | Task 3 |
| Terminal-first workspace and contextual overlay placement | Task 4 |
| End-to-end monitor removal without reducing soak coverage | Task 5 |
| Native/manual checks and full regression gate | Task 6 |

## Task 0: Establish the Baseline and Work Boundary

- [ ] Confirm the worktree before editing. Do not stage, delete, or revert
  user-owned changes, including the existing screenshot files and unrelated
  .gitignore change.
- [ ] Run the current suite once and record any pre-existing failures before
  making UI changes.
- [ ] Read the current implementation of App, Sidebar, WindowChrome,
  TerminalWorkspace, TerminalView, SettingsStore, bridge contract, IPC
  registration, terminal soak, and their tests before changing the matching
  task.
- [ ] Keep one task boundary per commit when implementation begins. Each
  commit must build and typecheck independently.

Verification:

    npm test
    npm run typecheck
    git status --short

Expected result: any pre-existing issue is recorded before implementation;
there is no assumption that unrelated worktree changes belong to this feature.

## Task 1: Establish the Rocker Dark Token Contract

**Files:** src/styles/tokens.css, src/styles/layout.css,
src/styles/components.css, src/features/terminal/terminal-theme.ts,
src/features/terminal/terminal-theme.test.ts,
src/features/terminal/TerminalView.tsx,
src/features/terminal/TerminalView.test.tsx,
src/features/settings/ThemePreview.tsx,
src/features/settings/ThemePreview.test.tsx,
src/features/settings/SettingsView.tsx,
src/features/settings/SettingsView.test.tsx,
src/i18n/en.ts, src/i18n/zh-CN.ts, tests/i18n.test.ts,
build/icon.svg, build/icon.png, electron/main.ts, tests/packaging.test.ts.

**Interfaces:**

    import type { ITheme } from "@xterm/xterm"

    export function readRockerTerminalTheme(root?: Element): ITheme
    export const ROCKER_TERMINAL_TOKEN_NAMES: readonly string[]
    export function ThemePreview(): React.JSX.Element

readRockerTerminalTheme defaults to document.documentElement, reads each named
terminal token through getComputedStyle, and throws an Error naming the missing
variable when a required value is blank. ThemePreview accepts no selection or
persistence props.

### 1.1 Write failing tests first

- [ ] Add a terminal-theme unit test that writes all required CSS variables to
  document.documentElement, calls the theme resolver, and asserts the full
  xterm theme uses those computed values.
- [ ] Add a negative terminal-theme test that omits a token and verifies the
  resolver fails with the missing token name rather than silently falling back
  to a duplicated color literal.
- [ ] Add a ThemePreview render test that verifies Rocker Dark is presented
  as the default theme and has no selectable control, persistence callback, or
  input.
- [ ] Extend SettingsView tests to assert the static preview is visible with
  the localized theme name and does not call onUpdate.
- [ ] Extend TerminalView tests to assert it obtains its xterm theme through
  the resolver rather than containing the old literal colors.
- [ ] Add a packaging metadata test that reads build/icon.svg and asserts the
  current brand asset contains #0AA344 and #0A0E0C. Assert build/icon.png
  exists and has a non-zero byte size; do not parse a platform installer.
- [ ] Run the focused tests and verify they fail before implementation.

    npm test -- src/features/terminal/terminal-theme.test.ts src/features/terminal/TerminalView.test.tsx src/features/settings/ThemePreview.test.tsx src/features/settings/SettingsView.test.tsx tests/i18n.test.ts tests/packaging.test.ts

### 1.2 Implement the token and terminal-theme boundary

- [ ] Replace the old lime token palette in src/styles/tokens.css with the
  semantic Rocker Dark values from the approved design. Include every core and
  terminal token, including all normal and bright ANSI colors.
- [ ] Retain only short-lived compatibility aliases needed by existing rules:
  --sidebar-deep resolves to --sidebar-active; --workspace-raised resolves to
  --raised; --workspace-hover resolves to the approved raised hover surface.
  Migrate touched rules to canonical token names rather than expanding aliases.
- [ ] Create src/features/terminal/terminal-theme.ts. Export a small renderer
  adapter that reads the named terminal CSS variables using getComputedStyle on
  the document root and returns the xterm theme shape.
- [ ] Keep DOM access inside the resolver so tests can pass a root element and
  TerminalView has no direct hardcoded xterm color literals.
- [ ] Replace TerminalView's current inline theme object with the adapter
  result at terminal construction. Do not recreate terminals when appearance
  settings change; existing applyPreferences behavior remains responsible only
  for supported live terminal options.
- [ ] Create ThemePreview as a static presentational component. It renders
  the Rocker Dark name, a restrained terminal/surface/color preview, and no
  click target, select, or persisted setting.
- [ ] Place ThemePreview in SettingsView near the appearance settings. It is
  a bounded information card, not a new theme-management section.
- [ ] Add localized strings for the preview title, default-theme name, and
  explanatory copy. Remove no unrelated translations in this task.
- [ ] Convert touched CSS hardcoded old palette colors to semantic tokens.
  Preserve dedicated danger treatment for the native close button and
  destructive menu item through --danger and a named danger-hover token if
  needed.
- [ ] Recolor build/icon.svg using the Rocker Dark canvas, #0AA344 primary
  mark, and approved secondary data accent. Regenerate build/icon.png at its
  existing 512 px format from that SVG with the already-installed sharp
  development dependency; do not add an image-processing package.

    node --input-type=module -e 'import sharp from "sharp"; await sharp("build/icon.svg").resize(512, 512).png().toFile("build/icon.png")'

- [ ] Import the SVG mark into Sidebar's brand zone so expanded and compact
  Sidebar states use the same mark as packaged desktop builds. Give the image
  an empty alternative text because the adjacent accessible product name or
  navigation label identifies it.
- [ ] Update BrowserWindow backgroundColor in electron/main.ts to #0A0E0C so
  native startup and resize exposure do not flash the retired blue-black
  surface.

### 1.3 Verify and commit

- [ ] Confirm the old #86DE67 palette does not remain in renderer source or
  renderer styles.
- [ ] Confirm #0AA344 appears as the --accent token, not as arbitrary repeated
  component literals.

    npm test -- src/features/terminal/terminal-theme.test.ts src/features/terminal/TerminalView.test.tsx src/features/settings/ThemePreview.test.tsx src/features/settings/SettingsView.test.tsx tests/i18n.test.ts tests/packaging.test.ts
    npm run typecheck
    git diff --check
    git add build/icon.svg build/icon.png electron/main.ts src/styles src/features/terminal src/features/settings src/i18n tests/i18n.test.ts tests/packaging.test.ts
    git commit -m "feat: add Rocker Dark theme tokens"

## Task 2: Move Native Chrome into the Workspace and Move Resize Ownership

**Files:** src/shared/sidebar-width.ts,
src/shared/sidebar-width.test.ts, src/components/WorkspaceResizeHandle.tsx,
src/components/WorkspaceResizeHandle.test.tsx,
src/components/WindowChrome.tsx, src/components/WindowChrome.test.tsx,
src/components/Sidebar.tsx, src/components/Sidebar.test.tsx,
src/components/NavItem.tsx, src/app/App.tsx, src/app/App.test.tsx,
electron/storage/settings-store.ts, electron/storage/settings-store.test.ts,
tests/settings-store.test.ts, src/styles/layout.css,
src/styles/components.css.

**Interfaces:**

    export const COMPACT_SIDEBAR_WIDTH = 58
    export const EXPANDED_SIDEBAR_MIN_WIDTH = 180
    export const EXPANDED_SIDEBAR_MAX_WIDTH = 320
    export const DEFAULT_SIDEBAR_WIDTH = 220

    export function normalizeSidebarWidth(value: unknown): number
    export function stepSidebarWidth(current: number, direction: "decrease" | "increase"): number
    export function isCompactSidebar(width: number): boolean

    export interface WorkspaceResizeHandleProps {
      width: number
      onWidthChange(width: number): void
    }

normalizeSidebarWidth returns 58 for finite values at or below 119, 180 for
120 through 179, clamps 180 through 320, and returns 220 for non-numeric
values. stepSidebarWidth(58, "increase") returns 180 and
stepSidebarWidth(180, "decrease") returns 58; this explicit function avoids
the keyboard getting stuck in the invalid intermediate range.

### 2.1 Write failing tests first

- [ ] Add pure width-normalization tests for values 58, 119, 120, 179, 180,
  220, 320, 321, and invalid input. Assert only 58 or 180 through 320 is
  returned.
- [ ] Update SettingsStore tests to verify legacy persisted widths normalize
  with the same policy. Verify a normal 220 px installation remains unchanged.
- [ ] Add WorkspaceResizeHandle tests for pointer drag, pointer cleanup,
  keyboard Arrow Left/Right, compact-to-expanded snap, separator semantics,
  and callback values.
- [ ] Add a WindowChrome test that asserts the element has a drag region and
  native controls, but no Rocker mark/name, Session title, host name, Search,
  or Command Palette label.
- [ ] Rewrite Sidebar tests for the brand zone, compact data state, accessible
  icon navigation, and the absence of a Sidebar-owned resizer.
- [ ] Add an App shell test that verifies Sidebar and Workspace are siblings,
  WindowChrome is inside Workspace, and WorkspaceResizeHandle is inside
  Workspace rather than Sidebar.

    npm test -- src/shared/sidebar-width.test.ts src/components/WorkspaceResizeHandle.test.tsx src/components/WindowChrome.test.tsx src/components/Sidebar.test.tsx electron/storage/settings-store.test.ts tests/settings-store.test.ts src/app/App.test.tsx

### 2.2 Implement the shell primitives

- [ ] Create src/shared/sidebar-width.ts as a process-neutral module with no
  React, DOM, Electron, or storage imports. It exports named constants:
  COMPACT_SIDEBAR_WIDTH = 58, EXPANDED_SIDEBAR_MIN_WIDTH = 180,
  EXPANDED_SIDEBAR_MAX_WIDTH = 320, DEFAULT_SIDEBAR_WIDTH = 220.
  Export one normalizer used by both renderer interaction and SettingsStore
  persistence, avoiding divergent bounds or a main-process dependency on a UI
  component.
- [ ] Change SettingsStore normalization from the current 180-360 clamp to
  the approved compact/expanded normalization. Existing localStorage migration
  in App uses the same helper.
- [ ] Create WorkspaceResizeHandle. It receives current width and an
  onWidthChange callback, captures pointer interaction, removes listeners on
  completion/unmount, and exposes role separator with vertical orientation,
  min, max, and current values.
- [ ] Move resize behavior out of Sidebar. Sidebar becomes responsible for
  Sidebar presentation only; it no longer installs window pointer listeners or
  renders the old outside-edge sidebar-resizer.
- [ ] Update App so WorkspaceResizeHandle is the first visual child inside
  main.workspace and is absolutely positioned at its own left edge. It must
  be a 10 px transparent hit area that does not alter flex layout.
- [ ] Change app-shell from column layout to row layout. Render Sidebar and
  main.workspace as siblings. Move WindowChrome from above app-content to the
  top of main.workspace.
- [ ] Simplify WindowChrome markup to blank drag space plus native controls.
  Keep bridge calls for minimize, toggle maximize, and close unchanged; keep
  the controls in a no-drag region.
- [ ] Update CSS so the blank right chrome is 32 px high, uses
  --workspace-bg, and has no bottom border. The Sidebar brand zone owns the
  Rocker identity.
- [ ] Make Sidebar use data-compact and semantic width classes. Compact mode
  centers icons, hides visual labels without removing accessible names, and
  keeps the product mark recognizable.
- [ ] Ensure NavItem has an accessible label and tooltip in compact mode.
  Do not replace familiar navigation icons with text-only compact buttons.

### 2.3 Verify and commit

    npm test -- src/shared/sidebar-width.test.ts src/components/WorkspaceResizeHandle.test.tsx src/components/WindowChrome.test.tsx src/components/Sidebar.test.tsx electron/storage/settings-store.test.ts tests/settings-store.test.ts src/app/App.test.tsx
    npm run typecheck
    npm run build
    git diff --check
    git add src/app src/components src/styles electron/storage tests/settings-store.test.ts
    git commit -m "feat: restructure the Rocker workspace shell"

## Task 3: Simplify Navigation and Refine Session Actions

**Files:** src/components/Sidebar.tsx, src/components/Sidebar.test.tsx,
src/components/ComingSoonView.tsx, src/app/App.tsx, src/app/App.test.tsx,
src/features/commands/command-registry.ts,
src/features/commands/command-registry.test.ts,
src/features/commands/CommandPalette.test.tsx,
src/i18n/en.ts, src/i18n/zh-CN.ts, tests/i18n.test.ts,
src/styles/components.css, src/styles/layout.css.

**Interfaces:**

    export type WorkspaceNavKey = NavKey | "terminal"
    export type NavigationCommand =
      | "hosts" | "sftp" | "snippets" | "ports" | "history" | "settings" | "terminal"

    type SessionMenuState =
      | { kind: "closed" }
      | { kind: "root"; sessionId: string }
      | { kind: "duplicate"; sessionId: string }

The Duplicate submenu maps In this window to session.duplicate and In a new
window to session.duplicate-window. It does not introduce a third duplicate
command or change the existing CommandActions interface.

### 3.1 Write failing tests first

- [ ] Replace tests that expect Local Terminal with tests that prove it is
  absent from Sidebar, Command Palette navigation, route rendering, and
  translations.
- [ ] Add Sidebar navigation-order assertions: Hosts, SFTP, Snippets, Port
  Forwarding, History, Settings.
- [ ] Add tests proving Settings is a regular navigation item, not a brand-zone
  quick action.
- [ ] Add a Session-menu test that expects Duplicate to be a submenu trigger
  with a ChevronRight affordance and expects In this window and In a new
  window in its submenu.
- [ ] Test pointer and keyboard submenu behavior: open with pointer/Right
  Arrow, execute the chosen child action, Escape returns focus correctly, and
  disabled child actions do not dispatch.
- [ ] Retain tests confirming same-window Duplicate invokes the current
  session.duplicate path and new-window Duplicate invokes the current
  session.duplicate-window path. No connection-manager implementation changes
  are allowed.
- [ ] Add App tests proving the workspace command-affordances strip is absent,
  while Ctrl/Cmd+Shift+F and Ctrl/Cmd+Shift+P still open Search and Command
  Palette. Update old tests that clicked visible toolbar buttons to dispatch
  the approved shortcut or invoke the existing terminal context menu.

    npm test -- src/components/Sidebar.test.tsx src/features/commands/command-registry.test.ts src/features/commands/CommandPalette.test.tsx src/app/App.test.tsx tests/i18n.test.ts

### 3.2 Implement navigation and menu behavior

- [ ] Remove local-terminal from WorkspaceNavKey, NavigationCommand, CommandId,
  commandRegistry, command tests, App route handling, ComingSoonView feature
  union, preview bridge assumptions, and both locale maps.
- [ ] Remove the Local Terminal quick action and the standalone Settings quick
  action from Sidebar. Remove the unused Session search glyph. Add Settings to
  navItems in the approved order.
- [ ] Keep only SFTP and Snippets in ComingSoonView. Their destination labels,
  accessible navigation, and localized placeholder copy remain.
- [ ] Remove the workspace-command-affordances markup and its Search and
  Command Palette IconButtons from App. Remove only the visual entry points;
  keep command registry, exact shortcut matcher, focus restoration, Search
  Overlay, Command Palette, and terminal context menu.
- [ ] Refactor the Session menu into semantic sections. Reconnect and Rename
  remain direct actions. Duplicate becomes a submenu parent. The nested
  children dispatch exactly the existing two command IDs.
- [ ] Keep Split horizontally and Close outside the Duplicate submenu. Use
  separators and a danger treatment only for Close.
- [ ] Keep the current context-menu owner coordination, disabled checks,
  command registry enablement, focus recovery, viewport safety, and Session
  activation behavior.
- [ ] Update CSS for compact Sidebar behavior, selected surface continuity,
  neutral menu surfaces, submenu positioning, and focus styling. Do not
  allocate workspace toolbar height.

### 3.3 Verify and commit

    npm test -- src/components/Sidebar.test.tsx src/features/commands/command-registry.test.ts src/features/commands/CommandPalette.test.tsx src/app/App.test.tsx tests/i18n.test.ts
    npm run typecheck
    git diff --check
    git add src/app src/components src/features/commands src/i18n src/styles tests/i18n.test.ts
    git commit -m "feat: simplify terminal navigation controls"

## Task 4: Make the Right Workspace Terminal-First

**Files:** src/app/App.tsx, src/app/App.test.tsx,
src/features/terminal/TerminalWorkspace.tsx,
src/features/terminal/TerminalWorkspace.test.tsx,
src/styles/layout.css, src/styles/components.css,
src/features/settings/SettingsView.tsx,
src/features/ports/PortsView.tsx,
src/features/hosts/HostList.tsx,
src/features/history/HistoryView.tsx, and their existing tests only where
layout contract assertions need adjustment.

**Interfaces:**

    interface TerminalWorkspaceProps {
      workspace: TerminalWorkspaceState
      workspaceVisible?: boolean
      overlay?: ReactNode
      preferences: TerminalPreferences
      confirmMultilinePaste: boolean
      multilinePasteConfirmation?: string
      onInput(sessionId: string, channelGeneration: number, data: string): void
      onResize(sessionId: string, channelGeneration: number, dimensions: TerminalDimensions): void
      onAck(sessionId: string, channelGeneration: number, sequence: number): void
      onController(sessionId: string, controller: TerminalController | undefined): void
      onSearchController?(sessionId: string, controller: TerminalSearchController | undefined): void
      onCommandSurface?(sessionId: string, surface: TerminalCommandSurface | undefined): void
      onContextMenu?(sessionId: string, event: MouseEvent): void
    }

The new contract intentionally has no monitor, monitorHostName, or
onMonitorToggle property. Existing overlay and terminal I/O signatures are
unchanged.

### 4.1 Write failing tests first

- [ ] Replace the TerminalWorkspace monitor-layout test with a terminal-first
  layout test: terminal stack is the first persistent content; no monitor
  surface, host title bar, or Session toolbar is rendered.
- [ ] Add a test that TerminalConnectionOverlay and TerminalSearchOverlay still
  render above terminal content through the existing overlay prop without
  reserving permanent height.
- [ ] Add an App test that an active Session renders terminal content directly
  beneath blank WindowChrome and does not show a host header or a function-key
  strip.
- [ ] Add view-level assertions that Hosts, Ports, History, Settings, SFTP,
  and Snippets remain reachable from the same workspace stage.

    npm test -- src/features/terminal/TerminalWorkspace.test.tsx src/app/App.test.tsx src/features/hosts/HostList.test.tsx src/features/ports/PortsView.test.tsx src/features/history/HistoryView.test.tsx src/features/settings/SettingsView.test.tsx

### 4.2 Implement the workspace presentation

- [ ] Remove MonitorState, monitorHostName, and onMonitorToggle from
  TerminalWorkspace props and render path. TerminalWorkspace becomes a
  position-relative terminal host plus its existing contextual overlay slot.
- [ ] Remove all monitor-dependent CSS selectors and terminal-search offsets.
  TerminalSearchOverlay uses a stable top/right inset inside TerminalWorkspace.
- [ ] Keep terminal-stack split behavior, hidden Session surfaces, direct xterm
  I/O callbacks, fit/resize behavior, and context-menu callbacks exactly as
  they are.
- [ ] Ensure RecoveryBanner stays between WindowChrome and workspace-stage only
  for recovery states. It must not insert an empty bar when inactive.
- [ ] Update management-view CSS to use the same workspace frame and semantic
  colors. Keep Hosts, Ports, History, and Settings dense and work-focused,
  avoiding broad decorative cards or large empty hero regions.
- [ ] Retain current Port Forwarding manual scan, recommendation, user,
  process, source, and forwarding lifecycle UI. This task only changes the
  shared frame and palette.

### 4.3 Verify and commit

    npm test -- src/features/terminal/TerminalWorkspace.test.tsx src/app/App.test.tsx src/features/hosts/HostList.test.tsx src/features/ports/PortsView.test.tsx src/features/history/HistoryView.test.tsx src/features/settings/SettingsView.test.tsx
    npm run typecheck
    npm run build
    git diff --check
    git add src/app src/features src/styles
    git commit -m "feat: make the workspace terminal-first"

## Task 5: Remove Host Monitoring End to End

**Files:** src/app/App.tsx, src/app/App.test.tsx, src/app/bridge.ts,
src/app/bridge.test.ts, src/app/types.ts,
src/features/monitoring/MonitorSummary.tsx,
src/features/monitoring/monitor-state.ts,
src/features/monitoring/monitor-state.test.ts,
electron/monitoring/linux-metrics.ts, tests/linux-metrics.test.ts,
electron/ipc/bridge-contract.ts, electron/preload.ts,
electron/ipc/register.ts, electron/ipc/register.test.ts,
electron/main.ts, electron/diagnostics/diagnostic-types.ts,
electron/diagnostics/sanitize.ts, electron/diagnostics/sanitize.test.ts,
electron/ssh/terminal-soak.ts, electron/ssh/terminal-soak.test.ts,
electron/ssh/test-fixtures/ssh-server.test.ts,
src/i18n/en.ts, src/i18n/zh-CN.ts, tests/i18n.test.ts,
README.md, docs/architecture-audit.md.

**Interfaces:**

    interface RockerBridge {
      app: AppBridge
      hosts: HostsBridge
      sessions: SessionsBridge
      ports: PortsBridge
      workspace: WorkspaceBridge
      history: HistoryBridge
      settings: SettingsBridge
      bootstrap: BootstrapBridge
      diagnostics: DiagnosticsBridge
      events: EventsBridge
    }

    const soakExecOptions: RemoteExecOptions = {
      timeoutMs: 8_000,
      maxOutputBytes: 1_024
    }

RockerBridge and ipcChannels have no monitor or monitorSample member after
this task. The generic soak exec probe calls
sessions.exec(second.sessionId, "true", soakExecOptions) and expects the
fixture's bounded successful response; it is test-only and is never exposed as
new renderer IPC.

### 5.1 Write replacement tests first

- [ ] Add an App regression test with fake timers that a connected Session
  never calls a monitor bridge method and renders no terminal-monitor element
  after the normal polling interval would previously have elapsed.
- [ ] Add a bridge-preview test that the browser preview bridge satisfies the
  reduced RockerBridge contract without a monitor property.
- [ ] Update IPC registration tests so the dependency harness has no
  monitoring dependency, no monitor channel is registered, and Session closing
  still cleans up normal terminal, forwarding, and connection resources.
- [ ] Replace the terminal-soak monitor sampling step with a bounded generic
  exec-channel probe through TerminalSessionManager. Use the fixture command
  response of ok and RemoteExecOptions with an 8-second timeout and 1 KiB
  output ceiling. The test must still cover one shared connection, two terminal
  Sessions, output acknowledgement, resize, reconnect, forwarding recovery,
  and final resource baseline.
- [ ] Rename the SSH fixture test from monitoring-specific wording to generic
  bounded exec-channel wording. Keep its assertion that exec channels settle.
- [ ] Replace diagnostics sanitizer assertions that allow monitoring with
  assertions that the category is rejected or normalized away according to
  the existing safe sanitizer policy.
- [ ] Remove monitoring translation expectations and add locale-completeness
  checks for any new ThemePreview strings.

    npm test -- src/app/App.test.tsx src/app/bridge.test.ts electron/ipc/register.test.ts electron/diagnostics/sanitize.test.ts electron/ssh/terminal-soak.test.ts electron/ssh/test-fixtures/ssh-server.test.ts tests/i18n.test.ts

### 5.2 Remove the complete feature path

- [ ] Remove monitor state imports, monitor useState, active-Session sampling
  effect, monitor props, and monitor errors from App.
- [ ] Remove HostMetrics re-export from src/app/types.ts and all
  src/features/monitoring source and tests.
- [ ] Remove monitor from RockerBridge and ipcChannels, then remove its
  preload implementation. Typecheck before moving on so no renderer code can
  retain an undeclared bridge access.
- [ ] Remove LinuxMetricsSampler construction, event logging, and monitoring
  diagnostic recorder from electron/main.ts.
- [ ] Remove monitoring from IpcDependencies, handler registration, and
  close-session cleanup in electron/ipc/register.ts and its test harness.
- [ ] Remove the monitoring diagnostic category and sanitizer allow-list case.
- [ ] Delete electron/monitoring/linux-metrics.ts and tests/linux-metrics.test.ts
  only after every consumer is gone.
- [ ] Refactor terminal-soak to the bounded generic exec probe described in
  5.1. Do not reduce its reconnect or cleanup assertions merely because
  monitoring is gone.
- [ ] Remove monitor-related README claims and update docs/architecture-audit.md
  so the runtime shape lists only connection/session/forwarding/ports/storage
  services that truly remain.
- [ ] Use a repository search restricted to current runtime and current tests
  to confirm no monitorSample, LinuxMetricsSampler, terminal-monitor, or
  monitoring IPC references remain. Historical design documents may retain
  historical references.

### 5.3 Verify and commit

    npm test -- src/app/App.test.tsx src/app/bridge.test.ts electron/ipc/register.test.ts electron/diagnostics/sanitize.test.ts electron/ssh/terminal-soak.test.ts electron/ssh/test-fixtures/ssh-server.test.ts
    npm run typecheck
    npm run build
    git diff --check
    git add src electron tests README.md docs/architecture-audit.md
    git commit -m "refactor: remove host monitoring"

## Task 6: Integration Verification and Documentation Closure

**Files:** all changed files, README.md, docs/architecture-audit.md, this plan,
and the corresponding design specification.

### 6.1 Run focused behavior checks

- [ ] Test Sidebar compact and expanded transitions using pointer and keyboard.
  Confirm the 10 px workspace-internal target is invisible at rest and shows
  only the narrow accent cue while interacted with.
- [ ] Test native controls on Windows and macOS manually when native runners
  are available. Confirm the blank drag region drags, controls work, and no
  title line is visually reintroduced.
- [ ] Test a long-running terminal, resize it, switch to Hosts/Ports/Settings,
  return to terminal, and confirm xterm stays mounted or correctly fitted
  according to existing visibility behavior.
- [ ] Test terminal Search and Command Palette with the two approved shortcuts.
  Confirm no visible toolbar trigger is required and shell keys pass through.
- [ ] Test the Session right-click menu, both Duplicate submenu choices, Split
  horizontally, Rename, Close, and disabled states.
- [ ] Test Port Forwarding remains manual and active forwards remain intact
  when a terminal Session closes according to the existing lease rules.
- [ ] Test the static Settings theme preview, English locale, Simplified
  Chinese locale, high-contrast focus, and compact navigation tooltips.

### 6.2 Run automated verification

    npm test
    npm run typecheck
    npm run build
    git diff --check

- [ ] If the repository's local Windows container smoke check is available,
  run it as an additional packaging regression. Do not introduce a new native
  test project as part of this UI task.
- [ ] Do not create a release, tag, or installer. Record observed local manual
  verification in the implementation handoff or a version-specific release
  checklist only after a product version is assigned.

### 6.3 Final review checklist

- [ ] No global top title bar or large gray Sidebar divider remains.
- [ ] No Local Terminal command, nav item, placeholder, translation, or route
  remains.
- [ ] No Host Monitoring UI, background sampling, public bridge call, IPC
  handler, sampler, diagnostics category, or current product claim remains.
- [ ] Sidebar selected state visually joins the workspace without using a wide
  accent fill.
- [ ] The default accent is #0AA344 through --accent only.
- [ ] xterm theme values resolve from the token contract.
- [ ] Terminal reliability and connection-sharing semantics have no behavior
  regression.
- [ ] The full automated suite is green before claiming completion.

## Implementation Notes for Reviewers

The highest-risk changes are not visual:

1. Moving the resize handle must not break persistence or pointer cleanup.
2. Moving WindowChrome must not break native drag/no-drag and window controls.
3. Removing monitoring must not leave a dangling typed bridge, IPC handler, or
   soak-test dependency.
4. Refining Duplicate presentation must not change the existing SSH
   connection-reuse and new-window isolation semantics.
5. Reading terminal colors from CSS must not move terminal state into React or
   recreate xterm instances.

Review these boundaries before accepting any visual-only screenshot as proof
of completion.
