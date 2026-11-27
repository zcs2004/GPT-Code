# GPT Code Windows 安装与使用说明

适用版本：V0.1.x
目标平台：Windows 10/11 x64
部署方式：本机单用户

> GPT Code 现在使用独立于上游参考项目 `Codex Web GPT` 的应用身份：`appId = dev.gptcode.desktop`、独立 NSIS GUID、`%APPDATA%\GPT Code` 生产数据目录与 `persist:gpt-code-chatgpt` 浏览器分区。内部 `DeskPilot` 模块名和数据子目录暂时作为兼容层保留，不代表对外产品名称。

## 1. 安装前准备

正式使用应选择通过发布流程生成并完成 Authenticode 签名验证的 Windows x64 安装包。开发目录中的未签名构建只用于开发验证，不能作为正式发布验收依据。

安装前确认：

- Windows 10/11 x64 当前用户可以正常运行桌面应用。
- 需要使用的 ChatGPT 账户可以正常登录 `chatgpt.com`。
- 如需通过 ChatGPT Connector 调用本地工具，需要可用的 OpenAI Tunnel，以及仅用于 Tunnel 的认证凭据。
- 如需访问本地项目文件，提前确定要明确授权给 DeskPilot 的目录；未授权目录不会成为 DeskPilot 工作空间。
- 正式 Stage 5 验收应使用干净 Windows 用户环境。若同一用户已经安装相同 NSIS GUID 的版本，package smoke 会在安装动作前失败关闭，以免覆盖真实用户环境。

DeskPilot 不要求把 ChatGPT Cookie、Tunnel 密钥或工作空间内容写入项目仓库。不要把 Tunnel 凭据、登录数据或本机私有数据复制到日志、issue 或聊天消息中。

## 2. 安装与首次启动

1. 运行 Windows x64 安装程序。
2. 按当前用户安装；0.1 的 NSIS 配置为 per-user，不要求切换到 per-machine 安装。
3. 从桌面或开始菜单启动应用。
4. 首次启动时选择界面语言并完成 Launcher 设置。
5. 打开内置 Browser，登录 ChatGPT。

应用使用独立的 Electron 持久化浏览器分区保存 ChatGPT 会话，不需要导入其他浏览器 Cookie。Windows 生产 userData 当前固定在：

```text
%APPDATA%\GPT Code
```

其中 DeskPilot 数据位于：

```text
%APPDATA%\GPT Code\DeskPilot
```

ChatGPT 持久化浏览器分区使用冻结身份：

```text
persist:gpt-code-chatgpt
```

Windows 版会在打开持久化状态、浏览器会话和 DeskPilot 数据前检查并加固生产数据目录的 DACL。安全检查失败时应先处理诊断结果，不要通过修改代码、关闭检查或把私有目录改成公共可写目录来绕过。

## 3. ChatGPT 与运行模式

Launcher 继续提供现有 Browser、Setup、MCP 和 Diagnostics 页面，同时增加 DeskPilot 工作台。

### 3.1 Automatic

Automatic 用于自动化 ChatGPT Web 交互和正式 Stage 5 MCP 验收。浏览器自动化只在该模式下执行。

### 3.2 Zero Risk

Zero Risk 是引导式手动模式。该模式不会执行自动 DOM 检查，因此不能用来完成 Stage 5 的真实 MCP acceptance。需要使用 Zero Risk 时，按界面提示创建并手动选择它自己的独立 Connector 和 Tunnel 凭据。

Automatic 与 Zero Risk 的 MCP 凭据分别保存、分别清除；清除一个模式的凭据不应把另一个模式的密钥暴露到 Renderer snapshot、普通日志或命令行参数中。

## 4. 配置 ChatGPT Connector 与 MCP

在 Launcher 的 MCP 页面按界面显示的步骤配置。0.1 当前流程为：

1. 创建 OpenAI Tunnel，并取得 Tunnel ID。
2. 创建只用于运行 Tunnel 的普通 API key，并赋予 Tunnel Read + Use 所需权限。
3. 在 Launcher 中填写 Tunnel ID 与 API key，等待本地 Tunnel 进入可用状态。
4. 在 ChatGPT 设置中启用 Developer Mode。
5. 在 ChatGPT Plugins 中创建新的 Connector：
   - 连接方式选择 Tunnel；
   - 选择刚才创建的 Tunnel；
   - Authentication 选择 None；
   - Connector 名称必须使用 Launcher 当前界面显示的准确名称；
   - Permissions 选择 Allow all actions，避免 ChatGPT 在请求到达本地 DeskPilot/Codex 权限层之前拦截需要审批的工具。
