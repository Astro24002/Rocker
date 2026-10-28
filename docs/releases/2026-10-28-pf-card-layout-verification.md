# PF card layout acceptance

Date: 2026-10-28
Baseline HEAD: `e8abeed5f5a579e90c2640ebe04723bd153a57d1`

## Implemented

- Shared production rule card in PF overview and Host detail: status dot before
  name, status badge and existing actions on one row at the upper right, divided
  Local/Remote address section below. Descriptions remain supported.
- Grid uses a 480px minimum and 640px maximum card width. Below the minimum,
  cards follow the available container width. Long names truncate; addresses wrap.
- Forwarding has a green-tinted badge, border and bold label; the status dot uses
  the semantic success color so it remains green across themes.
- Rules sort numerically by local port, then remote port, then stable profile ID.
  Overview keeps Host grouping and independent two-rule collapse; the visible
  pair is now the first two sorted rules rather than the two newest rules.
  Host group order remains based on the latest rule creation time.
- Uses existing runtime events, bridge actions and confirmation behavior.
  No backend, connection-lifecycle, IPC or storage changes; no migration.

## Verification

- Full suite: 88 test files and 872 tests passed, one intentional soak skip.
- TypeScript, production build and diff whitespace check passed.
- Sorting regression covers numeric order, equal local ports, independent
  overview expansion and immutable bridge data.
- Browser checks used the production App and PortsView with 12 preview-fixture
  rules, across three themes and widths 1040/1440/1920/2560. Verified bounds,
  sort order, status/action alignment, no card overflow, overview expansion,
  start/stop updates and content scrolling without moving the workspace header.
- These browser checks do not claim a real external SSH connection.
- The separate pf-layouts.html comparison remains a local design preview.
  It is not imported by the production application entry point.
- No new release, tag or remote push was performed for this acceptance.
