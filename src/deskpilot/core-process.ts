import { randomUUID } from "node:crypto";
import { DeskPilotMcpRegistry } from "./mcp/registry";
import { DeskPilotOrchestrator, type DeskPilotMcpToolTaskInput } from "./orchestrator";
import { deskPilotLauncherSnapshot } from "./launcher-command";
import { DeskPilotStore } from "./storage";
import { deliverDeskPilotToolResult, DeskPilotChatGptDeliveryError } from "./chatgpt-delivery";
import {
  deskPilotConversationFromBrowser,
  type DeskPilotBrowserConversationInput,
  type DeskPilotConversationBinding,
} from "./conversation-binding";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

interface CoreRequest {
  id: string;
  method: string;
  params?: unknown;
}

interface CoreResponse {
  id: string;
  result?: unknown;
  error?: { message: string };
}

interface InMemoryToolDelivery {
  taskId: string;
  conversationId: string;
  result: unknown;
  state: "ready" | "delivering";
}

interface DeskPilotCurrentMcpToolInput {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export type DeskPilotDeliveryExecutor = typeof deliverDeskPilotToolResult;

function objectParam(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) throw new Error(label + " is required");
  return result;
}

function taskInput(value: unknown): DeskPilotMcpToolTaskInput {
  const input = objectParam(value, "DeskPilot Core task.startMcpTool params");
  const args = objectParam(input.arguments, "DeskPilot Core MCP arguments");
  const taskId = typeof input.taskId === "string" && input.taskId.trim()
    ? input.taskId.trim()
    : undefined;
  return {
    conversationId: requiredString(input.conversationId, "DeskPilot conversationId"),
    description: requiredString(input.description, "DeskPilot task description"),
    serverId: requiredString(input.serverId, "DeskPilot MCP serverId"),
    toolName: requiredString(input.toolName, "DeskPilot MCP toolName"),
    arguments: args,
    ...(taskId ? { taskId } : {}),
  };
}

function currentMcpToolInput(value: unknown): DeskPilotCurrentMcpToolInput {
  const input = objectParam(value, "DeskPilot Core task.startCurrentMcpTool params");
  const args = objectParam(input.arguments, "DeskPilot Core MCP arguments");
  return {
    serverId: requiredString(input.serverId, "DeskPilot MCP serverId"),
    toolName: requiredString(input.toolName, "DeskPilot MCP toolName"),
    arguments: args,
  };
}

export class DeskPilotCoreService {
  private readonly completions = new Map<string, ReturnType<DeskPilotOrchestrator["waitForTask"]>>();
  private readonly deliveries = new Map<string, InMemoryToolDelivery>();
  private currentConversation?: DeskPilotConversationBinding;

  constructor(
    readonly store: DeskPilotStore,
    readonly registry: DeskPilotMcpRegistry,
    readonly orchestrator: DeskPilotOrchestrator,
    private readonly browserDescriptorPath?: string,
    private readonly deliveryExecutor: DeskPilotDeliveryExecutor = deliverDeskPilotToolResult,
  ) {}

  static open(databasePath: string, browserDescriptorPath?: string): DeskPilotCoreService {
    const store = DeskPilotStore.open(databasePath);
    const registry = new DeskPilotMcpRegistry(store);
    const orchestrator = new DeskPilotOrchestrator(store, registry);
    return new DeskPilotCoreService(store, registry, orchestrator, browserDescriptorPath);
  }

  private trackStartedTask(started: ReturnType<DeskPilotOrchestrator["startMcpToolTask"]>): void {
    const completion = started.completion;
    this.completions.set(started.task.id, completion);
    void completion.then(completed => {
      if (completed.task.status === "Completed" && completed.tool !== undefined) {
        this.deliveries.set(started.task.id, {
          taskId: started.task.id,
          conversationId: started.task.conversationId,
          result: completed.tool.result,
          state: "ready",
        });
      }
    }).finally(() => {
      if (this.completions.get(started.task.id) === completion) this.completions.delete(started.task.id);
    }).catch(() => {});
  }

