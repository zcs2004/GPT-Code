# GPT Code 架构落地方案

## 1. 分层

DeskPilot 在上游 `codex-chatgpt-web` 上采用四层结构：

```text
DeskPilot Launcher / React Workbench
        │ Electron IPC
        ▼
DeskPilot Core
  ├─ Conversation Service
  ├─ Task Manager
  ├─ Workspace Service
  ├─ Permission Manager
  ├─ MCP Registry / Gateway
  └─ DeskPilot SQLite Store
        │ adapters
        ├───────────────┐
        ▼               ▼
ChatGPT Web Bridge    External MCP Servers
  ├─ Browser Worker    ├─ stdio
  ├─ Responses/SSE     └─ Streamable HTTP
  └─ Secure Tunnel
```

## 2. 上游适配原则

ChatGPT Web Bridge 继续负责“把请求可靠地送入已登录 ChatGPT Web 会话并取回响应”。DeskPilot Core 不直接操作 DOM，也不持有 ChatGPT cookie。

DeskPilot MCP Gateway 负责产品权限。任何模型发起的工具调用，都必须在 Gateway 中经过：工具查找 → 参数 Schema 校验 → 权限级别判断 → 必要审批 → 执行 → 结果归档。ChatGPT 的提示词不能绕过这条链。

## 3. 任务与工具绑定

每一次工具调用至少绑定：

- `taskId`
- `conversationId`
- `toolName`
- 参数摘要 hash
- permission level
- approval id（需要审批时）
- execution id

审批只对“同一个工具 + 同一个参数摘要 + 同一个任务”有效。参数变化后重新审批。

## 4. 工作空间授权

DeskPilot 工作空间是用户显式添加的目录记录。它和上游 Codex 环境中的 workspace roots 是不同概念。

文件工具只允许解析到已授权根目录内部。路径规范化、junction/symlink、大小写和 `..` 逃逸都必须在 Gateway/Workspace 层统一处理，Renderer 不承担安全判断。

## 5. 数据存储

V0.1.0 使用 DeskPilot 自有 SQLite。数据库文件放在 Electron app data 的 DeskPilot 私有目录，不放工作空间，也不复用 Codex SQLite。

首批表按 PRD 建立：`conversations`、`tasks`、`mcp_servers`、`tool_permissions`、`approvals`、`activity_logs`。正式建库前先确定 schema version 和迁移机制。
