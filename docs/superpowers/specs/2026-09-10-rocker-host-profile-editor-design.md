# Rocker SSH Host Profile Editor Design

## Goal

将 New Host 和 Edit Host 收敛为同一套 SSH Host Profile 编辑器。编辑器只
覆盖 Rocker 当前支持的 SSH 配置，并把公钥登录与 Snippets 作为明确的可选
能力保存到主机配置中。

## Scope

- 支持 `Label`、`Address`、`Parent group`。
- SSH 区域支持 `Port`、`Username`、`Password` 和可选的 `Public key login`。
- 仅保留 SSH。MOSH 和 Telnet 不进入界面、类型、存储或 IPC 合约。
- Terminal 区域支持可选的 `Snippets`、`Charset` 和主机主题色。
- 复用现有 HostStore、凭据保护、Bootstrap 脱敏和 SSH connection manager。
- 不在本次实现 Snippet 执行、远端字符集转换或自定义 ANSI 主题编辑器。

## Data Contract

`HostProfile` 增加以下可选字段，旧数据缺失时保持兼容：

```ts
type HostCharset = "utf-8" | "gb18030" | "iso-8859-1"
type HostThemeColor = "rocker" | "amber" | "ocean" | "slate"

interface HostProfile {
  publicKeyEnabled?: boolean
  snippetsEnabled?: boolean
  snippetCollection?: string
  charset?: HostCharset
  themeColor?: HostThemeColor
}
```

- `charset` 缺失或非法时按 `utf-8` 展示。
- `themeColor` 缺失或非法时按 `rocker` 展示。
- `publicKeyEnabled` 缺失时由 `authMethod === "privateKey"` 推导为启用，
  以兼容现有私钥主机。
- 公钥开关关闭时，`authMethod` 只能是 `password` 或 `agent`，并且不会
  要求 `identityFile`。
- 公钥开关启用时，`authMethod` 为 `privateKey`。新建主机必须填写
  `identityFile`；编辑已有主机时，空输入表示保留 Main 进程中已脱敏的已有
  路径，使用 `hasIdentityFile: true` 的现有 redacted save 合约。
- Snippets 关闭时 `snippetCollection` 可为空并从保存 payload 中省略。
  启用时必须填写非空 collection 名称。本版本只保存选择，不执行命令。
- `Parent group` 是可选值。空白值会从保存 payload 中省略；编辑已有的无分组
  主机时不回填新建主机的默认分组。
- Password 和 passphrase 仍通过现有 `HostSaveRequest.credentials` 写入受保护
  的凭据存储，绝不写入 HostProfile 或 renderer state 的持久化快照。

## Layout and Interaction

- New/Edit 使用同一个右侧 drawer，标题和 footer 按模式变化。
- 表单按 `Identity`、`SSH connection`、`Terminal preferences` 分组。
- 公钥登录和 Snippets 使用开关；关闭时隐藏对应条件字段，启用时显示并
  通过原生 required 校验。
- Charset 初始选中 `UTF-8`。
- 主题色是主机级 session/card accent 的偏好，不改变远程 shell 的 ANSI
  字符映射；本次先可靠保存，为后续 session 主题消费保留字段。
- 所有新增可见文本均提供 English 和 Simplified Chinese 翻译。

## Security and Compatibility

- Main 进程继续校验 Host Profile 的边界和条件字段。
- Bootstrap 继续移除 `identityFile`，只暴露 `hasIdentityFile`。
- 编辑器不回显现有密码、passphrase 或私钥路径；只有用户输入新路径时才
  发送路径，空路径配合 `hasIdentityFile` 表示保留原值。
- 归一化非法可选元数据时回退到安全默认值，不因单个旧字段破坏整个 Hosts
  数据集。
- 新的无效写入必须被 Main / storage 明确拒绝，不能静默跳过。保存失败时编辑器
  保留非敏感表单内容并显示通用错误，不暴露底层存储细节。

## Acceptance Criteria

1. New Host 默认 charset 为 UTF-8，公钥和 Snippets 关闭，MOSH/Telnet 不可见。
2. 启用公钥后 Set a key 出现并在新建时必填；编辑已有密钥可留空保留旧路径。
3. 启用 Snippets 后 collection 出现并必填，关闭时可空且不阻塞保存。
4. 保存结果包含 group、charset、themeColor 及开关状态，凭据仍走原有安全通道。
5. 旧 Host JSON、Bootstrap redaction、配置导入导出和现有 SSH 连接测试继续通过。
