import type { Database } from "bun:sqlite";
import { assertTaskStatusTransition, isTerminalTaskStatus } from "../tasks/state";
import type {
  DeskPilotActivityLog,
  DeskPilotApproval,
  DeskPilotConversation,
  DeskPilotMcpServer,
  DeskPilotTask,
  DeskPilotToolPermission,
  McpTransport,
  PermissionLevel,
  TaskStatus,
} from "../types";

interface ConversationRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  conversation_id: string;
  workspace_id: string | null;
  status: TaskStatus;
  description: string;
  created_at: string;
  completed_at: string | null;
  result_json: string | null;
  error: string | null;
}

interface ApprovalRow {
  id: string;
  task_id: string;
  tool_name: string;
  arguments_hash: string;
  status: DeskPilotApproval["status"];
  created_at: string;
}

interface ActivityLogRow {
  id: string;
  task_id: string;
  event_type: string;
  details: string;
  created_at: string;
}

interface McpServerRow {
  id: string;
  name: string;
  transport: McpTransport;
  config: string;
  enabled: 0 | 1;
}

interface ToolPermissionRow {
  id: string;
  tool_name: string;
  permission_level: PermissionLevel;
  approval_required: 0 | 1;
}

function conversationFromRow(row: ConversationRow): DeskPilotConversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function taskFromRow(row: TaskRow): DeskPilotTask {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    status: row.status,
    description: row.description,
    createdAt: row.created_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    ...(row.result_json === null ? {} : { result: JSON.parse(row.result_json) }),
    ...(row.error === null ? {} : { error: row.error }),
  };
}

function approvalFromRow(row: ApprovalRow): DeskPilotApproval {
  return {
    id: row.id,
    taskId: row.task_id,
    toolName: row.tool_name,
    argumentsHash: row.arguments_hash,
    status: row.status,
    createdAt: row.created_at,
  };
}

function activityLogFromRow(row: ActivityLogRow): DeskPilotActivityLog {
  return {
    id: row.id,
    taskId: row.task_id,
    eventType: row.event_type,
    details: JSON.parse(row.details),
    createdAt: row.created_at,
  };
}

function mcpServerFromRow(row: McpServerRow): DeskPilotMcpServer {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    config: JSON.parse(row.config),
    enabled: row.enabled === 1,
  };
}

function toolPermissionFromRow(row: ToolPermissionRow): DeskPilotToolPermission {
  return {
    id: row.id,
    toolName: row.tool_name,
    permissionLevel: row.permission_level,
    approvalRequired: row.approval_required === 1,
  };
}

function toJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export class ConversationRepository {
  constructor(private readonly database: Database) {}

  create(conversation: DeskPilotConversation): DeskPilotConversation {
    this.database
      .query(`
        INSERT INTO conversations (id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(conversation.id, conversation.title, conversation.createdAt, conversation.updatedAt);
    return conversation;
  }

  get(id: string): DeskPilotConversation | undefined {
    const row = this.database
      .query("SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?")
      .get(id) as ConversationRow | null;
    return row === null ? undefined : conversationFromRow(row);
  }

  upsert(conversation: DeskPilotConversation): DeskPilotConversation {
    this.database
      .query(`
        INSERT INTO conversations (id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          updated_at = excluded.updated_at
      `)
      .run(conversation.id, conversation.title, conversation.createdAt, conversation.updatedAt);
    return this.get(conversation.id)!;
  }
}

export class McpServerRepository {
  constructor(private readonly database: Database) {}

  create(server: DeskPilotMcpServer): DeskPilotMcpServer {
    const config = JSON.stringify(server.config);
    if (config === undefined) {
      throw new Error("DeskPilot MCP server config must be JSON serializable");
    }
    this.database
      .query(`
        INSERT INTO mcp_servers (id, name, transport, config, enabled)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(server.id, server.name, server.transport, config, server.enabled ? 1 : 0);
    return server;
  }

  get(id: string): DeskPilotMcpServer | undefined {
    const row = this.database
      .query("SELECT * FROM mcp_servers WHERE id = ?")
      .get(id) as McpServerRow | null;
    return row === null ? undefined : mcpServerFromRow(row);
  }

  list(): DeskPilotMcpServer[] {
    const rows = this.database
      .query("SELECT * FROM mcp_servers ORDER BY name ASC, id ASC")
      .all() as McpServerRow[];
    return rows.map(mcpServerFromRow);
  }

  setEnabled(id: string, enabled: boolean): DeskPilotMcpServer {
    const result = this.database
      .query("UPDATE mcp_servers SET enabled = ? WHERE id = ?")
      .run(enabled ? 1 : 0, id);
    if (result.changes === 0) throw new Error("DeskPilot MCP server not found: " + id);
    return this.get(id)!;
  }

  remove(id: string): boolean {
    return this.database.query("DELETE FROM mcp_servers WHERE id = ?").run(id).changes > 0;
  }
}

export class ToolPermissionRepository {
  constructor(private readonly database: Database) {}

  upsert(permission: DeskPilotToolPermission): DeskPilotToolPermission {
    this.database
      .query(`
        INSERT INTO tool_permissions (
          id,
          tool_name,
          permission_level,
          approval_required
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(tool_name) DO UPDATE SET
          permission_level = excluded.permission_level,
          approval_required = excluded.approval_required
      `)
      .run(
        permission.id,
        permission.toolName,
        permission.permissionLevel,
        permission.approvalRequired ? 1 : 0,
      );
    return this.getByToolName(permission.toolName)!;
  }

  getByToolName(toolName: string): DeskPilotToolPermission | undefined {
    const row = this.database
      .query("SELECT * FROM tool_permissions WHERE tool_name = ?")
      .get(toolName) as ToolPermissionRow | null;
    return row === null ? undefined : toolPermissionFromRow(row);
  }
}

export class TaskRepository {
  constructor(private readonly database: Database) {}

  create(task: DeskPilotTask): DeskPilotTask {
    this.database
      .query(`
        INSERT INTO tasks (
          id,
          conversation_id,
          workspace_id,
          status,
          description,
          created_at,
          completed_at,
          result_json,
          error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        task.id,
        task.conversationId,
        null,
        task.status,
        task.description,
        task.createdAt,
        task.completedAt ?? null,
        toJson(task.result),
        task.error ?? null,
      );
    return task;
  }

  get(id: string): DeskPilotTask | undefined {
    const row = this.database
      .query("SELECT * FROM tasks WHERE id = ?")
      .get(id) as TaskRow | null;
    return row === null ? undefined : taskFromRow(row);
  }

  listByConversation(conversationId: string): DeskPilotTask[] {
    const rows = this.database
      .query(`
        SELECT *
        FROM tasks
        WHERE conversation_id = ?
        ORDER BY created_at DESC, id DESC
      `)
      .all(conversationId) as TaskRow[];
    return rows.map(taskFromRow);
  }

  list(limit = 100): DeskPilotTask[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("DeskPilot task list limit must be an integer between 1 and 1000");
    }
    const rows = this.database
      .query(`
        SELECT *
        FROM tasks
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `)
      .all(limit) as TaskRow[];
    return rows.map(taskFromRow);
  }

  transition(
    id: string,
    targetStatus: TaskStatus,
    options: { completedAt?: string; result?: unknown; error?: string } = {},
  ): DeskPilotTask {
    const current = this.get(id);
    if (!current) throw new Error(`DeskPilot task not found: ${id}`);
    assertTaskStatusTransition(current.status, targetStatus);

    const completedAt = isTerminalTaskStatus(targetStatus)
      ? options.completedAt ?? new Date().toISOString()
      : current.completedAt ?? null;
    const result = options.result === undefined ? current.result : options.result;
    const error = options.error === undefined ? current.error : options.error;

    this.database
      .query(`
        UPDATE tasks
        SET status = ?, completed_at = ?, result_json = ?, error = ?
        WHERE id = ?
      `)
      .run(targetStatus, completedAt, toJson(result), error ?? null, id);

    return this.get(id)!;
  }
}

export class ApprovalRepository {
  constructor(private readonly database: Database) {}

  create(approval: DeskPilotApproval): DeskPilotApproval {
    this.database
      .query(`
        INSERT INTO approvals (id, task_id, tool_name, arguments_hash, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        approval.id,
        approval.taskId,
        approval.toolName,
        approval.argumentsHash,
        approval.status,
        approval.createdAt,
      );
    return approval;
  }

  get(id: string): DeskPilotApproval | undefined {
    const row = this.database
      .query("SELECT * FROM approvals WHERE id = ?")
      .get(id) as ApprovalRow | null;
    return row === null ? undefined : approvalFromRow(row);
  }

  decide(
    id: string,
    status: Exclude<DeskPilotApproval["status"], "Pending">,
  ): DeskPilotApproval {
    const current = this.get(id);
    if (!current) throw new Error(`DeskPilot approval not found: ${id}`);
    if (current.status !== "Pending") {
      throw new Error(`DeskPilot approval is already settled: ${id} (${current.status})`);
    }

    this.database
      .query("UPDATE approvals SET status = ? WHERE id = ? AND status = 'Pending'")
      .run(status, id);
    return this.get(id)!;
  }

  findApproved(
    taskId: string,
    toolName: string,
    argumentsHash: string,
  ): DeskPilotApproval | undefined {
    const row = this.database
      .query(`
        SELECT *
        FROM approvals
        WHERE task_id = ?
          AND tool_name = ?
          AND arguments_hash = ?
          AND status = 'Approved'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `)
      .get(taskId, toolName, argumentsHash) as ApprovalRow | null;
    return row === null ? undefined : approvalFromRow(row);
  }

  findPending(
    taskId: string,
    toolName: string,
    argumentsHash: string,
  ): DeskPilotApproval | undefined {
    const row = this.database
      .query(`
        SELECT *
        FROM approvals
        WHERE task_id = ?
          AND tool_name = ?
          AND arguments_hash = ?
          AND status = 'Pending'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `)
      .get(taskId, toolName, argumentsHash) as ApprovalRow | null;
    return row === null ? undefined : approvalFromRow(row);
  }

  listPending(limit = 100): DeskPilotApproval[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("DeskPilot approval list limit must be an integer between 1 and 1000");
    }
    const rows = this.database
      .query(`
        SELECT *
        FROM approvals
        WHERE status = 'Pending'
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `)
      .all(limit) as ApprovalRow[];
    return rows.map(approvalFromRow);
  }

  expirePendingForTask(taskId: string): number {
    return this.database
      .query("UPDATE approvals SET status = 'Expired' WHERE task_id = ? AND status = 'Pending'")
      .run(taskId).changes;
  }
}

export class ActivityLogRepository {
  constructor(private readonly database: Database) {}

  append(log: DeskPilotActivityLog): DeskPilotActivityLog {
    const details = JSON.stringify(log.details);
    if (details === undefined) {
      throw new Error("DeskPilot activity log details must be JSON serializable");
    }
    this.database
      .query(`
        INSERT INTO activity_logs (id, task_id, event_type, details, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(log.id, log.taskId, log.eventType, details, log.createdAt);
    return log;
  }

  listForTask(taskId: string): DeskPilotActivityLog[] {
    const rows = this.database
      .query(`
        SELECT *
        FROM activity_logs
        WHERE task_id = ?
        ORDER BY created_at ASC, rowid ASC
      `)
      .all(taskId) as ActivityLogRow[];
    return rows.map(activityLogFromRow);
  }

  listRecent(limit = 100): DeskPilotActivityLog[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("DeskPilot activity list limit must be an integer between 1 and 1000");
    }
    const rows = this.database
      .query(`
        SELECT *
        FROM activity_logs
        ORDER BY created_at DESC, rowid DESC
        LIMIT ?
      `)
      .all(limit) as ActivityLogRow[];
    return rows.map(activityLogFromRow);
  }
}
