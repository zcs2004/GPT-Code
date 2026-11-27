import { randomUUID } from "node:crypto";
import { DeskPilotMcpGateway, type DeskPilotGatewayInvokeResult } from "./mcp/gateway";
import { DeskPilotMcpRegistry } from "./mcp/registry";
import type { DeskPilotStore } from "./storage";
import { DeskPilotTaskManager } from "./tasks/manager";
import type { DeskPilotApproval, DeskPilotTask } from "./types";

interface ApprovalWaiter {
  taskId: string;
  resolve(): void;
  reject(error: Error): void;
}

export interface DeskPilotMcpToolTaskInput {
  conversationId: string;
  description: string;
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  taskId?: string;
}

export interface DeskPilotMcpToolExecution {
  executionId: string;
  permissionLevel: number;
  result: unknown;
}

export interface DeskPilotOrchestratedTaskCompletion {
  task: DeskPilotTask;
  tool?: DeskPilotMcpToolExecution;
}

export interface DeskPilotStartedTask {
  task: DeskPilotTask;
  completion: Promise<DeskPilotOrchestratedTaskCompletion>;
}

/**
 * Resident in-process coordinator for DeskPilot task lifecycle + MCP execution.
 *
 * Raw MCP arguments/results stay in this process. Persisted task/activity records
 * contain only the task description, approval hash, execution metadata, and a
 * safe completion summary. This is the layer a long-running Core daemon can own.
 */
export class DeskPilotOrchestrator {
  readonly tasks: DeskPilotTaskManager;
  readonly gateway: DeskPilotMcpGateway;

  private readonly runs = new Map<string, Promise<DeskPilotOrchestratedTaskCompletion>>();
  private readonly approvalWaiters = new Map<string, ApprovalWaiter>();

  constructor(
    private readonly store: DeskPilotStore,
    private readonly registry: DeskPilotMcpRegistry,
    tasks?: DeskPilotTaskManager,
    gateway?: DeskPilotMcpGateway,
  ) {
    this.tasks = tasks ?? new DeskPilotTaskManager(store);
    this.gateway = gateway ?? new DeskPilotMcpGateway(store, registry, this.tasks.events);
  }

  startMcpToolTask(input: DeskPilotMcpToolTaskInput): DeskPilotStartedTask {
    const conversationId = input.conversationId.trim();
    const description = input.description.trim();
    const serverId = input.serverId.trim();
    const toolName = input.toolName.trim();
    if (!conversationId) throw new Error("DeskPilot orchestrator conversationId is required");
    if (!description) throw new Error("DeskPilot orchestrator task description is required");
    if (!serverId) throw new Error("DeskPilot orchestrator MCP serverId is required");
    if (!toolName) throw new Error("DeskPilot orchestrator MCP toolName is required");
    if (!input.arguments || typeof input.arguments !== "object" || Array.isArray(input.arguments)) {
      throw new Error("DeskPilot orchestrator MCP arguments must be an object");
    }

    const now = new Date().toISOString();
    if (!this.store.conversations.get(conversationId)) {
      this.store.conversations.create({
        id: conversationId,
        title: description,
        createdAt: now,
        updatedAt: now,
      });
    }

    const task = this.tasks.create({
      id: input.taskId?.trim() || randomUUID(),
      conversationId,
      description,
      createdAt: now,
    });
    const toolArguments = structuredClone(input.arguments);
    let toolExecution: DeskPilotMcpToolExecution | undefined;
    const completion = this.tasks.run(task.id, async context => {
      context.reportProgress({ phase: "mcp.connecting", serverId, toolName });
      context.waitForTool({ phase: "mcp.connecting", serverId, toolName });
      await this.registry.connect(serverId);
      context.resume({ phase: "mcp.connected", serverId, toolName });

      let result = await this.invokeTool(context, {
        taskId: task.id,
        serverId,
        toolName,
        arguments: toolArguments,
        scopeAuthorized: false,
      });
      if (result.status === "approval-required") {
        context.waitForApproval({
          approvalId: result.approval.id,
          toolName: result.approval.toolName,
          argumentsHash: result.approval.argumentsHash,
          permissionLevel: result.permissionLevel,
        });
        await this.waitForApproval(task.id, result.approval, context.registerCleanup);
        context.resume({ approvalId: result.approval.id, decision: "Approved" });
        result = await this.invokeTool(context, {
          taskId: task.id,
          serverId,
          toolName,
          arguments: toolArguments,
          scopeAuthorized: false,
        });
      }
      if (result.status === "approval-required") {
        throw new Error("DeskPilot approval did not authorize the exact MCP tool arguments");
      }
      context.reportProgress({
        phase: result.status === "completed" ? "mcp.completed" : "mcp.tool-error",
        executionId: result.executionId,
        serverId,
        toolName,
      });
      toolExecution = {
        executionId: result.executionId,
        permissionLevel: result.permissionLevel,
        result: result.result,
      };
      if (result.status === "tool-error") {
        throw new Error("DeskPilot MCP tool returned an error result");
      }
      return {
        kind: "mcp-tool",
        executionId: result.executionId,
        serverId,
        toolName,
        permissionLevel: result.permissionLevel,
        status: "completed",
      };
    }).then(taskResult => ({
      task: taskResult,
      ...(toolExecution === undefined ? {} : { tool: toolExecution }),
    }));

    this.runs.set(task.id, completion);
    void completion.finally(() => {
      if (this.runs.get(task.id) === completion) this.runs.delete(task.id);
    }).catch(() => {});
    return { task, completion };
  }

