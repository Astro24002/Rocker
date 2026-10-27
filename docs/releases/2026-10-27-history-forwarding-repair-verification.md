# History、测试稳定性与 PF 策略修复验收

Date: 2026-10-27
Baseline: `dev/v0.7-sftp` / `6ddceb5294f0b87e01c557a8f59f572b5dd7eff6` / `v0.7.3-rc.3`
Scope: [修复设计的第 1、2 项](../superpowers/specs/2026-10-27-rocker-history-verification-forwarding-policy-repair-design.md)
Release: 仅工作树修改；未修改版本、创建 tag、发布安装包或推送分支。

## 代码结果

- `SessionHistoryRecorder` 在主进程订阅现有 Session 状态事件；以 owner、renderer generation、session 和连接周期隔离记录。累计单调时钟在线区间，自动重连暂停后续计；失败、关闭、取消和远端结束写最终结果。History 存储异常只进入诊断，不改变 SSH 连接结果。
- History 读取合成当前时长；15 秒批量检查点；最多 200 条；清空抑制已有周期后续写入，淘汰记录不重新插入。正常退出清理 Session 后排空写入，退出等待上限 3 秒；异常退出后的未结束记录显示中断和已记录时长下界。
- Connections / History 可见时每 1.5 秒刷新，限制在途轮询，隐藏或离开后停止；清空前的迟到读取不能恢复旧列表。SSH 成功连接后仍更新 Hosts 最近连接排序。
- PF 移除无实际消费逻辑的启动策略复选框和 Policy 列。Save 只保存，Save and start / Start / Resume 显式执行。旧 `autoStart` 值保留，但没有自动监听语义。
- SFTP 操作同时响应回调、abort、end、close、error，忽略迟到进度和回调。取消等待该任务通道关闭和租约释放；迟到打开的通道也清理；递归目录扫描、stat、mkdir 和 rename 等传输等待走同一结算逻辑。清理未确认时返回错误，不提前宣称资源已释放。

## 兼容与迁移

- 继续使用 `history.json`，增加可选 `timingVersion: 1`、`endedAt`、`endReason`；旧条目无需迁移，旧零时长显示 Unknown / 未知。重启只标记新格式中未结束的条目，不推算离线时长，不恢复 SSH 会话。
- 复用 JsonStore 的原子写入、备份恢复、损坏及权限错误处理。基线旧读取器忽略新增属性，原有字段与 outcome 三值不变；未执行旧安装包降级实测。
- `forwarding.json` 版本不变；新规则 `autoStart=false`，现有规则普通编辑保留原值，旧文件及导入导出继续兼容。没有批量重写或新增公共 IPC。
- 已有 Snippets 清理与原型文件保留，不作为本轮修复新增能力，也未替换 SSH/SFTP 后端。

## 逐项证据

| 项目 | 证据 |
| --- | --- |
| H01 | `session-history-recorder.test.ts`：30 秒在线 + 10 秒等待 + 20 秒在线 = 50 秒，单记录结束为 disconnected。 |
| H02 | 同 Host 不同 session 分别计时；相同 sessionId 不同 renderer generation 隔离。 |
| H03 | 初次认证失败、连接前取消、手动重试形成不同周期。 |
| H04 | 重复 connected/closing、旧 channelGeneration 不重复计时和记录；自动重连续用同周期。 |
| H05 | 活动和 connecting 时清空，后续事件与检查点不恢复记录；App 迟到列表读取不能覆盖清空结果。 |
| H06 | 写盘异常与 EACCES 不抛入 Session 事件；flush 排空；下次启动保留中断下界、不生成 endedAt。主进程退出接线已代码检查，原生退出实测延期。 |
| H07 | `history-store.test.ts`、`json-store.test.ts`、`HistoryView.test.tsx`：旧格式、可选字段校验、备份恢复、损坏、权限错误及未知时长；200 条淘汰不复活。 |
| T01 | `App.test.tsx`：受控 open/list Promise，等待 `/etc` 内容后关闭并验证 PF 路由。 |
| T02 | `sftp-manager.integration.test.ts`：通过 WRITE 屏障使 A/B 同时真实传输，A 取消不依赖放行应答，B 上传再下载逐字节比较，现有共享 SSH PTY 可继续交互。 |
| T03 | `sftp-operation.test.ts`、`sftp-manager.test.ts`：无回调、先 end/close/error、迟到 open/进度、完成后取消、未确认关闭报错；集成验证通道、句柄、暂停 WRITE 和任务租约归零或回到既有租约基线。 |
| P01 | `register.test.ts`、`PortsView.test.tsx`：创建、编辑、导入和页面读取不启动，旧 true 保留；主进程启动与新窗口路由经代码检查无隐式启动调用。 |
| P02 | Save and start / Start / Resume 精确调用一次；既有端口冲突、公开绑定提示测试保留。 |
| P03 | `forwarding-manager.test.ts` 与 App 测试：终端/页面关闭不停止其他租约；owner 释放、loopback 重连恢复、非 loopback 显式恢复、远端拒绝后恢复继续通过。 |

## 验证运行

- 关联验证：4 个文件、110 项测试通过。
- 完整验证：`npm test -- --run`，86 个测试文件通过、1 个项目显式 skip，861 项测试通过、1 项显式 skip；无失败、无未处理错误，耗时约 82 秒。
- TypeScript：`npx tsc --noEmit` 通过。
- 生产构建：`npm run build` 通过；Electron main、preload、renderer 均完成构建。
- `git diff --check` 通过。

本轮首个完整运行出现一项额外 SSH fixture 竞态：等待 PTY 请求并不能证明 shell 请求已到达暂停点。测试提前断开后，暂停状态会落到重连的新 shell 上。已改为等待实际 pending shell，并预先观察 opening Promise 的拒绝以避免失败清理产生未捕获错误。随后关联 4 文件 / 110 项通过；最终完整运行结果另列。

SFTP fixture 的 server wrapper 原先未确认 channel close。现在显式确认、只在 close 时扣减通道计数，关闭文件句柄后再扣减句柄数；清理有期限并聚合错误。这是测试端协议与观测修复，不作为 ssh2 缺陷的结论。运行时无回调挂起由受控通道测试另行验证。

## 范围差异与剩余事项

- 原生 Windows/macOS 安装、真实外部主机、首次启动连接错误继续按用户决定延期。
- SSH/SFTP 集成使用本机真实 ssh2 TCP 服务和真实临时文件；不等于原生安装验收或外部服务器兼容矩阵。
- 长时间 soak 沿用项目显式开关，默认不运行。
- 通道打开途中取消会等待原生打开回调以回收迟到通道；本轮未增加新的 SSH subsystem 打开超时策略。对已打开通道的关闭确认设置 5 秒错误期限，不以超时伪装清理成功。
- 本轮未修改 v0.8 能力范围；命名工作区与保存转发意图继续按独立设计推进，不将历史 autoStart 值解释为新的启动授权。
