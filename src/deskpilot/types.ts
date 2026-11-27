export const TASK_STATUSES = [
  "Pending",
  "Running",
  "WaitingApproval",
  "WaitingTool",
  "Completed",
  "Failed",
  "Cancelled",
] as const;

export type TaskStatus = typeof TASK_STATUSES[number];

export const PERMISSION_LEVELS = [0, 1, 2, 3, 4, 5] as const;

export type PermissionLevel = typeof PERMISSION_LEVELS[number];

export const MCP_TRANSPORTS = ["stdio", "streamable-http", "tunnel"] as const;

export type McpTransport = typeof MCP_TRANSPORTS[number];

export interface DeskPilotConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeskPilotTask {
  id: string;
  conversationId: string;
  status: TaskStatus;
  description: string;
  createdAt: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

export interface DeskPilotApproval {
  id: string;
  taskId: string;
  toolName: string;
  argumentsHash: string;
  status: "Pending" | "Approved" | "Denied" | "Expired";
  createdAt: string;
}

export interface DeskPilotActivityLog {
  id: string;
  taskId: string;
  eventType: string;
  details: unknown;
  createdAt: string;
}

export interface DeskPilotMcpServer {
  id: string;
  name: string;
  transport: McpTransport;
  config: unknown;
  enabled: boolean;
}

export interface DeskPilotToolPermission {
  id: string;
  toolName: string;
  permissionLevel: PermissionLevel;
  approvalRequired: boolean;
}

export interface PermissionContext {
  /** Whether the user has explicitly authorized the containing workspace or resource scope. */
  scopeAuthorized: boolean;
}

export type PermissionDecision = "allow" | "approval-required";