6. 回到 Launcher 执行 MCP 验证。

Tunnel 凭据属于运行连接所需的认证材料，不是模型推理 API Key。Windows managed tunnel key 使用 CurrentUser DPAPI 静态保护；明文密钥不得进入普通日志或进程 argv。

## 5. GPT Code 工作台

GPT Code 侧栏当前提供 AI 对话、配置、MCP、活动、使用限额，以及“支持”分组下的技术支持和捐款入口。任务中心与工作空间页面已经移除；编码任务、终端、文件修改和审批继续由原生 Codex 负责。

### 5.1 绑定 ChatGPT 会话

在内置 Browser 打开一个正常的 ChatGPT 对话页。DeskPilot 只绑定 Launcher `home` 主表面的当前 `https://chatgpt.com/c/<id>` 会话；切到非会话页面或其他表面时，实时绑定会被清除。

DeskPilot Task ID、Conversation ID 和 Delivery ID 与上游 Codex Turn Broker 身份分离。工具结果返回前会再次校验当前 ChatGPT 会话和 delivery lease，避免把结果发送到已经切换的会话。

### 5.2 管理 DeskPilot MCP Server

1. 打开 **DeskPilot → MCP Tools / MCP 工具**。
2. 选择 **Add MCP server / 添加 MCP Server**。
3. 填写本地 MCP Server 配置。
4. 新 Server 默认保持 disabled，确认配置后再显式启用。
5. 启用后执行连接测试/工具发现，检查工具名称和 Schema。

MCP 原始配置、工具原始参数和原始结果不进入 Renderer 的普通 snapshot。工具执行由 DeskPilot Core 和 Gateway 处理。

### 5.3 任务与审批边界

权限等级由本地 DeskPilot Gateway 判断。V0.1 中，只有明确授权范围内的 L0 操作可以自动执行；L1 及以上操作要求具体审批。

审批绑定：

- Task ID；
- 具体工具；
- 参数摘要/hash；
- 当前待执行状态。

如果工具、目标文件或参数在审批后发生变化，原审批不能继续授权新的操作。

Launcher 只在 AI 对话的上下文侧栏展示当前活动任务和待审批数量，不提供独立任务中心或保存工作历史。实际编码任务、文件操作、终端和审批在原生 Codex 中处理；取消任务会使仍未处理的本地审批失效。

### 5.4 支持

“支持”分组位于“使用限额”下方。技术支持页面显示联系方式和每次 6 元的说明；捐款页面提供支付宝与微信支付二维码。捐款完全自愿，不影响软件功能或技术支持顺序。

## 6. 配置持久化与重新启动

Windows Stage 5 要求配置在重新启动 Launcher 后能够恢复。当前 package smoke 使用两个独立 Launcher 进程验证持久化状态恢复，并同时检查 DeskPilot SQLite 迁移和 durable runtime。

普通使用时可以按以下方式自检：

1. 完成语言、模式、MCP 和必要的工作空间设置。
2. 正常退出 Launcher。
3. 重新启动应用。
4. 确认语言、Launcher 设置和需要保留的本地配置仍然存在。
5. 打开 ChatGPT Browser，确认持久化会话按预期恢复；若会话已经失效，重新登录即可。

Launcher JSON 状态使用原子写入和最后良好状态备份。DeskPilot SQLite 在迁移前后执行完整性检查，升级旧 schema 前会保留迁移恢复点；损坏数据库不会被静默覆盖成一个新的空数据库。

## 7. Diagnostics 与 Stage 5 MCP 验收

正式发布验收使用 **Settings → Diagnostics → Run Stage 5 MCP acceptance**。

该操作只用于：

- Windows；
- packaged production Launcher；
- Automatic 模式；
- 当前没有其他活动 Codex turn；
- 已安装 EXE 具有有效 Authenticode 签名；
- production userData、DeskPilot 和 ChatGPT partition 通过私有 DACL 检查。

正式验收顺序为：

```text
signed installed release gate
→ runtime doctor
→ connector verification
→ real read-only MCP acceptance
```

真实 MCP acceptance 会要求 ChatGPT 调用一次只读的 `deskpilot_acceptance_probe`。成功时 Launcher 写入受限的 v2 evidence：

