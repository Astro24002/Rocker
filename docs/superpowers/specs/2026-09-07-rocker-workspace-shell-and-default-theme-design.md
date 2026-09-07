# Rocker Workspace Shell and Default Theme Design

Date: 2026-09-07

Status: Approved visual direction, ready for implementation planning

Scope: Rocker desktop application for Windows and macOS

Visual source of truth: The approved browser review completed before this document. This document is the implementation source of truth; the browser prototype is not production code.

## 1. Product Intent

Rocker is a professional SSH workspace. Its primary working state is a remote
terminal, not a dashboard. The window must make that clear at a glance:

- The left side is a compact, user-controlled control surface.
- The right side is one continuous workspace that displays the active product
  destination.
- When a Session is active, that workspace is almost entirely terminal.
- Navigation, search, monitoring, and shell controls must not consume
  terminal working area merely to be discoverable.

The visual character is Modern Professional Tool UI plus native desktop-app
behavior and a minimal dark-terminal aesthetic. The inspiration is the
information hierarchy and calmness of a modern SSH product, not a clone of
any other application's UI.

Rocker remains English-first with Simplified Chinese available through the
existing locale setting. This design does not add mobile support.

## 2. Scope and Supersession

This design replaces the following current UI decisions:

- The app-wide title bar above both columns.
- The Local Terminal navigation entry and its placeholder destination.
- The visible Host Monitor HUD, renderer polling loop, and associated public
  monitor IPC surface.
- The visible Search and Command Palette buttons above the right workspace.
- The flat Duplicate and Duplicate in a new window entries in the Session
  context menu.
- The current gray divider and shallow surface between the Sidebar and the
  workspace.
- The lime accent palette.

It preserves the v0.3 reliability foundation and the v0.4 terminal
productivity behavior:

- Direct SSH stream to xterm.js output handling.
- PTY resize, terminal search, Command Palette, terminal context menu, and
  the two reserved global shortcuts.
- Session restore metadata, reconnect behavior, Host Key verification,
  owner-window checks, and connection reuse rules.
- Explicit port discovery and user-approved forwarding only.
- Existing Hosts, History, Settings, Ports, SFTP placeholder, and Snippets
  placeholder destinations.

No package version, tag, installer, or release decision is assigned by this
document. Version publication remains under product-owner control.

## 3. Window Model

The desktop window has two permanent regions:

    +------------------------+----------------------------------------------+
    | Sidebar                | Workspace                                    |
    |                        | [blank native drag space] [min][max][close] |
    |  Brand                 |                                              |
    |  Product navigation    |  Active destination                          |
    |  Session list          |  SSH terminal or management view             |
    +------------------------+----------------------------------------------+

The native window controls belong to the top of the right workspace only.
They preserve operating-system behavior, but the chrome must appear visually
blank:

- no Rocker name;
- no session title;
- no host name;
- no connection status;
- no search button;
- no Command Palette button;
- no separator line below the chrome.

The left brand area is independent of the right chrome. It should feel
balanced with the window but must not create a fake horizontal line across the
application.

The workspace router owns all right-side destinations:

    terminal
    hosts
    sftp
    snippets
    ports
    history
    settings

There is no Local Terminal route. A future local-terminal product must have a
separate approved design and a real backend before it can reappear.

## 4. Sidebar

### 4.1 Geometry and Resizing

The Sidebar is resizable by the user and has three valid layout outcomes:

| State | Persisted width | Behavior |
| --- | ---: | --- |
| Compact | 58 px | Icon-first navigation and Session state indicators. Text labels are visually hidden but remain accessible. |
| Expanded | 180 px to 320 px | Labels, Session names, and section labels are visible. |
| Invalid intermediate | 59 px to 179 px | Never persist this state. It resolves to Compact or the 180 px expanded minimum. |

The default expanded width remains 220 px. Existing saved widths are migrated
through the new bounds:

- values at or below 119 px become 58 px;
- values from 120 px through 179 px become 180 px;
- values from 180 px through 320 px are retained;
- values above 320 px become 320 px;
- malformed values use 220 px.

There is no collapse button or decorative chevron. Dragging and keyboard
resizing are the only collapse and expand controls. A pointer drag crossing
the compact threshold snaps predictably rather than leaving unreadable,
half-expanded text.

The interaction target is a 10 px-wide hit area placed inside the left edge of
the workspace. It must not be a visible divider or consume Sidebar width.

Default state:

- identical background to the workspace;
- transparent;
- no gray edge;
- no layout gap;
- no persistent colored strip.

Hover, focus, or active drag state:

- cursor is col-resize;
- a centered 2 px line uses the accent color;
- the full 10 px hit area remains transparent;
- the cue disappears when interaction ends.

