# PF 工作区独立 SSH 连接修复

Date: 2026-10-27
Baseline HEAD: `6ddceb5294f0b87e01c557a8f59f572b5dd7eff6`
Status: 工作树修复；未发布。

## 问题与结果

Hosts / Open Forwarding 原先只创建 PF 页面，页面从同 Host 的 SSH 终端会话中查找 connectionId。没有终端时，扫描按钮不可用；关闭终端也会失去扫描入口。

现在创建 PF 工作区时，主进程 PortService 获取该工作区的独立 SSH lease。沿用 SshConnectionManager 的 Host、凭据、Trust、transport 复用和重连能力，不创建 PTY、不增加 SSH 会话条目或终端 History。首次连接显示 Connecting SSH；失败显示错误，可点击 Scan 重试。打开页面建立连接，扫描仍由用户显式触发，不自动启动转发规则。

## 生命周期

- 按 RuntimeOwner（含 renderer generation）与 workspaceId 注册，重复打开去重；已存在的 workspaceId 不能改绑另一个 Host。
- 扫描单独持有短期 lease，等待可用 transport，并使用可取消、有时间与输出上限的 SSH exec。沿用 `ss` / `netstat` 解析；扫描成功或失败都释放操作 lease。
- 切换功能或会话只隐藏 PF 页面；保持表单、发现结果及连接，避免组件重挂载时重新连接。
- 显式关闭 PF 会话会中止扫描并释放工作区 lease。连接中关闭会取消 acquire，迟到 lease 也回收。窗口关闭、renderer 替换、Host 删除和应用退出执行主进程清理。
- 已启动的 forwarding runtime 保持其独立 lease。关闭 PF 页面不停止规则，也不关闭其他 SSH/SFTP 会话。

## Contract 与兼容

- 新增 `ports.openWorkspace(workspaceId, hostId)`、`ports.closeWorkspace(workspaceId)`，用于用户要求的后台连接所有权，不借用 terminal open 或创建假终端。
- 现有 `ports.scan(connectionId)` 保持兼容，增加 `{ workspaceId }` 目标。IPC 验证 ID，并将当前窗口/renderer owner 传给服务；其他 owner 不能访问该工作区。
- 本次没有持久化字段迁移；PF 页面会话身份继续使用现有 workspace session id。
- 浏览器预览 bridge 只补齐调用形状，不把预览数据宣称为真实 SSH 扫描结果。

## 验证

- 关联测试：5 文件、161 项通过。
- `port-service.test.ts`：无终端扫描、重复打开、窗口/renderer 隔离、错误 Host 绑定、迟到连接关闭、认证失败重试、扫描取消、fallback 和 lease 清理。
- `port-service.integration.test.ts`：本机真实 ssh2 TCP 连接执行远端 exec 并解析服务；没有 PTY；转发与 PF 共用一个 transport，关闭 PF 后转发仍运行，最后归零。
- `register.test.ts`：后台工作区 open/scan/close 的 owner 转发和参数拒绝；旧 connectionId 扫描的跨窗口限制继续保留。
- `PortsView.test.tsx`：连接中禁用扫描、成功后可扫描、错误可重试、重命名保留发现结果、组件卸载不擅自释放 lease。
- `App.test.tsx`：从 Hosts 直接打开并扫描，不创建终端或转发规则；页面复用、切换保留、显式关闭调用正确释放入口。

- 完整套件：`npm test -- --run`，88 个文件、871 项通过，1 个原有 soak 显式 skip；没有失败或未处理错误。
- `npx tsc --noEmit`、`npm run build`、`git diff --check` 均通过。

真实外部主机与 Windows/macOS 原生安装仍属此前延期验收范围。测试 fixture 返回受控 `ss` 输出，用来验证真实 SSH exec 与生命周期，不等于针对外部服务器系统命令兼容性的验收。
