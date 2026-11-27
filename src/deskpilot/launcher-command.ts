import { randomUUID } from "node:crypto";
import {
  DeskPilotMcpRegistry,
  deskPilotStdioConfig,
  deskPilotStreamableHttpConfig,
} from "./mcp";
import { DeskPilotStore } from "./storage";
import { DeskPilotTaskManager } from "./tasks/manager";
import type { DeskPilotConversationBinding } from "./conversation-binding";

export interface DeskPilotLauncherSnapshot {
  version: 1;
  summary: {
    tasks: number;
    activeTasks: number;
    pendingApprovals: number;
    mcpServers: number;
    enabledMcpServers: number;
  };
  tasks: ReturnType<DeskPilotStore["tasks"]["list"]>;
  pendingApprovals: Array<{
    id: string;
    taskId: string;
    toolName: string;
    argumentsHash: string;
    status: "Pending";
    createdAt: string;
    taskDescription: string;
  }>;
  recentActivity: ReturnType<DeskPilotStore["activityLogs"]["listRecent"]>;
  mcpServers: Array<{
    id: string;
    name: string;
    transport: string;
    enabled: boolean;
  }>;
  currentConversation?: DeskPilotConversationBinding;
}

export interface DeskPilotLauncherCommandOptions {
  databasePath?: string;
  commandInput?: unknown;
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function assertNoArgs(args: string[]): void {
  if (args.length > 0) throw new Error(`Unknown DeskPilot arguments: ${args.join(" ")}`);
}

function databasePathFor(args: string[], options: DeskPilotLauncherCommandOptions): string {
  const explicit = options.databasePath ?? takeOption(args, "--database")
    ?? process.env.DESKPILOT_DATABASE_PATH?.trim();
  if (!explicit) {
    throw new Error("DeskPilot database path is required through --database or DESKPILOT_DATABASE_PATH");
  }
  return explicit;
}

function objectInput(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be an object");
  }
  return value as Record<string, unknown>;
}

async function commandInputFor(
  options: DeskPilotLauncherCommandOptions,
  inputFromStdin: boolean,
): Promise<unknown> {
  if (options.commandInput !== undefined) return options.commandInput;
  if (!inputFromStdin) throw new Error("DeskPilot command input is required");
  const raw = (await Bun.stdin.text()).trim();
  if (!raw) throw new Error("DeskPilot command input stdin is empty");
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      "DeskPilot command input stdin is invalid JSON: "
      + (cause instanceof Error ? cause.message : String(cause)),
    );
  }
}

function mcpServerSummary(server: {
  id: string;
  name: string;
  transport: string;
  enabled: boolean;
}): { id: string; name: string; transport: string; enabled: boolean } {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    enabled: server.enabled,
  };
}

export function deskPilotLauncherSnapshot(
  store: DeskPilotStore,
  currentConversation?: DeskPilotConversationBinding,
): DeskPilotLauncherSnapshot {
  // The renderer receives only live task state for the AI chat context panel, never saved work
  // history. Terminal rows stay in the private store for lifecycle integrity and upgrades.
  const tasks = store.tasks.list().filter(task =>
    task.status === "Pending"
      || task.status === "Running"
      || task.status === "WaitingApproval"
      || task.status === "WaitingTool"
  );
  const tasksById = new Map(tasks.map(task => [task.id, task]));
  const pendingApprovals = store.approvals.listPending().map(approval => {
    const task = tasksById.get(approval.taskId);
    return {
      id: approval.id,
      taskId: approval.taskId,
      toolName: approval.toolName,
      argumentsHash: approval.argumentsHash,
      status: "Pending" as const,
      createdAt: approval.createdAt,
      taskDescription: task?.description ?? approval.taskId,
    };
  });
  const servers = store.mcpServers.list();
  const activeTasks = tasks.length;
  return {
    version: 1,
    summary: {
      tasks: tasks.length,
      activeTasks,
      pendingApprovals: pendingApprovals.length,
      mcpServers: servers.length,
      enabledMcpServers: servers.filter(server => server.enabled).length,
    },
    tasks,
    pendingApprovals,
    recentActivity: store.activityLogs.listRecent(),
    mcpServers: servers.map(server => ({
      id: server.id,
      name: server.name,
      transport: server.transport,
      enabled: server.enabled,
    })),
    ...(currentConversation ? { currentConversation } : {}),
  };
}