The target is a keyboard-accessible vertical separator with an accessible
name, minimum, maximum, and current value. Arrow Left and Arrow Right use a
12 px step when expanded, with the compact/expanded snap behavior above.

### 4.2 Brand Zone

The Sidebar begins with a 52 px product-brand zone:

- Expanded: the Rocker mark and product name.
- Compact: centered Rocker mark only.
- No settings button, Local Terminal button, personal-space label, or other
  quick action appears here.

The brand mark is the product identity, not a generic collapse control.
It uses the packaged Rocker mark recolored to the Rocker Dark palette, so the
in-window brand and Windows/macOS application icon share the same identity.

### 4.3 Product Navigation

Navigation appears under the brand zone in this exact order:

| Destination | Icon | Notes |
| --- | --- | --- |
| Hosts | Server | Real host profile management. |
| SFTP | FolderClosed | Placeholder only. |
| Snippets | FileCode2 | Placeholder only. |
| Port Forwarding | Network | Real, explicit forwarding workflow. |
| History | Clock3 | Real connection history. |
| Settings | Settings | Real settings destination. |

Every item has a Lucide icon, a localized accessible label, and the same
desktop hit target. In compact mode, the icon is centered and the accessible
label remains available through the button.

The selected item and the selected Session row use the same relationship to
the workspace:

- the selected row surface uses the workspace-adjacent active surface;
- a 2 px accent inset on its left edge identifies selection;
- the active row visually touches its own Sidebar surface rather than creating
  a large gray divider;
- inactive hover uses a neutral raised surface;
- accent color is not used as a large selected-row fill.

The Sidebar has no Host Monitor section and no hidden monitor affordance.

### 4.4 Sessions

Sessions remain a separate, scrollable section below product navigation:

- Selecting a Session activates it and directly shows its SSH terminal in the
  workspace.
- A Session selection therefore changes active destination to terminal.
- The Session label, connection-state dot, and active state remain visible in
  expanded mode.
- Compact mode exposes session state with an icon/state dot and accessible
  session name, without forcing truncated labels into the narrow width.
- The current Session search glyph is removed. Session filtering requires its
  own future product design.

## 5. Workspace

### 5.1 Terminal Is the Default Working Surface

For an active SSH Session, the entire working area beneath the blank native
chrome belongs to TerminalWorkspace. There is no host title bar, status
toolbar, global function-key strip, Search button, Command Palette button, or
monitor panel competing for height.

Terminal overlays remain valid when they are genuinely contextual:

- connecting, reconnecting, disconnected, and error overlays;
- terminal search overlay;
- terminal context menu;
- multiline paste confirmation.

These overlays are positioned inside the terminal surface and do not reserve
permanent layout height. Terminal search starts at 12 px from the upper-right
edge of the terminal workspace. It no longer has monitor-dependent offsets or
wide-screen offsets designed to avoid a monitor panel.

The RecoveryBanner remains a safety-critical workspace state. It appears below
the native chrome only while local bootstrap recovery needs user attention. It
is not a general-purpose toolbar and disappears when dismissed or resolved.

### 5.2 Management Destinations

Hosts, Port Forwarding, History, Settings, SFTP, and Snippets use the same
right workspace container and blank chrome. They do not open a separate
window or a nested dashboard shell.

| View | Intent |
| --- | --- |
| Hosts | Dense host management with the existing connect and editor flows. |
| Port Forwarding | Manual discovery, recommendation, approval, and forwarding lifecycle. No auto-forwarding. |
| History | Existing saved connection-history workflow. |
| Settings | Device-local preferences, terminal appearance, diagnostics, and a static default-theme preview. |
| SFTP | Clear placeholder destination only. |
| Snippets | Clear placeholder destination only. |

Management views use unframed bands, dense rows, tables, and practical
controls. Cards are allowed only for repeated host items, dialogs, the static
theme preview, or a genuinely bounded tool. Cards are not nested.

## 6. Session Context Menu

Right-clicking a Session row opens a native-feeling contextual menu. It is the
only Session action menu in this design; the workspace does not reserve a
toolbar for Session actions.

Menu structure:

    Reconnect
    Rename
    Duplicate                                      >
      In this window
      In a new window
    ------------------------------------------------
    Split horizontally
    ------------------------------------------------
    Close

Duplicate is a submenu trigger, not a direct action. The submenu is aligned to
the parent item, opens from hover or keyboard Right Arrow, and remains within
the window viewport. It uses a ChevronRight affordance and has clear focus and
disabled states.

Action semantics stay unchanged:

| Action | Semantics |
| --- | --- |
| In this window | Creates a distinct terminal Session. It can reuse a physical SSH connection only when host configuration, authentication method and credential identity, and verified Host Key identity all match. |
| In a new window | Creates a separate workspace window and independent physical SSH connection. |
| Split horizontally | Uses the existing split-layout operation. It is not a new transport feature. |
| Rename | Changes only the Session display label. |
| Close | Closes the selected Session and releases its lease only when appropriate. |

Menu command availability continues to come from the central command registry.
A disabled action must never invoke a bridge call. Escape closes the menu and
returns focus to its originating Session row.

## 7. Search, Command Palette, and Keyboard Policy

Search and Command Palette remain product capabilities but no longer appear as
permanent buttons in the workspace.

Only these global combinations are reserved:

| Platform | Search | Command Palette |
| --- | --- | --- |
| Windows | Ctrl+Shift+F | Ctrl+Shift+P |
| macOS | Command+Shift+F | Command+Shift+P |

The terminal context menu also exposes Search through the existing central
command registry. The Command Palette remains available from its shortcut and
through command-driven entry points; it does not need a visible workspace
toolbar trigger.

Rocker must not intercept common shell keys such as Ctrl+C, Ctrl+D, Ctrl+Z,
Ctrl+L, Ctrl+A, Ctrl+E, Ctrl+F, Ctrl+K, Ctrl+U, and Ctrl+W. They continue to
belong to the remote terminal, readline, tmux, vim, or the shell.

## 8. Host Monitoring Removal

Host monitoring is not part of this UI version.

The following must disappear together during implementation:

- terminal HUD and expanded monitor UI;
- renderer polling and monitor state;
- monitor translations and UI tests;
- monitor bridge contract and preload methods;
- monitor IPC registration and main-process construction;
- LinuxMetricsSampler implementation and its tests;
- monitoring diagnostics category;
- README and architecture claims that advertise monitoring.

The terminal soak test remains. It must retain its connection, PTY, output,
reconnect, forwarding, cleanup, and resource-baseline coverage without using
the monitoring subsystem as an incidental test dependency.

This is a feature removal, not a hidden preference. There is no monitor toggle,
disabled setting, or retained background sampling behavior.

## 9. Rocker Dark Default Theme

### 9.1 Theme Scope

The default theme is named Rocker Dark. It is the only available theme in this
release. Settings shows a static preview and name for recognition, but no
theme picker, persistence key, theme editor, custom import/export, or
per-host theme exists yet.

All UI colors must be semantic CSS custom properties defined in
src/styles/tokens.css. Components use tokens rather than new literal colors.
Compatibility aliases may remain temporarily while old component rules are
migrated, but they must resolve to this semantic palette.

The native BrowserWindow background and packaged Rocker icon are part of the
default theme boundary. The startup background uses --canvas equivalent
#0A0E0C, and both vector and raster icon sources use the same #0AA344 accent
family rather than the legacy lime mark.

### 9.2 Core Tokens

| Token | Value | Intended use |
| --- | --- | --- |
| --canvas | #0A0E0C | Outer application canvas. |
| --sidebar-bg | #151B17 | Sidebar base. |
| --sidebar-hover | #202A23 | Sidebar hover and raised interaction. |
| --sidebar-active | #0B100D | Selected Sidebar item base. |
| --workspace-bg | #0B0F0D | Terminal workspace and blank chrome. |
| --management-bg | #111713 | Management-view base. |
| --raised | #18211B | Menus, bounded raised surfaces, and dialogs. |
| --overlay | #1B251F | Contextual overlays. |
| --field | #121914 | Inputs and controls. |
| --line | #2A3830 | Standard separators. |
| --line-strong | #3A4A40 | Focusable or emphasized bounds. |
| --line-subtle | rgba(232, 240, 235, 0.055) | Quiet internal separators. |
| --text-primary | #E8F0EB | Primary content. |
| --text-secondary | #B5C3BA | Secondary labels and control text. |
| --text-muted | #7D8C83 | Supporting metadata. |
| --text-disabled | #56645C | Disabled controls. |
| --accent | #0AA344 | Rocker identity, active inset, primary action. |
| --accent-hover | #13B956 | Primary-action hover. |
| --accent-pressed | #087E35 | Primary-action pressed state. |
| --accent-soft | #0C2B1A | Low-emphasis accent surface. |
| --accent-soft-hover | #103720 | Hovered low-emphasis accent surface. |
| --accent-ink | #06150B | Text and icons on an accent fill. |
| --focus | #58D88B | Keyboard focus ring. |
| --selection | #204D32 | Text and terminal selection. |
| --success | #55BB7B | Success only. |
| --warning | #D2A45E | Warning only. |
| --danger | #D5767E | Error and destructive action only. |
| --info | #70A9D8 | Informational state only. |
| --teal | #5EC5BC | Secondary data accent only. |

