import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const server = new McpServer({
  name: "deskpilot-test-server",
  version: "1.0.0",
});

server.registerTool(
  "echo",
  {
    description: "Echo text for DeskPilot integration tests.",
    inputSchema: {
      text: z.string(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  async ({ text }) => ({
    content: [{ type: "text" as const, text }],
    structuredContent: { text },
  }),
);

server.registerTool(
  "write_note",
  {
    description: "Simulate a write action for DeskPilot approval tests.",
    inputSchema: {
      text: z.string().min(1),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  async ({ text }) => ({
    content: [{ type: "text" as const, text: "wrote:" + text }],
    structuredContent: { written: text },
  }),
);

await server.connect(new StdioServerTransport());
