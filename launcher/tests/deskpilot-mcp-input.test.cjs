const assert = require("node:assert/strict");
const test = require("node:test");
const { validateDeskPilotMcpInput } = require("../electron/deskpilot-mcp-input.cjs");

test("DeskPilot MCP IPC validation preserves stdio input compatibility", () => {
  assert.deepEqual(validateDeskPilotMcpInput({
    name: " Files ",
    command: " node ",
    args: ["server.js"],
    cwd: " D:\\workspace ",
  }), {
    name: "Files",
    transport: "stdio",
    config: { command: "node", args: ["server.js"], cwd: "D:\\workspace" },
  });
});

test("DeskPilot MCP IPC validates Streamable HTTP and returns only its config", () => {
  const token = "never-log-this-token";
  const validated = validateDeskPilotMcpInput({
    name: " Remote files ",
    transport: "streamable-http",
    url: "https://mcp.example.test/mcp",
    headers: { Authorization: `Bearer ${token}`, "X-Workspace": "docs" },
  });
  assert.deepEqual(validated, {
    name: "Remote files",
    transport: "streamable-http",
    config: {
      url: "https://mcp.example.test/mcp",
      headers: { Authorization: `Bearer ${token}`, "X-Workspace": "docs" },
    },
  });
  assert.equal(validated.config.url.includes(token), false);
});

test("DeskPilot MCP IPC rejects unsafe Streamable HTTP endpoints and headers", () => {
  const base = { name: "Remote", transport: "streamable-http", url: "https://mcp.example.test/mcp" };
  for (const url of ["file:///tmp/mcp", "https://user:pass@mcp.example.test/mcp", "https://mcp.example.test/mcp?token=x", "https://mcp.example.test/mcp#fragment"]) {
    assert.throws(() => validateDeskPilotMcpInput({ ...base, url }));
  }
  assert.throws(() => validateDeskPilotMcpInput({ ...base, headers: { "Mcp-Session-Id": "caller" } }), /managed by the MCP transport/);
  assert.throws(() => validateDeskPilotMcpInput({ ...base, headers: { Authorization: "Bearer a\nb" } }), /single-line/);
  assert.throws(() => validateDeskPilotMcpInput({ ...base, headers: { Authorization: "one", authorization: "two" } }), /unique/);
});
