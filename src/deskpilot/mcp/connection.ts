import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isWindowsDpapiEnvelope, protectWindowsSecret, unprotectWindowsSecret } from "../../windows-dpapi";
import type { DeskPilotMcpServer } from "../types";

export const DESKPILOT_MCP_HTTP_HEADER_ENTROPY = "deskpilot:mcp-http-header:v1";

export interface DeskPilotMcpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface DeskPilotMcpCallContext {
  taskId: string;
}

export interface DeskPilotMcpConnection {
  listTools(): Promise<DeskPilotMcpTool[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    context?: DeskPilotMcpCallContext,
  ): Promise<unknown>;
  close(): Promise<void>;
}

export interface StdioServerConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface StreamableHttpServerConfig {
  url: string;
  /** Header values are DPAPI envelopes while stored in the DeskPilot database. */
  headers?: Record<string, string>;
}

export interface StreamableHttpConfigProtection {
  protectHeaderValue?: (value: string) => string;
}

export interface StreamableHttpConfigResolution {
  unprotectHeaderValue?: (value: string) => string;
}

const MCP_MANAGED_HTTP_HEADERS = new Set([
  "accept",
  "connection",
  "content-length",
  "content-type",
  "host",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
  "origin",
  "transfer-encoding",
]);

function checkedStreamableHttpUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 8_192) {
    throw new Error("DeskPilot Streamable HTTP config requires an endpoint URL");
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("DeskPilot Streamable HTTP endpoint URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("DeskPilot Streamable HTTP endpoint must use http or https");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("DeskPilot Streamable HTTP endpoint must not contain credentials, query parameters, or a fragment");
  }
  return url.toString();
}

function checkedHeaderEntries(
  value: unknown,
  options: { allowStoredEnvelope?: boolean } = {},
): Array<[string, string]> {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DeskPilot Streamable HTTP headers must be an object of string values");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 64) throw new Error("DeskPilot Streamable HTTP supports at most 64 custom headers");
  const seen = new Set<string>();
  return entries.map(([name, rawValue]) => {
    const normalizedName = name.trim();
    const lowerName = normalizedName.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(normalizedName)) {
      throw new Error("DeskPilot Streamable HTTP header name is invalid");
    }
    if (MCP_MANAGED_HTTP_HEADERS.has(lowerName)) {
      throw new Error("DeskPilot Streamable HTTP header is managed by the MCP transport: " + normalizedName);
    }
    if (seen.has(lowerName)) throw new Error("DeskPilot Streamable HTTP header names must be unique");
    seen.add(lowerName);
    const storedValue = typeof rawValue === "string" ? rawValue : "";
    const hasStoredLineEnding = options.allowStoredEnvelope === true
      && storedValue.endsWith("\n")
      && !storedValue.endsWith("\r\n");
    const valueForValidation = hasStoredLineEnding ? storedValue.slice(0, -1) : storedValue;
    const maxLength = options.allowStoredEnvelope === true ? 64 * 1024 : 16_384;
    if (typeof rawValue !== "string" || storedValue.length === 0 || storedValue.length > maxLength
      || /[\r\n\0]/.test(valueForValidation)) {
      throw new Error("DeskPilot Streamable HTTP header values must be non-empty single-line strings");
    }
    return [normalizedName, storedValue];
  });
}

export function deskPilotStreamableHttpConfig(
  value: unknown,
  options: StreamableHttpConfigProtection = {},
): StreamableHttpServerConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DeskPilot Streamable HTTP config must be an object");
  }
  const config = value as Record<string, unknown>;
  const url = checkedStreamableHttpUrl(config.url);
  const entries = checkedHeaderEntries(config.headers);
  if (entries.length === 0) return { url };
  const protect = options.protectHeaderValue ?? ((secret: string) => protectWindowsSecret(secret, {
    entropy: DESKPILOT_MCP_HTTP_HEADER_ENTROPY,
  }));
  const headers: Record<string, string> = {};
  for (const [name, secret] of entries) {
    headers[name] = protect(secret);
  }
  return { url, headers };
}

function resolvedStreamableHttpConfig(
  value: unknown,
  options: StreamableHttpConfigResolution = {},
): { url: string; headers?: Record<string, string> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DeskPilot Streamable HTTP config must be an object");
  }
  const config = value as Record<string, unknown>;
  const url = checkedStreamableHttpUrl(config.url);
  const entries = checkedHeaderEntries(config.headers, { allowStoredEnvelope: true });
  if (entries.length === 0) return { url };
  const unprotect = options.unprotectHeaderValue ?? ((envelope: string) => {
    if (!isWindowsDpapiEnvelope(envelope)) {
      throw new Error("DeskPilot Streamable HTTP header is not protected with Windows DPAPI");
    }
    return Buffer.from(unprotectWindowsSecret(envelope, {
      entropy: DESKPILOT_MCP_HTTP_HEADER_ENTROPY,
    })).toString("utf8");
  });
  const headers: Record<string, string> = {};
  for (const [name, envelope] of entries) {
    const secret = unprotect(envelope);
    if (!secret || /[\r\n\0]/.test(secret)) {
      throw new Error("DeskPilot Streamable HTTP header could not be decrypted to a valid value");
    }
    headers[name] = secret;
  }
  return { url, headers };
}

