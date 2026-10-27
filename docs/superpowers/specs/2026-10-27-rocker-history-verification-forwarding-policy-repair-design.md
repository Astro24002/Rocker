# Rocker History、验证稳定性与 PF 启动策略修复设计

Date: 2026-10-27
Status: Implemented；代码已实施，完整验证记录见下方链接
Baseline: `dev/v0.7-sftp`，HEAD `6ddceb5294f0b87e01c557a8f59f572b5dd7eff6`，tag `v0.7.3-rc.3`

Implementation and verification: [修复验收记录](../../releases/2026-10-27-history-forwarding-repair-verification.md)

## 1. 范围与证据

本设计对应本轮审计建议的第 1、2 项：History 时长与结果记录、完整测试套件稳定性、PF 启动策略。当前工作树中的 Snippets 清理属于已有改动。

证据来自当前源码与上一轮审计执行结果：

- `electron/ipc/register.ts` 的 `sessionOpen` 在 `sessions.open()` 成功后写入固定零时长记录；失败则追加失败记录。
- `TerminalSessionManager.open()` 已等待 shell 建立，因此问题不是把 connecting 当成 connected，而是后续断开、重连、关闭没有更新历史。
- History 写盘位于连接请求的 try/catch 内。写盘失败可能让已经建立的 SSH 会话返回错误；修复必须隔离这两个结果。
- `HistoryStore` 只有追加、读取、清空，缺少按记录身份更新和退出时排空写入的能力。
- 普通完整测试运行在 `App.test.tsx` 的新窗口 SFTP 路由断言失败；单 worker 完整运行在 SFTP 并发取消用例及其清理钩子超时。两项用例分别隔离运行通过。尚未证明全部超时仅由测试调度造成。
- `SftpManager.cancelTransfer()` 中止任务并调用 `channel.end()`，然后等待 `runPromise`；`runFastTransfer()` 只通过 fastPut/fastGet 回调结算，没有主动监听 abort/close/error。这是需要验证的挂起路径，尚不是已复现的确定根因。
- PF 的 `autoStart` 目前只有表单、显示、校验和持久化用途。原 v0.6 设计同时明确：加载规则不得隐式启动监听。

本轮已按本方案实施代码与测试，验收结果单独记录。原生安装、真实主机验收和首次启动连接错误继续沿用之前的延期决定。

## 2. History 的产品语义

### 2.1 记录单位

一条记录对应一次用户发起的 SSH 会话连接周期。不同 SSH 会话即使复用同一 transport，也分别记录。

- 自动重连属于原周期，累计恢复前后的在线时长。
- 周期进入最终失败、远端 shell 结束或用户取消后，再手动重连创建新记录。
- 切换页面、分屏、重命名不创建记录。
- PF、SFTP 及 Connection Test 不作为 SSH 终端历史写入。
- 保留最近 200 条，按记录开始时间排序；更新时间不改变记录顺序。

### 2.2 时长和状态

时长为 shell 处于 connected 状态的累计时间，使用主进程单调时钟计算。墙上时钟仅用于可读时间戳。认证等待和 reconnecting 间隔不计入在线时长。

| 事件 | 记录行为 | 时长行为 |
| --- | --- | --- |
| connecting / restoring | 建立内存中的连接周期 | 尚未计时 |
| 首次 connected | 写入记录，outcome 为 connected | 开始计时 |
| reconnecting | 更新为 disconnected，保留同一周期且不写结束时间 | 累加当前在线区间并暂停 |
| 自动重连 connected | 更新同一条记录为 connected | 开始新在线区间 |
| error | 结束本周期，outcome 为 failed | 保留已累计时长；从未连成则为 0 |
| disconnected / channel-ended | 结束本周期，标记远端结束 | 停止计时 |
| disconnected / cancelled | 结束本周期，标记用户取消 | 未连成也不伪装成认证失败 |
| closing | 对尚未结束的周期记录关闭 | 已结束记录不重复更新或覆盖失败原因 |