```text
%APPDATA%\GPT Code\DeskPilot\stage5-mcp-acceptance.json
```

该 evidence 不保存安装路径、证书 subject/thumbprint、probe ID、receipt、runtime key、原始 MCP payload、工作空间正文或拟写入正文。它只在有限 freshness 窗口内有效，并绑定当时已安装 EXE 的 SHA-256。

发布操作员在源码/发布工作区中还应在卸载前执行：

```powershell
cd launcher
npx -y bun@1.4.0 run verify:stage5-windows
```

终态 verifier 是只读检查：它不会安装/卸载应用，不会调用 ChatGPT、Connector 或 MCP，也不会读取用户 workspace。它会重新检查注册安装身份、Authenticode、当前 EXE SHA-256、生产数据 ACL、evidence 文件自身 ACL、evidence schema 和 freshness。只有该命令在正式签名安装和真实 MCP acceptance 之后通过，才能作为 Stage 5 终态验收证据之一。

## 8. 卸载

使用 Windows **设置 → 应用 → 已安装的应用** 中对应的应用条目执行卸载。

正式 Stage 5 验收要求：

- 安装程序创建的主程序被卸载；
- 外部用户工作空间中的文件不被修改或删除；
- Launcher/DeskPilot 用户数据不会被卸载程序意外删除或改写。

当前 0.1 的 package smoke 会在卸载前保存 Launcher state、DeskPilot 数据库及迁移恢复文件的原始字节，卸载后逐字节复核，并另外验证一个应用目录之外的 workspace 文件保持不变。

如果用户主动希望清除本机保存的 ChatGPT 会话、Launcher 设置和 DeskPilot 兼容层数据，应先退出应用并确认不再需要这些数据，再手工处理 `%APPDATA%\GPT Code`。这属于用户主动的数据清除操作，不属于普通卸载流程。

## 9. 常见问题

### 安装包显示 NotSigned

这表示它不是可用于正式 Stage 5 发布验收的签名安装包。开发构建可以用于代码和打包链验证，但不能替代正式 Authenticode 证据。

### Stage 5 MCP acceptance 按钮无法运行

先确认当前是 Windows packaged production Launcher、Automatic 模式、没有活动 Codex turn，并且当前安装 EXE 是有效签名版本。第一道 release gate 失败时不会继续访问 runtime、Connector 或 ChatGPT。

### MCP Connector 验证失败

依次检查 Tunnel 是否运行、Launcher 中 Tunnel 配置是否对应当前账户、ChatGPT Developer Mode 是否开启、Connector 是否选择正确 Tunnel、Authentication 是否为 None，以及 Connector 名称是否与 Launcher 显示的名称完全一致。

### 工作空间文件无法访问

确认目录已经通过 **Workspaces / 工作空间** 明确授权，并且目标路径位于该授权根目录内部。DeskPilot 会拒绝路径遍历和链接逃逸。

### 写文件时出现审批

这是预期行为。新建、覆盖、删除等操作需要本地权限层按风险级别处理。审批只授权当前显示的具体工具和参数，不是对后续任意写入的永久授权。

### ChatGPT 登录失效

重新在内置 Browser 登录。登录会话和 MCP Tunnel 凭据是不同的数据，不要通过复制 Cookie、导入其他浏览器配置或关闭本地安全检查来修复登录问题。

## 10. 正式 Stage 5 发布验收清单

正式标记 Windows 产品化通过前，应取得以下实际证据：

- 使用有效 Windows 发布证书生成正式安装包。
- 安装包 Authenticode 状态为 `Valid`，且存在 signer certificate。
- 安装后的主程序 EXE 同样为 `Valid`，并与安装包保持 publisher continuity。
- 在干净 Windows 10/11 x64 当前用户环境完成安装并成功启动。
- 正常登录 ChatGPT。
- 成功连接 MCP Connector。
- 重新启动 Launcher 后配置恢复。
- production userData、DeskPilot、ChatGPT browser partition 和 acceptance evidence 通过私有 Windows ACL 检查。
- 在 Automatic 模式完成真实 `deskpilot_acceptance_probe` 往返并生成 v2 evidence。
- 卸载前 `verify:stage5-windows` 通过。
- 完成卸载，并证明外部用户 workspace 未被修改或删除。

构建成功、自动化测试通过、开发机未签名安装包可生成，均不能单独替代以上正式验收证据。
