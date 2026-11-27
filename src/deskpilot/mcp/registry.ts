import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import type { DeskPilotStore } from "../storage";
import type { DeskPilotMcpServer } from "../types";
import {
  defaultMcpConnectionFactory,
  type DeskPilotMcpCallContext,
  type DeskPilotMcpConnection,
  type DeskPilotMcpConnectionFactory,
  type DeskPilotMcpTool,
} from "./connection";

interface RegisteredConnection {
  connection: DeskPilotMcpConnection;
  tools: Map<string, { descriptor: DeskPilotMcpTool; validate: ValidateFunction }>;
}

export function deskPilotMcpToolKey(serverId: string, toolName: string): string {
  return serverId + "::" + toolName;
}

export class DeskPilotMcpRegistry {
  private readonly connections = new Map<string, RegisteredConnection>();
  private readonly ajvDraft7 = new Ajv({
    allErrors: true,
    strict: false,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
    validateFormats: false,
  });
  private readonly ajv2020 = new Ajv2020({
    allErrors: true,
    strict: false,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
    validateFormats: false,
  });

  constructor(
    private readonly store: DeskPilotStore,
    private readonly connectionFactory: DeskPilotMcpConnectionFactory = defaultMcpConnectionFactory,
  ) {}

  addServer(server: DeskPilotMcpServer): DeskPilotMcpServer {
    return this.store.mcpServers.create(server);
  }

  listServers(): DeskPilotMcpServer[] {
    return this.store.mcpServers.list();
  }

  async removeServer(id: string): Promise<boolean> {
    await this.disconnect(id);
    return this.store.mcpServers.remove(id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<DeskPilotMcpServer> {
    if (!enabled) await this.disconnect(id);
    return this.store.mcpServers.setEnabled(id, enabled);
  }

  async connect(id: string): Promise<DeskPilotMcpTool[]> {
    const existing = this.connections.get(id);
    if (existing) return [...existing.tools.values()].map((entry) => entry.descriptor);

    const server = this.store.mcpServers.get(id);
    if (!server) throw new Error("DeskPilot MCP server not found: " + id);
    if (!server.enabled) throw new Error("DeskPilot MCP server is disabled: " + id);

    const connection = await this.connectionFactory(server);
    return await this.registerConnection(id, connection);
  }

  private async registerConnection(id: string, connection: DeskPilotMcpConnection): Promise<DeskPilotMcpTool[]> {
    try {
      const discovered = await connection.listTools();
      const tools = new Map<string, { descriptor: DeskPilotMcpTool; validate: ValidateFunction }>();
      for (const tool of discovered) {
        if (tools.has(tool.name)) {
          throw new Error("DeskPilot MCP server returned duplicate tool: " + tool.name);
        }
        let validate: ValidateFunction;
        try {
          const schemaUri = tool.inputSchema.$schema;
          const ajv = typeof schemaUri === "string" && schemaUri.includes("2020-12")
            ? this.ajv2020
            : this.ajvDraft7;
          validate = ajv.compile(tool.inputSchema);
        } catch (cause) {
          throw new Error(
            "DeskPilot MCP tool has invalid input schema: "
            + tool.name
            + ": "
            + (cause instanceof Error ? cause.message : String(cause)),
          );
        }
        tools.set(tool.name, { descriptor: tool, validate });
      }
      this.connections.set(id, { connection, tools });
      return discovered;
    } catch (error) {
      await connection.close().catch(() => {});
      throw error;
    }
  }

  async disconnect(id: string): Promise<void> {
    const registered = this.connections.get(id);
    if (!registered) return;
    this.connections.delete(id);
    await registered.connection.close();
  }

  listConnectedTools(): Array<DeskPilotMcpTool & { serverId: string; toolKey: string }> {
    const result: Array<DeskPilotMcpTool & { serverId: string; toolKey: string }> = [];
    for (const [serverId, registered] of this.connections) {
      for (const entry of registered.tools.values()) {
        result.push({
          ...entry.descriptor,
          serverId,
          toolKey: deskPilotMcpToolKey(serverId, entry.descriptor.name),
        });
      }
    }
    return result;
  }

  validateArguments(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): void {
    const entry = this.requireTool(serverId, toolName);
    if (entry.validate(args)) return;
    throw new Error(
      "DeskPilot MCP arguments do not match schema for "
      + deskPilotMcpToolKey(serverId, toolName)
      + ": "
      + (entry.validate.errors ?? [])
        .map((error) => (error.instancePath || "/") + " " + (error.message ?? "is invalid"))
        .join("; "),
    );
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    context?: DeskPilotMcpCallContext,
  ): Promise<unknown> {
    const registered = this.connections.get(serverId);
    if (!registered) throw new Error("DeskPilot MCP server is not connected: " + serverId);
    const server = this.store.mcpServers.get(serverId);
    if (!server?.enabled) throw new Error("DeskPilot MCP server is disabled: " + serverId);
    this.requireTool(serverId, toolName);
    return registered.connection.callTool(toolName, args, context);
  }

  async close(): Promise<void> {
    const ids = [...this.connections.keys()];
    const errors: unknown[] = [];
    for (const id of ids) {
      try {
        await this.disconnect(id);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to close one or more DeskPilot MCP connections");
    }
  }

  private requireTool(
    serverId: string,
    toolName: string,
  ): { descriptor: DeskPilotMcpTool; validate: ValidateFunction } {
    const registered = this.connections.get(serverId);
    if (!registered) throw new Error("DeskPilot MCP server is not connected: " + serverId);
    const entry = registered.tools.get(toolName);
    if (!entry) {
      throw new Error("DeskPilot MCP tool not found: " + deskPilotMcpToolKey(serverId, toolName));
    }
    return entry;
  }
}