连接前的无效 IPC 参数、找不到 Host、重复 sessionId 等请求校验错误不生成连接历史。

`connectedAt` 保持既有字段兼容：成功周期取首次 connected 的时间；从未连成的失败或取消周期取发起时间。History 列标题使用 Time / 时间，避免将失败记录时间描述为连接成功时间。

### 2.3 显示与刷新

- 进入 Connections / History 时读取最新记录。
- 页面可见期间按短间隔刷新已有 `history.list()`，同时合并会话状态变化引起的刷新；使用在途请求保护，隐藏页面停止轮询。
- 多窗口通过同一主进程 History 服务读取，避免只靠当前窗口的 Session 事件刷新。
- 读取时为当前活动记录合成最新时长；不为每秒显示更新写 JSON。
- 旧记录中无法证明准确的零时长显示为未知，不推算历史时长。旧 connected 结果表示曾经连接成功，不表示此刻仍在线。

## 3. History 实现与兼容

### 3.1 职责划分

增加主进程 `SessionHistoryRecorder`，负责状态归约、计时、写入顺序和 flush。它订阅 `TerminalSessionManager` 的现有事件，不拥有 SSH 连接或 PTY。

- 在 `main.ts` 初始化时注册一次订阅，不把订阅生命周期绑定到窗口或 React。
- 通过内部 `hostIdForSession(sessionId)` 查询或等价的内部上下文获得 Host。事件在会话移除前发出；不扩展 renderer 可调用的公共 API。
- 内存身份使用完整 RuntimeOwner（包括 rendererGeneration）、sessionId 和周期编号；持久化记录使用随机 UUID。
- 忽略输出事件、重复状态和过期 channelGeneration；关闭时立即结束计时，再异步落盘。
- History 写入失败只更新既有存储诊断/健康状态，不改变 SSH open/reconnect/close 的成功结果，不抛入 Session 事件分发链。
- 从 `sessionOpen` IPC 中移除直接的 history.add；以生命周期记录器作为唯一写入来源。

### 3.2 存储

沿用 `history.json` 和 JsonStore 的串行、原子写入及恢复机制。保留现有字段与 outcome 三个值，可增加以下可选字段：

```ts
timingVersion?: 1
endedAt?: string
endReason?: "closed" | "remote-exit" | "connection-error" | "cancelled" | "interrupted"
```

- `timingVersion` 缺失表示历史记录来自旧实现，不将其零时长解释为经过精确计时的结果。
- 新可选字段须有类型、日期和枚举校验；旧文件可直接读取，无强制整文件迁移。
- 存储提供首次插入和 updateExisting 两种语义。周期结束和检查点只能更新已有记录，防止被 200 条上限淘汰的记录重新插入。
- 活动记录每 15 秒批量保存检查点，状态切换和结束时立即排队保存；不为每个终端输出写盘。
- `history.list()` 合成内存时长并尊重写入队列顺序；读取失败继续走既有存储错误处理。

### 3.3 清空、退出与异常中断

- Clear 与记录写入进入同一串行顺序；递增清空代次，并将所有已经开始的周期标记为不可再次写入。
- 被清空周期后续的 connected、重连、检查点和关闭都不得重新生成该条历史。之后新发起的周期正常记录。
- 正常退出在 Session 清理发出 closing 后 flush History，再关闭诊断。写盘失败或超时不阻塞其他资源释放。
- 强制结束进程无法获得准确结束时间。下次启动将本次计时格式中尚未结束的记录标记 interrupted，保留最后检查点，不虚构 endedAt。
- 中断记录的时长表示“至少已记录的时长”；不把进程离线时间计入在线时间，也不触发恢复连接。
- 兼容性回归覆盖旧记录、备份恢复、数据损坏、权限失败和旧应用读取新增可选字段的结果。

## 4. 测试稳定性与 SFTP 取消验证

### 4.1 App 新窗口 SFTP 用例