export function deskPilotStdioConfig(value: unknown): StdioServerConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DeskPilot stdio MCP config must be an object");
  }
  const config = value as Record<string, unknown>;
  if (typeof config.command !== "string" || config.command.trim().length === 0) {
    throw new Error("DeskPilot stdio MCP config requires command");
  }
  if (config.args !== undefined && (
    !Array.isArray(config.args) || config.args.some((item) => typeof item !== "string")
  )) {
    throw new Error("DeskPilot stdio MCP config args must be a string array");
  }
  if (config.cwd !== undefined && typeof config.cwd !== "string") {
    throw new Error("DeskPilot stdio MCP config cwd must be a string");
  }
  if (config.env !== undefined && (
    !config.env
    || typeof config.env !== "object"
    || Array.isArray(config.env)
    || Object.values(config.env).some((item) => typeof item !== "string")
  )) {
    throw new Error("DeskPilot stdio MCP config env must contain only string values");
  }
  return {
    command: config.command,
    ...(config.args === undefined ? {} : { args: config.args as string[] }),
    ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
    ...(config.env === undefined ? {} : { env: config.env as Record<string, string> }),
  };
}

export class StdioMcpConnection implements DeskPilotMcpConnection {
  private constructor(
    private readonly client: Client,
    private readonly transport: StdioClientTransport,
  ) {}

  static async connect(server: DeskPilotMcpServer): Promise<StdioMcpConnection> {
    if (server.transport !== "stdio") {
      throw new Error("DeskPilot stdio connection cannot open transport: " + server.transport);
    }
    const config = deskPilotStdioConfig(server.config);
    const transport = new StdioClientTransport({
      ...config,
      stderr: "pipe",
    });
    transport.stderr?.on("data", () => {});
    const client = new Client({ name: "deskpilot", version: "0.1.0" });
    try {
      await client.connect(transport);
      return new StdioMcpConnection(client, transport);
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }
  }

  async listTools(): Promise<DeskPilotMcpTool[]> {
    const tools: DeskPilotMcpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools.map((tool) => ({
        name: tool.name,
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: tool.inputSchema as Record<string, unknown>,
        ...(tool.annotations === undefined
          ? {}
          : { annotations: tool.annotations as Record<string, unknown> }),
      })));
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export class StreamableHttpMcpConnection implements DeskPilotMcpConnection {
  private closed = false;

  private constructor(
    private readonly client: Client,
    private readonly transport: StreamableHTTPClientTransport,
  ) {}

  static async connect(
    server: DeskPilotMcpServer,
    options: StreamableHttpConfigResolution = {},
  ): Promise<StreamableHttpMcpConnection> {
    if (server.transport !== "streamable-http") {
      throw new Error("DeskPilot Streamable HTTP connection cannot open transport: " + server.transport);
    }
    const config = resolvedStreamableHttpConfig(server.config, options);
    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      ...(config.headers ? { requestInit: { headers: config.headers } } : {}),
    });
    const client = new Client({ name: "deskpilot", version: "0.1.0" });
    try {
      await client.connect(transport);
      return new StreamableHttpMcpConnection(client, transport);
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }
  }

  async listTools(): Promise<DeskPilotMcpTool[]> {
    if (this.closed) throw new Error("DeskPilot Streamable HTTP connection is closed");
    const tools: DeskPilotMcpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools.map((tool) => ({
        name: tool.name,
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: tool.inputSchema as Record<string, unknown>,
        ...(tool.annotations === undefined
          ? {}
          : { annotations: tool.annotations as Record<string, unknown> }),
      })));
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (this.closed) throw new Error("DeskPilot Streamable HTTP connection is closed");
    return this.client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    let terminationError: unknown;
    let closeError: unknown;
    try {
      // The SDK treats HTTP 405 as a valid response when a server does not
      // support explicit session termination.
      await this.transport.terminateSession();
    } catch (error) {
      terminationError = error;
    }
    try {
      await this.client.close();
    } catch (error) {
      closeError = error;
    }
    if (terminationError && closeError) {
      throw new AggregateError([terminationError, closeError], "Failed to terminate and close DeskPilot Streamable HTTP connection");
    }
    if (terminationError) throw terminationError;
    if (closeError) throw closeError;
  }
}

export type DeskPilotMcpConnectionFactory = (
  server: DeskPilotMcpServer,
) => Promise<DeskPilotMcpConnection>;

export async function defaultMcpConnectionFactory(
  server: DeskPilotMcpServer,
): Promise<DeskPilotMcpConnection> {
  if (server.transport === "stdio") return StdioMcpConnection.connect(server);
  if (server.transport === "streamable-http") return StreamableHttpMcpConnection.connect(server);
  throw new Error("DeskPilot MCP transport is not implemented yet: " + server.transport);
}
