# Rocker Hosts Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Hosts 页面实现为紧凑主机卡片网格，并加入平台标识、完整 SSH 命令识别和内嵌 Connect 按钮。

**Architecture:** 保留现有 `HostProfile`、`HostList` 和 App 的连接回调边界。新增可选 `platform` 数据字段与纯函数校验/平台展示辅助函数；renderer 只负责选择、过滤、按钮状态和既有连接回调，不改 SSH connection manager。

**Tech Stack:** React 19, TypeScript, lucide-react, Vitest, Testing Library, existing CSS tokens.

**Spec:** `docs/superpowers/specs/2026-09-09-rocker-host-card-design.md`

## Global Constraints

- 默认主题强调色必须为 `#0AA344`（当前 token `--accent`）。
- `HostProfile.platform` 必须是可选字段，旧数据缺失时回退 `R`。
- 不自动探测远程操作系统，不新增 SSH 连接协议或凭据存储行为。
- Connect 只有完整 `ssh [user@]host [-p port]` 命令才可用。
- 复杂 SSH 参数保持静默，不创建额外解析面板。

### Task 1: Add Platform Metadata and Command Helpers

**Files:**
- Modify: `electron/storage/types.ts`
- Modify: `electron/storage/host-store.ts`
- Modify: `src/features/hosts/host-state.ts`
- Test: `src/features/hosts/host-state.test.ts`

- [x] **Step 1: Write failing tests** for platform normalization, fallback platform display, complete SSH command recognition, invalid ports, and incomplete commands.
- [x] **Step 2: Run `npm test -- src/features/hosts/host-state.test.ts` and verify the new assertions fail.
- [x] **Step 3: Add optional `HostPlatform`, normalize valid values, and implement pure helpers.
- [x] **Step 4: Run the focused test again and verify it passes.
- [x] **Step 5: Run `npm run typecheck` to verify the optional field is compatible with existing host fixtures.

### Task 2: Replace Host Table With Card Grid

**Files:**
- Modify: `src/features/hosts/HostList.tsx`
- Modify: `src/styles/layout.css`
- Modify: `src/styles/components.css`
- Test: `src/features/hosts/HostList.test.tsx`

- [x] **Step 1: Add failing component tests** for compact card content, platform icon fallback, exact search placeholder, disabled Connect state, complete command activation, single-click selection, double-click connection, and hover edit action.
- [x] **Step 2: Run `npm test -- src/features/hosts/HostList.test.tsx` and verify the new assertions fail against the table implementation.
- [x] **Step 3: Implement the card grid and embedded Connect button using existing `onConnect` and `onEdit` callbacks.
- [x] **Step 4: Remove visible table-only controls from the card surface while retaining add/import/header actions.
- [x] **Step 5: Run the focused component test and verify it passes.

### Task 3: Integrate Existing App Boundaries

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/bridge.ts`
- Test: `src/app/App.test.tsx`

- [x] **Step 1: Update preview/demo host data with explicit platform examples without changing production connection behavior.
- [x] **Step 2: Remove the obsolete visible favorite callback from `HostList` while retaining persisted favorite data for compatibility.
- [x] **Step 3: Route complete direct SSH commands through saved-host reuse or an SSH-Agent HostProfile and run relevant App tests.

### Task 4: Full Verification

**Files:**
- No new source files.

- [x] **Step 1: Run `npm test`.
- [x] **Step 2: Run `npm run typecheck`.
- [x] **Step 3: Run `npm run build`.
- [x] **Step 4: Review the browser preview and confirm the production card layout matches the approved design.