The accent is never reused as a generic success, warning, or error color. A
primary accent button uses --accent-ink, not white text. The close-window hover
and destructive Session menu continue to use a dedicated danger treatment.

### 9.3 Terminal Tokens

xterm.js must read its theme values from the renderer token contract so the
terminal does not contain a second, drifting color palette.

| Token | Value |
| --- | --- |
| --terminal-bg | #0B0F0D |
| --terminal-fg | #DCE7DF |
| --terminal-dim | #829086 |
| --terminal-cursor | #74D79A |
| --terminal-selection | #204D32 |
| --terminal-black | #253029 |
| --terminal-red | #D66C73 |
| --terminal-green | #59B97F |
| --terminal-yellow | #D7AD62 |
| --terminal-blue | #71A8D8 |
| --terminal-magenta | #BA8BD5 |
| --terminal-cyan | #59C3BB |
| --terminal-white | #D0DBD4 |
| --terminal-bright-black | #647369 |
| --terminal-bright-red | #E58A90 |
| --terminal-bright-green | #78CF99 |
| --terminal-bright-yellow | #E8C47D |
| --terminal-bright-blue | #98C4E9 |
| --terminal-bright-magenta | #D1A9E3 |
| --terminal-bright-cyan | #7EDBD4 |
| --terminal-bright-white | #F2F7F3 |

Terminal theme creation reads computed CSS token values once when a terminal
instance is constructed. Every listed terminal token is required; a missing
token is a development/test failure rather than permission to duplicate a
literal fallback color in TerminalView. No terminal output, theme state, or
theme data crosses the Electron bridge.

### 9.4 Surface and Motion Rules

- No gradients, decorative orbs, bokeh, or marketing-style visual effects.
- Rounded rectangles use 4 px to 8 px radii. Only state dots are circular.
- Borders are quiet. Surface contrast, spacing, and typography carry most of
  the hierarchy.
- Menus and overlays use restrained shadow plus border, not bright glows.
- Focus is visible for keyboard users without a persistent high-contrast ring
  on unfocused controls.
- Text must not use negative letter spacing.
- The UI must stay usable at 720 px desktop width and above. This is not a
  mobile layout requirement.

## 10. Accessibility and Native Behavior

- Native minimize, maximize/restore, and close buttons remain keyboard and
  pointer accessible and retain no-drag regions.
- Blank native drag space remains draggable.
- The Sidebar resize handle exposes separator semantics and is operable by
  keyboard.
- Icon-only compact navigation has localized accessible names and native
  tooltips.
- Context menus use menu and menuitem roles, preserve focus, and expose the
  Duplicate submenu as a keyboard-navigable menu.
- Color never provides the only connection-state or error meaning.
- Terminal focus restoration after palette, search, menu, and overlay closure
  remains intact.

## 11. Acceptance Criteria

The UI work is accepted when all of the following are true:

1. The app renders as a continuous two-column desktop workspace with no global
   top title bar.
2. Rocker branding is in the Sidebar; right native chrome is blank except for
   operating-system window controls.
3. The Sidebar supports compact 58 px mode and expanded 180-320 px mode with
   the workspace-internal invisible 10 px resize target.
4. The target has no gray divider at rest and shows only a narrow green cue
   during resize interaction.
5. Hosts, SFTP, Snippets, Port Forwarding, History, and Settings appear in
   the approved order with icons; Local Terminal is absent from UI and command
   navigation.
6. Selecting a Session shows its terminal directly in the workspace with no
   permanent monitor, search, command, or host-title toolbar.
7. Session right-click shows the Duplicate submenu and preserves all existing
   transport-reuse and command-enable rules.
8. No monitor renderer code, public bridge method, IPC handler, main-process
   sampler, diagnostics category, test, or current architecture claim remains.
9. Rocker Dark uses the #0AA344 semantic accent system, and xterm colors come
   from the token contract.
10. Search and Command Palette remain reachable through only their existing
    reserved shortcuts and terminal/context command surfaces.
11. Existing terminal data-pipeline, resize, reconnect, session restore,
    connection-sharing, host-key, port-forwarding, storage, and diagnostics
    safety tests remain green.

## 12. Explicit Non-Goals

- A user-selectable theme system.
- Custom themes, imported themes, or per-host terminal palettes.
- SFTP implementation.
- Snippets implementation.
- Local Terminal backend or placeholder.
- AI, cloud sync, team workflows, mobile, ProxyJump, SOCKS5, or remote
  forwarding.
- New keyboard shortcuts beyond the two previously approved global shortcuts.
- A broad terminal-engine rewrite.
