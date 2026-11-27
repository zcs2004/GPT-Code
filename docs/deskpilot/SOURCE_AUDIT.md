# GPT Code 上游源码审计

审计日期：2026-11-24
工作目录：`D:\mcpcll`
上游：`miuuyy/codex-chatgpt-web`
上游基线：`v6.2.0` / `fc701f6fbcff9fb65f679445389aca0c60410271`
DeskPilot 开发分支：`deskpilot/v0.1`

## 1. 审计结论

当前上游已经包含需求文档中计划复用的大部分底层能力，而且成熟度高于最初方案假设。DeskPilot 不应重写 ChatGPT Web 浏览器自动化、Responses/SSE、MCP 直连和 Tunnel 生命周期。第一阶段应把这些能力当作稳定基础设施，在其上新增 DeskPilot 产品层。

建议的长期边界是：

- `src/adapters/chatgpt-web/**`、`src/chatgpt-ui/**`：尽量保持上游兼容，只在必须修复兼容性问题时修改。
- `src/responses/**`、`src/bridge.ts`、`src/server.ts`：保留为 ChatGPT Responses 桥接层，通过适配器向 DeskPilot 暴露能力。
- `src/tunnel.ts`、`src/tunnel-service.ts`、Launcher runtime supervisor：继续复用上游 Tunnel 机制。
- `src/deskpilot/**`：新增 DeskPilot 的领域模型、任务、工作空间、权限、通用 MCP Gateway、存储与安全策略。
- `launcher/src/**`：逐步从“上游控制中心”演进为 DeskPilot 三栏工作台，但保留 Browser/Setup/MCP 的现有入口直到替代功能验收完成。

## 2. 实际源码与需求文档映射

| 需求能力 | 当前源码位置 | 处理策略 |
| --- | --- | --- |
| Electron Launcher | `launcher/electron/**`, `launcher/src/**` | 保留主进程与安全 IPC，逐步改造 Renderer 产品界面 |
| ChatGPT Browser Worker | `src/adapters/chatgpt-web/browser-worker.ts`, `launcher/electron/browser-host.cjs` | 核心复用，避免修改 DOM 契约 |
| ChatGPT UI 契约 | `src/chatgpt-ui/**` | 视为脆弱边界，只做兼容性修复 |
| Responses Bridge / SSE | `src/server.ts`, `src/bridge.ts`, `src/responses/**` | 核心复用，后续增加 DeskPilot 内部服务适配层 |
| MCP Server / Broker | `src/adapters/chatgpt-web/mcp-server.ts`, `turn-broker.ts`, `mcp-main.ts` | 保留 Codex 传输契约；DeskPilot 新建通用 Registry/Gateway，不直接把现有 broker 当通用权限层 |
| Secure Tunnel | `src/tunnel.ts`, `src/tunnel-service.ts`, Launcher runtime | 直接复用 |
| 登录与持久会话 | `launcher/electron/chatgpt-auth-session.cjs`, `browser-host.cjs`, profile/state | 直接复用 |
| 诊断/健康检查 | `src/doctor.ts`, `src/service.ts`, Launcher Activity/Doctor | 保留并扩展 DeskPilot 诊断项 |
| 工作空间 | 当前只有 Codex 上下文中的 workspace authority | 新建 DeskPilot Workspace 模块，不能把 Codex task workspace 当产品工作空间数据库 |
| 任务中心 | 当前 Launcher 仅展示活动 Browser tab/turn | 新建持久 Task Manager 与事件流 |
| 权限系统 | 当前权限由外部 Codex turn/sandbox/approval 提供 | 新建 DeskPilot 本地 Gateway 权限层，审批绑定工具与参数摘要 |
| SQLite | 上游只在读取 Codex 自身状态时使用 `bun:sqlite` | 新建 DeskPilot 自有 SQLite 数据库和迁移体系 |

## 3. 关键差异

### 3.1 当前 Launcher 不是 DeskPilot 工作台

`launcher/src/App.tsx` 当前的主要 Surface 是 Browser、Setup、MCP、Activity、Limits 和 Settings。它能够显示活动任务和嵌入浏览器，但没有需求文档定义的独立对话列表、工作空间树、持久任务中心、文件编辑器和审批面板。

因此 UI 改造应采用渐进式方式：先保留现有 Browser/Setup/MCP 能力，再增加 DeskPilot 导航与工作台，不在第一步删除现有页面。

### 3.2 现有 MCP 是“ChatGPT ↔ Codex turn”桥，不是通用本地工具平台

现有 `mcp-server.ts` 的核心职责是把 ChatGPT Connector 的调用绑定到一个具体 Codex turn token，并调用该 turn 已暴露的原生工具。它已经具备很强的 turn 隔离和超时处理，但权限来源仍属于 Codex。

DeskPilot 的通用 MCP Gateway 应作为单独领域层实现：注册本地 MCP Server、发现工具、校验 Schema、映射权限等级、创建审批、执行调用、记录审计，再把结果交回会话层。

### 3.3 DeskPilot 需要自己的持久化模型

需求中的 conversations、tasks、mcp_servers、tool_permissions、approvals、activity_logs 目前没有对应的 DeskPilot 数据库。不能依赖 Codex 的 `state_5.sqlite`，因为那是外部产品状态且只被上游用于恢复/验证 Codex 任务环境。

## 4. 第一批代码边界

本次初始化新增 `src/deskpilot/**`，先建立产品领域契约：

- 任务状态机；
- 权限等级与默认审批策略；
- 统一事件类型；
- Task/Approval 基础类型。

这些模块不依赖 Browser DOM、不依赖 Codex task，也不会改变上游当前运行路径。后续 Gateway、Storage、Workspace 和 Launcher UI 都应依赖这层契约。

## 5. 基线验证结果

环境没有全局 Bun，因此使用项目要求的 Bun `1.4.0` 通过 `npx bun@1.4.0` 执行开发命令，未修改系统级 Bun 安装。

已确认：

- 根目录 TypeScript typecheck 可以启动；
- Launcher TypeScript typecheck 通过；
- Launcher 测试绝大多数通过；
- 当前 Windows 会话存在两个环境限制：
  - `fs.symlinkSync` 测试因 Windows 当前用户没有符号链接权限而报 `EPERM`；
  - Windows installer 测试因本机 PowerShell ExecutionPolicy 禁止运行 `.ps1` 而失败。

这两类失败属于当前开发机权限/策略条件，不能解释为 DeskPilot 改动导致的源码回归。后续 CI 应在具备 Developer Mode/符号链接权限且允许测试脚本执行的 Windows runner 上再做完整验证。

## 6. 当前不做的改动

- 不修改 ChatGPT DOM 选择器。
- 不更换现有 Tunnel 协议和 connector identity。
- 不把 Codex turn broker 直接改名后当作通用 MCP Gateway。
- 不在尚未建立迁移策略前写入新的持久数据库。
- 不在第一批改动中移除 Codex 专属模块；先通过适配层隔离，再逐步替换。