  private async mcpInventory(): Promise<Record<string, unknown>> {
    const servers: Array<Record<string, unknown>> = [];
    for (const server of this.store.mcpServers.list().filter(item => item.enabled)) {
      try {
        const tools = await this.registry.connect(server.id);
        servers.push({
          id: server.id,
          name: server.name,
          kind: "external",
          transport: server.transport,
          tools,
        });
      } catch {
        servers.push({
          id: server.id,
          name: server.name,
          kind: "external",
          transport: server.transport,
          unavailable: true,
        });
      }
    }
    return {
      currentConversation: this.currentConversation
        ? {
          id: this.currentConversation.id,
          title: this.currentConversation.title,
        }
        : null,
      servers,
    };
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (method === "health") {
      return { version: 1, status: "ready" };
    }
    if (method === "snapshot") {
      return this.snapshot();
    }
    if (method === "mcp.inventory") {
      return await this.mcpInventory();
    }
    if (method === "conversation.bindBrowser") {
      const input = objectParam(params, "DeskPilot Core conversation.bindBrowser params");
      const bindingInput: DeskPilotBrowserConversationInput = {
        activeTabId: requiredString(input.activeTabId, "DeskPilot browser activeTabId"),
        url: typeof input.url === "string" ? input.url : "",
        title: typeof input.title === "string" ? input.title : "",
      };
      const binding = deskPilotConversationFromBrowser(bindingInput);
      this.currentConversation = binding;
      if (binding) {
        const now = new Date().toISOString();
        const existing = this.store.conversations.get(binding.id);
        this.store.conversations.upsert({
          id: binding.id,
          title: binding.title,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
      }
      return { binding: binding ?? null, snapshot: this.snapshot() };
    }
    if (method === "task.startMcpTool") {
      const started = this.orchestrator.startMcpToolTask(taskInput(params));
      this.trackStartedTask(started);
      return { task: started.task, snapshot: this.snapshot() };
    }
    if (method === "task.startCurrentMcpTool") {
      const binding = this.currentConversation;
      if (!binding) throw new Error("DeskPilot requires an active ChatGPT conversation before invoking tools");
      const input = currentMcpToolInput(params);
      const started = this.orchestrator.startMcpToolTask({
        conversationId: binding.id,
        description: `ChatGPT tool: ${input.serverId}::${input.toolName}`,
        serverId: input.serverId,
        toolName: input.toolName,
        arguments: input.arguments,
      });
      this.trackStartedTask(started);
      return { task: started.task, snapshot: this.snapshot() };
    }
    if (method === "task.consumeMcpResult") {
      const input = objectParam(params, "DeskPilot Core task.consumeMcpResult params");
      const taskId = requiredString(input.taskId, "DeskPilot taskId");
      const task = this.store.tasks.get(taskId);
      if (!task) throw new Error("DeskPilot task not found: " + taskId);
      if (this.orchestrator.hasActiveTask(taskId)) {
        return { ready: false, terminal: false, task, snapshot: this.snapshot() };
      }
      if (task.status !== "Completed") {
        return { ready: false, terminal: true, task, snapshot: this.snapshot() };
      }
      const delivery = this.deliveries.get(taskId);
      if (!delivery || delivery.state !== "ready") {
        return { ready: false, terminal: true, task, snapshot: this.snapshot() };
      }
      const binding = this.currentConversation;
      if (!binding || binding.id !== task.conversationId || binding.id !== delivery.conversationId) {
        throw new Error("DeskPilot task result does not match the current ChatGPT conversation");
      }
      this.deliveries.delete(taskId);
      return { ready: true, terminal: true, task, result: delivery.result };
    }
    if (method === "task.wait") {
      const input = objectParam(params, "DeskPilot Core task.wait params");
      const taskId = requiredString(input.taskId, "DeskPilot taskId");
      const completion = this.completions.get(taskId) ?? this.orchestrator.waitForTask(taskId);
      if (!completion) {
        const task = this.store.tasks.get(taskId);
        if (!task) throw new Error("DeskPilot task not found: " + taskId);
        return { task, snapshot: this.snapshot() };
      }
      try {
        const result = await completion;
        return { task: result.task, snapshot: this.snapshot() };
      } finally {
        this.completions.delete(taskId);
      }
    }
    if (method === "task.isActive") {
      const input = objectParam(params, "DeskPilot Core task.isActive params");
      const taskId = requiredString(input.taskId, "DeskPilot taskId");
      return { active: this.orchestrator.hasActiveTask(taskId) };
    }
    if (method === "task.cancel") {
      const input = objectParam(params, "DeskPilot Core task.cancel params");
      const taskId = requiredString(input.taskId, "DeskPilot taskId");
      this.deliveries.delete(taskId);
      const task = await this.orchestrator.cancel(taskId, "Cancelled by user");
      return { task, snapshot: this.snapshot() };
    }
    if (method === "task.deliver") {
      const input = objectParam(params, "DeskPilot Core task.deliver params");
      const taskId = requiredString(input.taskId, "DeskPilot taskId");
      const delivery = this.deliveries.get(taskId);
      if (!delivery) throw new Error("DeskPilot task has no undelivered MCP result: " + taskId);
      if (delivery.state !== "ready") throw new Error("DeskPilot task result is already being delivered: " + taskId);
      const task = this.store.tasks.get(taskId);
      if (!task || task.status !== "Completed") {
        this.deliveries.delete(taskId);
        throw new Error("DeskPilot can only deliver a completed task result: " + taskId);
      }
      const binding = this.currentConversation;
      if (!binding || binding.id !== task.conversationId || binding.id !== delivery.conversationId) {
        throw new Error("DeskPilot task result does not match the current ChatGPT conversation");
      }
      if (!this.browserDescriptorPath) {
        throw new Error("DeskPilot ChatGPT delivery requires the Launcher browser descriptor");
      }
      const deliveryId = randomUUID();
      delivery.state = "delivering";
      try {
        await this.deliveryExecutor(this.browserDescriptorPath, {
          deliveryId,
          taskId,
          conversationId: binding.id,
          chatGptConversationId: binding.chatGptConversationId,
          result: delivery.result,
        });
        this.deliveries.delete(taskId);
        return { delivered: true, deliveryId, task, snapshot: this.snapshot() };
      } catch (error) {
        if (error instanceof DeskPilotChatGptDeliveryError && error.mayHaveSubmitted) {
          this.deliveries.delete(taskId);
        } else if (this.deliveries.get(taskId) === delivery) {
          delivery.state = "ready";
        }
        throw error;
      }
    }
    if (method === "approval.hasWaiter") {
      const input = objectParam(params, "DeskPilot Core approval.hasWaiter params");
      const approvalId = requiredString(input.approvalId, "DeskPilot approvalId");
      return { active: this.orchestrator.hasApprovalWaiter(approvalId) };
    }
    if (method === "approval.decide") {
      const input = objectParam(params, "DeskPilot Core approval.decide params");
      const approvalId = requiredString(input.approvalId, "DeskPilot approvalId");
      const decision = input.decision;
      if (decision !== "Approved" && decision !== "Denied") {
        throw new Error("DeskPilot approval decision must be Approved or Denied");
      }
      const approval = await this.orchestrator.decideApproval(approvalId, decision);
      return { approval, snapshot: this.snapshot() };
    }
    if (method === "mcp.disconnect") {
      const input = objectParam(params, "DeskPilot Core mcp.disconnect params");
      const serverId = requiredString(input.serverId, "DeskPilot MCP serverId");
      await this.registry.disconnect(serverId);
      return { disconnected: true };
    }
    if (method === "shutdown") {
      this.deliveries.clear();
      await this.orchestrator.shutdown();
      return { status: "stopped", snapshot: this.snapshot() };
    }
    throw new Error("Unknown DeskPilot Core method: " + method);
  }

  async close(): Promise<void> {
    this.deliveries.clear();
    await this.orchestrator.shutdown().catch(() => {});
    await this.registry.close().catch(() => {});
    this.store.close();
  }

  private snapshot() {
    return deskPilotLauncherSnapshot(this.store, this.currentConversation);
  }
}

function parseRequest(line: string): CoreRequest {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("DeskPilot Core request is not valid JSON");
  }
  const input = objectParam(value, "DeskPilot Core request");
  return {
    id: requiredString(input.id, "DeskPilot Core request id"),
    method: requiredString(input.method, "DeskPilot Core request method"),
    ...(input.params === undefined ? {} : { params: input.params }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runDeskPilotCoreProcess(databasePath?: string): Promise<void> {
  const resolvedDatabasePath = databasePath ?? process.env.DESKPILOT_DATABASE_PATH?.trim();
  if (!resolvedDatabasePath) {
    throw new Error("DeskPilot Core requires DESKPILOT_DATABASE_PATH");
  }
  const browserDescriptorPath = process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR?.trim();
  const service = DeskPilotCoreService.open(resolvedDatabasePath, browserDescriptorPath || undefined);
  let buffered = "";
  let bufferedBytes = 0;
  const decoder = new TextDecoder();
  try {
    for await (const chunk of Bun.stdin.stream()) {
      const text = decoder.decode(chunk, { stream: true });
      buffered += text;
      bufferedBytes += Buffer.byteLength(text);
      if (bufferedBytes > MAX_REQUEST_BYTES && !buffered.includes("\n")) {
        throw new Error("DeskPilot Core request exceeds maximum size");
      }
      while (true) {
        const newline = buffered.indexOf("\n");
        if (newline < 0) break;
        const rawLine = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        bufferedBytes = Buffer.byteLength(buffered);
        if (Buffer.byteLength(rawLine) > MAX_REQUEST_BYTES) {
          throw new Error("DeskPilot Core request exceeds maximum size");
        }
        const line = rawLine.trim();
        if (!line) continue;
        let requestId = "unknown";
        let response: CoreResponse;
        try {
          const request = parseRequest(line);
          requestId = request.id;
          response = { id: request.id, result: await service.request(request.method, request.params) };
        } catch (error) {
          response = { id: requestId, error: { message: errorMessage(error) } };
        }
        process.stdout.write(JSON.stringify(response) + "\n");
        if (response.result && typeof response.result === "object"
          && (response.result as { status?: unknown }).status === "stopped") {
          return;
        }
      }
    }
    buffered += decoder.decode();
    if (buffered.trim()) throw new Error("DeskPilot Core stdin ended with an incomplete request");
  } finally {
    await service.close();
  }
}