现有用例等待 G11 标题后就立即检查 list 调用；标题和 breadcrumb 可以在异步 open/list 完成前出现。

- 使用受控 Promise 分别控制 open 和 list：先确认 loading，再放行 open，等待指定 workspaceId 的 `/etc` 请求，最后放行 list 并检查文件内容。
- 对 list 结果使用 waitFor/findBy，而不是固定 sleep。
- 保留 Close 和后续 PF 路由断言，确认请求结束和界面状态均正确。
- 若受控顺序暴露实际重复请求或路由错误，再修复对应实现；不只放宽断言。

### 4.2 同主机并发传输

当前用例依赖 2 MB 文件和每次 WRITE 延迟 12 ms，希望观察到短暂的双任务运行窗口。改为测试 fixture 中的显式屏障：

1. 按目标路径暂停 A、B 的首次 WRITE 应答，并提供“请求已到达”和释放接口。
2. 等到两个任务都实际进入传输，确认两个任务租约及 workspace 租约存在。
3. 保持 A 的应答暂停，取消 A；要求取消完成不能依赖服务器放行 A。
4. 放行 B，确认 B 成功，内容一致，A 保持 cancelled。
5. 确认任务通道、租约回到 workspace 的基线，SSH PTY 和其他 PF/SFTP 任务仍可用。

使用较小但跨多个块的数据；通过屏障证明并发，不以文件体积或固定延时制造并发。每个等待都有阶段名称和有限 deadline，外层用例 timeout 覆盖阶段预算及清理时间。

### 4.3 运行时取消的验证分支

重点复现三种情况：取消后 fastPut/fastGet 回调不返回、channel 先 close/error、正常完成与取消同时到达。

如果验证证实任务不能结算，修复任务操作封装：

- 同时处理 AbortSignal、SFTP channel close/error 和操作回调，通过一次性结算函数终结等待。
- 成功、失败、取消只有一个最终结果；终结后忽略迟到的进度和回调，移除事件监听器。
- 通道打开途中取消时，迟到返回的 SFTP channel 必须立即关闭；获得的租约也必须释放。
- 文件、目录递归和操作前的 stat/readdir 等等待均覆盖取消路径，避免只修 fastPut/fastGet。
- 只关闭该任务的 SFTP channel 并释放该任务租约；不关闭共享 SSH client，也不触碰其他 PTY/任务。
- `cancelTransfer()` 及 owner cleanup 必须等待真实资源清理完成；不能仅通过 Promise.race 提前返回掩盖后台泄漏。

本分支是有证据后的局部生命周期修复，不预先宣称 ssh2 有缺陷，也不整体替换传输引擎。

### 4.4 清理与失败证据

- fixture 显式统计 SFTP channels、文件句柄、暂停应答和延迟任务；不只看当前已有的 SSH clients/shells/forwards 计数。
- 失败路径在 finally 释放测试屏障，确保不因测试自建屏障阻塞后续清理。
- 即使 manager 清理失败，仍尝试连接、fixture 和临时目录清理；聚合并报告失败，不能吞掉错误制造通过。
- 清理超时记录具体任务、阶段、租约和通道数量。强制 fixture teardown 仅是失败后的兜底，不算取消验收成功。
- 不全局放大 timeout，不通过测试重试掩盖未完成的生命周期。

## 5. PF 启动策略

### 5.1 推荐决策：收掉无效设置，统一显式启动

现有代码没有真正的自动启动消费路径，既有设计要求读取配置不能开启监听。因此本修复采用：

- 移除编辑器的 Start when requested / 请求时启动 复选框和规则列表中的 Policy 列。
- 保留 Save profile、Save and start、Start、Stop/Resume。
- Save profile 只保存；Save and start 保存成功后启动一次；Start/Resume 对用户指定规则调用现有 manager。
- 启动应用、打开 PF 页面、复制 PF 页面到新窗口、导入配置都不会启动监听。
- 已经由用户启动的 loopback 转发在 transport 恢复后仍按既有规则恢复；非 loopback 保留显式恢复。这不依赖 autoStart。
- 远端服务暂时拒绝连接只影响该次 direct-tcpip 通道；不能因此删除规则或把仍有效的本地监听改为用户停止状态。

