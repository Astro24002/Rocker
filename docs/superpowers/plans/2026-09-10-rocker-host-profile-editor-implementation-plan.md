# Rocker SSH Host Profile Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 New Host/Edit Host 实现为安全、可国际化且与现有 SSH 存储合约兼容的 Host Profile drawer。

**Architecture:** HostProfile 只增加可选的主机偏好字段；HostStore 和 IPC 在 Main 进程归一化、校验并保留旧数据。React drawer 负责条件字段、可访问表单和 redacted identity-file save payload，凭据继续通过现有 HostSaveRequest 单独传递。

**Tech Stack:** React 19, TypeScript, lucide-react, Vitest, Testing Library, existing CSS tokens and i18n dictionaries.

**Spec:** `docs/superpowers/specs/2026-09-10-rocker-host-profile-editor-design.md`

## Global Constraints

- SSH 是唯一可编辑协议；MOSH 和 Telnet 不得添加到 UI、类型、存储或 IPC。
- `charset` 默认值必须是 `utf-8`，`themeColor` 默认值必须是 `rocker`。
- `publicKeyEnabled` 和 `snippetsEnabled` 关闭时对应内容可为空；打开时必须验证必填内容。
- Bootstrap 不得向 renderer 暴露 `identityFile`，已有密钥只能通过 `hasIdentityFile` 保留。
- 凭据不进入 HostProfile、React 持久化状态、诊断或日志。
- English 是默认语言；每个新增可见字符串必须有 Simplified Chinese 翻译。

### Task 1: Extend and normalize the host profile contract

**Files:**
- Modify: `electron/storage/types.ts`
- Modify: `electron/storage/host-store.ts`
- Modify: `src/app/types.ts`
- Test: `electron/storage/host-store.test.ts`

**Interfaces:**
- Produce `HostCharset`, `HostThemeColor`, and optional `HostProfile` fields.
- `normalizeHostProfile` preserves valid optional values and applies UTF-8/Rocker defaults when absent or invalid.

- [x] **Step 1: Write failing normalization tests** for valid metadata, defaults, invalid values, and legacy private-key inference.
- [x] **Step 2: Run `npm test -- electron/storage/host-store.test.ts` and verify the new assertions fail.**
- [x] **Step 3: Add the types and minimal normalization implementation.**
- [x] **Step 4: Run the focused test and verify it passes.**

### Task 2: Add the drawer behavior with conditional fields

**Files:**
- Modify: `src/features/hosts/HostEditor.tsx`
- Modify: `src/styles/layout.css`
- Modify: `src/styles/components.css`
- Test: `src/features/hosts/HostEditor.test.tsx`

**Interfaces:**
- `HostEditorProps.onSave(profile: HostSaveProfile, credentials: { password?: string; passphrase?: string }): void`.
- New profiles use `HostProfile`; redacted edits may use `BootstrapHostProfile` with `hasIdentityFile`.

- [x] **Step 1: Write failing component tests** for defaults, conditional public-key/snippet fields, required attributes, redacted key preservation, and metadata payload.
- [x] **Step 2: Run `npm test -- src/features/hosts/HostEditor.test.tsx` and verify it fails against the current editor.**
- [x] **Step 3: Implement the shared drawer sections, state transitions, redacted save payload, and translated labels.**
- [x] **Step 4: Add compact responsive styles without changing the existing workspace shell.**
- [x] **Step 5: Run the focused component test and verify it passes.**

### Task 3: Harden IPC and application integration

**Files:**
- Modify: `electron/ipc/register.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/bridge.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh-CN.ts`
- Tests: `electron/ipc/register.test.ts`, `src/app/bridge.test.ts`, `src/app/App.test.tsx`

- [x] **Step 1: Add failing boundary tests** for valid optional fields, rejection of enabled-but-empty public-key/snippet values, and preservation of redacted saves.
- [x] **Step 2: Run the focused IPC/application tests and verify the failures are caused by missing validation or payload handling.**
- [x] **Step 3: Validate optional fields in Main, accept redacted identity saves, and pass the broader HostSaveProfile type through App and preview bridge.**
- [x] **Step 4: Add English/Chinese strings and run focused tests.**

### Task 4: Full verification and audit

**Files:**
- Review: all files above and the design/spec documents.

- [x] **Step 1: Run `npm test`.**
- [x] **Step 2: Run `npm run typecheck`.**
- [x] **Step 3: Run `npm run build`.**
- [x] **Step 4: Inspect the renderer contract through component tests and production build for New/Edit parity, disabled conditional fields, and no MOSH/Telnet controls.**
- [x] **Step 5: Review `git diff` for accidental credential/path exposure and unrelated changes.**