export async function runDeskPilotLauncherCommand(
  inputArgs: string[],
  options: DeskPilotLauncherCommandOptions = {},
): Promise<unknown> {
  const args = [...inputArgs];
  const databasePath = databasePathFor(args, options);
  const store = DeskPilotStore.open(databasePath);
  try {
    const command = args.shift() ?? "snapshot";
    if (command === "snapshot") {
      assertNoArgs(args);
      return deskPilotLauncherSnapshot(store);
    }

    if (command === "mcp") {
      const action = args.shift() ?? "list";
      if (action === "list") {
        assertNoArgs(args);
        return { servers: deskPilotLauncherSnapshot(store).mcpServers };
      }
      if (action === "add") {
        const inputFromStdin = takeFlag(args, "--input-stdin");
        assertNoArgs(args);
        const input = objectInput(
          await commandInputFor(options, inputFromStdin),
          "DeskPilot MCP add input",
        );
        const name = typeof input.name === "string" ? input.name.trim() : "";
        if (!name || name.length > 120) {
          throw new Error("DeskPilot MCP server name must be between 1 and 120 characters");
        }
        const transport = input.transport ?? "stdio";
        const configInput = input.config ?? {
          command: input.command,
          args: input.args,
          cwd: input.cwd,
          env: input.env,
        };
        if (transport !== "stdio" && transport !== "streamable-http") {
          throw new Error("DeskPilot MCP launcher supports stdio and streamable-http servers");
        }
        const registry = new DeskPilotMcpRegistry(store);
        try {
          const server = registry.addServer({
            id: randomUUID(),
            name,
            transport,
            config: transport === "stdio"
              ? deskPilotStdioConfig(configInput)
              : deskPilotStreamableHttpConfig(configInput),
            enabled: false,
          });
          return { server: mcpServerSummary(server), snapshot: deskPilotLauncherSnapshot(store) };
        } finally {
          await registry.close().catch(() => {});
        }
      }
      if (action === "enable" || action === "disable") {
        const id = takeOption(args, "--id")?.trim();
        assertNoArgs(args);
        if (!id) throw new Error("DeskPilot MCP " + action + " requires --id");
        const registry = new DeskPilotMcpRegistry(store);
        try {
          const server = await registry.setEnabled(id, action === "enable");
          return { server: mcpServerSummary(server), snapshot: deskPilotLauncherSnapshot(store) };
        } finally {
          await registry.close().catch(() => {});
        }
      }
      if (action === "remove") {
        const id = takeOption(args, "--id")?.trim();
        assertNoArgs(args);
        if (!id) throw new Error("DeskPilot MCP remove requires --id");
        const registry = new DeskPilotMcpRegistry(store);
        try {
          const removed = await registry.removeServer(id);
          return { removed, snapshot: deskPilotLauncherSnapshot(store) };
        } finally {
          await registry.close().catch(() => {});
        }
      }
      if (action === "test") {
        const id = takeOption(args, "--id")?.trim();
        assertNoArgs(args);
        if (!id) throw new Error("DeskPilot MCP test requires --id");
        const registry = new DeskPilotMcpRegistry(store);
        try {
          const tools = await registry.connect(id);
          return {
            serverId: id,
            tools: tools.map(tool => ({
              name: tool.name,
              ...(tool.description === undefined ? {} : { description: tool.description }),
              inputSchema: tool.inputSchema,
              ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
            })),
          };
        } finally {
          await registry.close().catch(() => {});
        }
      }
      throw new Error("Unknown DeskPilot MCP action: " + action);
    }

    if (command === "approvals") {
      const action = args.shift() ?? "list";
      if (action === "list") {
        assertNoArgs(args);
        return { approvals: deskPilotLauncherSnapshot(store).pendingApprovals };
      }
      if (action === "decide") {
        const id = takeOption(args, "--id")?.trim();
        const decision = takeOption(args, "--decision")?.trim();
        assertNoArgs(args);
        if (!id) throw new Error("DeskPilot approval decide requires --id");
        if (decision !== "Approved" && decision !== "Denied") {
          throw new Error("DeskPilot approval decision must be Approved or Denied");
        }
        const approval = store.approvals.decide(id, decision);
        store.activityLogs.append({
          id: randomUUID(),
          taskId: approval.taskId,
          eventType: decision === "Approved" ? "approval.approved" : "approval.denied",
          details: {
            approvalId: approval.id,
            toolName: approval.toolName,
            argumentsHash: approval.argumentsHash,
            status: approval.status,
          },
          createdAt: new Date().toISOString(),
        });
        return { approval, snapshot: deskPilotLauncherSnapshot(store) };
      }
      throw new Error(`Unknown DeskPilot approvals action: ${action}`);
    }

    if (command === "tasks") {
      const action = args.shift() ?? "list";
      if (action === "list") {
        assertNoArgs(args);
        return { tasks: store.tasks.list(), recentActivity: store.activityLogs.listRecent() };
      }
      if (action === "cancel") {
        const id = takeOption(args, "--id")?.trim();
        assertNoArgs(args);
        if (!id) throw new Error("DeskPilot task cancel requires --id");
        const manager = new DeskPilotTaskManager(store);
        const task = await manager.cancel(id);
        return { task, snapshot: deskPilotLauncherSnapshot(store) };
      }
      throw new Error(`Unknown DeskPilot tasks action: ${action}`);
    }

    throw new Error(`Unknown DeskPilot command: ${command}`);
  } finally {
    store.close();
  }
}
