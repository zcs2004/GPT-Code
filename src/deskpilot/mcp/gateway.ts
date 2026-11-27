import { createHash, randomUUID } from "node:crypto";
import { DeskPilotEventJournal } from "../events/journal";
import { permissionDecision } from "../permissions/policy";
import type { DeskPilotStore } from "../storage";
import { isTerminalTaskStatus } from "../tasks/state";
import type {
  DeskPilotApproval,
  DeskPilotToolPermission,
  PermissionLevel,
} from "../types";
import { deskPilotMcpToolKey, DeskPilotMcpRegistry } from "./registry";

function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("DeskPilot MCP arguments must contain finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new Error("DeskPilot MCP arguments must be JSON serializable");
  }
  if (seen.has(value)) throw new Error("DeskPilot MCP arguments must not contain cycles");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return "[" + value.map((entry) => canonicalJson(entry, seen)).join(",") + "]";
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonicalJson(record[key], seen));
    return "{" + entries.join(",") + "}";
  } finally {
    seen.delete(value);
  }
}

function mcpResultMetadata(result: unknown, isError: boolean): Record<string, unknown> {
  if (result === null) return { resultType: "null", isError };
  if (Array.isArray(result)) return { resultType: "array", itemCount: result.length, isError };
  if (typeof result !== "object") return { resultType: typeof result, isError };
  const record = result as Record<string, unknown>;
  return {
    resultType: "object",
    isError,
    ...(Array.isArray(record.content) ? { contentItems: record.content.length } : {}),
    ...(Object.prototype.hasOwnProperty.call(record, "structuredContent")
      ? { hasStructuredContent: true }
      : {}),
  };
}

export function hashMcpArguments(args: Record<string, unknown>): string {
  return "sha256:" + createHash("sha256").update(canonicalJson(args)).digest("hex");
}

export interface DeskPilotGatewayInvokeRequest {
  taskId: string;
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  scopeAuthorized: boolean;
}

export type DeskPilotGatewayInvokeResult =
  | {
    status: "approval-required";
    approval: DeskPilotApproval;
    permissionLevel: PermissionLevel;
  }
  | {
    status: "completed" | "tool-error";
    executionId: string;
    result: unknown;
    permissionLevel: PermissionLevel;
  };

export class DeskPilotMcpGateway {
  readonly events: DeskPilotEventJournal;

  constructor(
    private readonly store: DeskPilotStore,
    private readonly registry: DeskPilotMcpRegistry,
    events?: DeskPilotEventJournal,
  ) {
    this.events = events ?? new DeskPilotEventJournal(store);
  }

  setToolPermission(
    toolName: string,
    permissionLevel: PermissionLevel,
    approvalRequired: boolean,
    id: string = randomUUID(),
  ): DeskPilotToolPermission {
    return this.store.toolPermissions.upsert({
      id,
      toolName,
      permissionLevel,
      approvalRequired,
    });
  }

  async invoke(request: DeskPilotGatewayInvokeRequest): Promise<DeskPilotGatewayInvokeResult> {
    const task = this.store.tasks.get(request.taskId);
    if (!task) throw new Error("DeskPilot task not found: " + request.taskId);
    if (isTerminalTaskStatus(task.status)) {
      throw new Error("DeskPilot cannot execute a tool for terminal task: " + request.taskId);
    }

    this.registry.validateArguments(request.serverId, request.toolName, request.arguments);
    const toolKey = deskPilotMcpToolKey(request.serverId, request.toolName);
    const argumentsHash = hashMcpArguments(request.arguments);
    const configured = this.store.toolPermissions.getByToolName(toolKey);
    const permissionLevel = configured?.permissionLevel ?? 5;
    const requiresApproval = (configured?.approvalRequired ?? true)
      || permissionDecision(permissionLevel, {
        scopeAuthorized: request.scopeAuthorized,
      }) === "approval-required";

    if (requiresApproval) {
      const approved = this.store.approvals.findApproved(
        request.taskId,
        toolKey,
        argumentsHash,
      );
      if (!approved) {
        const pending = this.store.approvals.findPending(
          request.taskId,
          toolKey,
          argumentsHash,
        );
        if (pending) {
          return {
            status: "approval-required",
            approval: pending,
            permissionLevel,
          };
        }

        const approval: DeskPilotApproval = {
          id: randomUUID(),
          taskId: request.taskId,
          toolName: toolKey,
          argumentsHash,
          status: "Pending",
          createdAt: new Date().toISOString(),
        };
        this.store.approvals.create(approval);
        this.events.publish("approval.required", request.taskId, {
          approvalId: approval.id,
          toolName: toolKey,
          argumentsHash,
          permissionLevel,
        });
        return {
          status: "approval-required",
          approval,
          permissionLevel,
        };
      }
    }

    const executionId = randomUUID();
    this.events.publish("tool.started", request.taskId, {
      executionId,
      serverId: request.serverId,
      toolName: toolKey,
      argumentsHash,
      permissionLevel,
    });
    try {
      const result = await this.registry.callTool(
        request.serverId,
        request.toolName,
        request.arguments,
        { taskId: request.taskId },
      );
      const isError = Boolean(
        result
        && typeof result === "object"
        && !Array.isArray(result)
        && (result as Record<string, unknown>).isError === true,
      );
      this.events.publish(
        isError ? "tool.failed" : "tool.completed",
        request.taskId,
        {
          executionId,
          serverId: request.serverId,
          toolName: toolKey,
          argumentsHash,
          ...mcpResultMetadata(result, isError),
        },
      );
      return {
        status: isError ? "tool-error" : "completed",
        executionId,
        result,
        permissionLevel,
      };
    } catch (error) {
      this.events.publish("tool.failed", request.taskId, {
        executionId,
        serverId: request.serverId,
        toolName: toolKey,
        argumentsHash,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