  async decideApproval(
    approvalId: string,
    decision: "Approved" | "Denied",
  ): Promise<DeskPilotApproval> {
    const approval = this.store.approvals.get(approvalId);
    if (!approval) throw new Error("DeskPilot approval not found: " + approvalId);
    if (approval.status !== "Pending") {
      throw new Error(`DeskPilot approval is already settled: ${approvalId} (${approval.status})`);
    }
    const waiter = this.approvalWaiters.get(approvalId);
    if (decision === "Approved" && !waiter) {
      throw new Error("DeskPilot approval is not attached to an active orchestrator task: " + approvalId);
    }
    const decided = this.store.approvals.decide(approvalId, decision);
    if (decision === "Approved") {
      waiter!.resolve();
    } else {
      await this.cancel(approval.taskId, "Approval denied by user");
    }
    return decided;
  }

  async cancel(taskId: string, reason = "Cancelled by user"): Promise<DeskPilotTask> {
    return await this.tasks.cancel(taskId, reason);
  }

  waitForTask(taskId: string): Promise<DeskPilotOrchestratedTaskCompletion> | undefined {
    return this.runs.get(taskId);
  }

  hasActiveTask(taskId: string): boolean {
    return this.runs.has(taskId);
  }

  hasApprovalWaiter(approvalId: string): boolean {
    return this.approvalWaiters.has(approvalId);
  }

  async shutdown(reason = "DeskPilot Core shutting down"): Promise<void> {
    const taskIds = [...this.runs.keys()];
    await Promise.allSettled(taskIds.map(taskId => this.cancel(taskId, reason)));
    await Promise.allSettled([...this.runs.values()]);
  }

  private async invokeTool(
    context: Parameters<Parameters<DeskPilotTaskManager["run"]>[1]>[0],
    request: Parameters<DeskPilotMcpGateway["invoke"]>[0],
  ): Promise<DeskPilotGatewayInvokeResult> {
    context.waitForTool({
      phase: "mcp.calling",
      serverId: request.serverId,
      toolName: request.toolName,
    });
    const result = await this.gateway.invoke(request);
    context.resume({
      phase: result.status === "approval-required" ? "mcp.approval-required" : "mcp.result-received",
      serverId: request.serverId,
      toolName: request.toolName,
    });
    return result;
  }

  private waitForApproval(
    taskId: string,
    approval: DeskPilotApproval,
    registerCleanup: Parameters<Parameters<DeskPilotTaskManager["run"]>[1]>[0]["registerCleanup"],
  ): Promise<void> {
    if (this.approvalWaiters.has(approval.id)) {
      throw new Error("DeskPilot approval already has an active waiter: " + approval.id);
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const removeCleanup = registerCleanup(() => {
        if (settled) return;
        settled = true;
        this.approvalWaiters.delete(approval.id);
        reject(new Error("DeskPilot approval wait cancelled: " + approval.id));
      });
      this.approvalWaiters.set(approval.id, {
        taskId,
        resolve: () => {
          if (settled) return;
          settled = true;
          this.approvalWaiters.delete(approval.id);
          removeCleanup();
          resolve();
        },
        reject: (error) => {
          if (settled) return;
          settled = true;
          this.approvalWaiters.delete(approval.id);
          removeCleanup();
          reject(error);
        },
      });
    });
  }
}