### 5.2 兼容策略

本补丁不升级 forwarding 文档版本，也不批量重写旧规则：

- `autoStart` 暂留在存储和兼容 contract 中，明确注释为保留字段、没有运行时语义。
- 新规则写 false；编辑已有规则时保留其原值，避免与清理设置无关的数据变化。
- 旧 true/false 文件、配置导入和导出继续可读；无论该值为何都不会隐式启动。
- 表单内部移除该状态，兼容映射集中在请求构造边界。
- v0.8 的 workspace 转发意图使用独立设计，必须显式展示和确认；不把历史 true 值重新解释为用户授权。
- 同步修正当前路线文档中的“可选自动启动”承诺，并在发布说明说明该设置此前没有实际启动效果。旧设计记录可注明被本决策替代。

若未来确有应用启动时自动转发的需求，应单独设计所有权归属、多窗口去重、凭据/Trust 交互和公网绑定确认，再纳入新能力版本。

## 6. 实施顺序与验收

### 6.1 建议拆为三个可审查的改动

1. **History**：记录器、存储更新与 flush、主进程事件接线、History 刷新与未知时长展示、多语言和测试。
2. **验证稳定性**：App 异步测试、SFTP fixture 屏障、取消/清理证据；仅在复现需要时修改 SFTP 生命周期封装。
3. **PF 策略清理**：移除无效控件和 Policy 列、保留旧数据映射、回归与路线/发布说明。

不增加新的公共 command 或 IPC 操作；沿用既有 Session、History、Ports bridge。

### 6.2 验收表

| 编号 | 必须成立的结果 |
| --- | --- |
| H01 | 在线 30 秒、重连等待 10 秒、再在线 20 秒后关闭：同一记录约 50 秒，最终结果 disconnected |
| H02 | 两个同 Host SSH 会话分别计时；关闭 A 不终结 B 的历史 |
| H03 | 初次认证失败记录 failed；连接前取消记录 cancelled 原因；手动重试建立新周期 |
| H04 | 自动重连、重复 connected/closing 和旧 channelGeneration 事件不会重复记录或重复累计 |
| H05 | 清空时的活动/连接中周期不会在后续重连、checkpoint 或关闭时重新出现；之后的新周期可记录 |
| H06 | History 写盘失败不会令已成功建立的 SSH 显示连接失败；正常退出 flush，异常退出显示中断及已记录下界 |
| H07 | 旧数据可读、未知零时长不伪装精确计时；记录被 200 条上限淘汰后不会重新插入 |
| T01 | SFTP 新窗口测试明确等待 open/list 结果，正确显示 `/etc` 内容及后续 PF 路由 |
| T02 | 两个实际同时传输的任务中，取消 A 不依赖其服务器应答，不影响 B 内容及完成结果 |
| T03 | 取消、异常 close/error 和迟到回调均可结算；channel、文件句柄和租约真实回到基线 |
| P01 | 新建/编辑/导入/启动应用/打开 PF 页均不隐式启动；旧 autoStart=true 同样成立 |
| P02 | Save and start、Start、Resume 对目标规则生效一次，保留冲突错误和绑定提示 |
| P03 | 终端关闭和 PF 页面关闭不停止已运行规则；owner 退出仍释放规则；既有重连恢复行为有效 |

实施后先运行关联测试，再运行类型检查、完整测试、生产构建和 diff 检查。异步修复额外覆盖几个受控事件顺序；完整套件须获得无失败结果，单用例通过不能替代。出现新的完整套件失败时继续定位，不把偶然重跑通过作为修复证据。

原生安装和真实主机验收仍单独列为 deferred。此次设计不变更发布版本、不打包或发布。
