# Rocker Hosts Card Design

## Goal

把 Hosts 页面收敛为现代专业工具型的主机卡片工作区，降低扫描成本，并让“搜索已保存主机”和“输入 SSH 命令”共用一个入口。

## Scope

本次范围只覆盖 Hosts renderer UI、主机平台元数据的可选字段、搜索过滤和 SSH 命令完整性校验。SSH 连接复用、凭据存储、Host Key 校验、终端 session 生命周期不改动；命令连接通过现有 HostProfile/Session 入口进入，不创建第二套连接路径。

## Layout

- Hosts 页面不再使用左侧主机分组栏，也不再使用表格列。
- 页面顶部保留标题、主机数量、导入和添加主机操作。
- 搜索框位于内容区顶部，占满可用宽度。
- 搜索框右侧内嵌 `Connect` 按钮，与输入框共享一个视觉容器。
- 主机以紧凑网格展示，卡片根据工作区宽度使用 1 至 4 列。
- 页面背景、卡片和控件使用默认 `#0AA344` Rocker 主题，不引入新的主题系统。

## Card Content

卡片默认只显示三层信息：

1. 平台标识：已知 Ubuntu 使用 Ubuntu 标识，已知 Debian 使用 Debian 标识；未知或未设置平台使用 Rocker `R` 标识。
2. 主机名：作为卡片主视觉，字号明显高于辅助信息。
3. 连接摘要：固定显示 `SSH · <username>`。

地址、端口、分组、备注、收藏状态不在卡片上显示。它们仍保留在主机模型和编辑器中。

`HostProfile.platform` 是可选字段，当前允许 `ubuntu`、`debian` 和 `linux`。缺失时必须回退到 Rocker `R`，不能因为旧数据没有平台字段而阻塞加载。

## Interaction

- 单击卡片：只改变选中状态，不连接。
- 双击卡片：调用现有 `onConnect(host)`，连接行为继续由 App 和 SSH 层负责。
- 卡片悬停：显示编辑图标，点击编辑图标只打开现有编辑器，不触发卡片选择或连接。
- 卡片上不显示三点菜单、收藏按钮或连接按钮。
- 搜索框普通文本：过滤主机名、地址、用户名和分组。
- 搜索框输入完整 SSH 命令：保留卡片列表可见，`Connect` 变为可用。
- `Connect` 默认禁用并使用灰色；只有完整命令才变为绿色。
- 当前版本完整命令格式为 `ssh [user@]host [-p port]`，端口必须为 1 至 65535。未识别的复杂参数保持静默，不显示额外解析面板。
- 按回车与点击 `Connect` 使用同一校验入口。未通过校验时不触发连接。
- 完整命令命中已保存的 `host + port + username` 时复用该 HostProfile。
- 完整命令指向新目标且包含用户名时，创建一个使用 SSH Agent 的主机配置并交给现有连接流程；不保存密码或私钥。
- `ssh host` 没有用户名时不直接连接，打开预填充的主机编辑器，由用户补齐用户名和认证方式。

## Accessibility

- 搜索输入使用明确 placeholder：`Find a host or ssh user@hostname`。
- 编辑按钮使用 `Edit <host name>` accessible label。
- 卡片使用可聚焦的 button 语义；双击连接行为由卡片容器处理。
- 禁用状态使用原生 `disabled`，而不是只依赖颜色。

## Data Compatibility

- `platform` 为可选字段，旧 workspace、旧导入文件和旧 host JSON 无需迁移。
- storage normalize 只接受定义中的平台值；非法值按无平台处理，避免破坏整个 Hosts 数据集。
- 本次不自动探测远程发行版。平台标识来自显式的主机元数据，可在主机编辑器中选择，后续再考虑连接探测。

## Acceptance Criteria

- Hosts 页面没有左侧分组栏和表格列。
- 卡片默认不显示三点，悬停显示编辑图标。
- `G11` 等主机名在卡片中作为清晰的主视觉。
- 未知平台显示 `R`，Ubuntu/Debian 显示对应标识。
- `Connect` 默认灰色，完整 SSH 命令输入后才变绿并可点击。
- 单击只选中，双击调用既有连接回调。
- 现有安全能力被禁用时，添加、导入、编辑和卡片连接都不会执行。
