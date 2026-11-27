import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as z from "zod/v4";

export interface DeskPilotHttpMcpFixtureOptions {
  bearerToken?: string;
  rejectDelete?: boolean;
}

export interface DeskPilotHttpMcpFixture {
  url: string;
  activeSessions(): number;
  close(): Promise<void>;
}

export async function startDeskPilotHttpMcpFixture(
  options: DeskPilotHttpMcpFixtureOptions = {},
): Promise<DeskPilotHttpMcpFixture> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const httpServer: Server = createServer((request, response) => {
    void (async () => {
      if (options.bearerToken
        && request.headers.authorization !== `Bearer ${options.bearerToken}`) {
        response.writeHead(401).end();
        return;
      }

      const sessionId = request.headers["mcp-session-id"];
      if (request.method === "GET" && !sessionId) {
        response.writeHead(405).end();
        return;
      }
      if (request.method === "DELETE" && options.rejectDelete) {
        response.writeHead(405).end();
        return;
      }

      let transport: StreamableHTTPServerTransport | undefined;
      if (request.method === "POST" && !sessionId) {
        let createdTransport: StreamableHTTPServerTransport;
        createdTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: id => {
            sessions.set(id, createdTransport);
          },
          onsessionclosed: id => {
            sessions.delete(id);
          },
        });
        transport = createdTransport;
        const mcpServer = new McpServer({
          name: "deskpilot-http-fixture",
          version: "1.0.0",
        });
        mcpServer.registerTool(
          "echo_http",
          {
            description: "Echo text through Streamable HTTP.",
            inputSchema: { text: z.string() },
            annotations: { readOnlyHint: true, destructiveHint: false },
          },
          async ({ text }) => ({
            content: [{ type: "text" as const, text }],
            structuredContent: { text },
          }),
        );
        await mcpServer.connect(transport);
      } else if (typeof sessionId === "string") {
        transport = sessions.get(sessionId);
      }

      if (!transport) {
        response.writeHead(404).end();
        return;
      }
      await transport.handleRequest(request, response);
    })().catch(error => {
      if (!response.headersSent) response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("HTTP MCP fixture failed to bind a TCP port");

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    activeSessions: () => sessions.size,
    close: async () => {
      await Promise.all([...sessions.values()].map(transport => transport.close().catch(() => {})));
      await new Promise<void>((resolve, reject) => {
        httpServer.close(error => error ? reject(error) : resolve());
      });
    },
  };
}
