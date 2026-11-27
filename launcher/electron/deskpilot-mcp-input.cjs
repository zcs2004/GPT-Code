const MCP_MANAGED_HTTP_HEADERS = new Set([
  "accept",
  "content-length",
  "content-type",
  "host",
  "mcp-protocol-version",
  "mcp-session-id",
  "last-event-id",
  "origin",
  "transfer-encoding",
]);

function validateDeskPilotMcpInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DeskPilot MCP configuration is required");
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || name.length > 120) throw new Error("DeskPilot MCP server name is invalid");

  const transport = value.transport ?? "stdio";
  if (transport === "stdio") {
    const command = typeof value.command === "string" ? value.command.trim() : "";
    if (!command || command.length > 4_096) throw new Error("DeskPilot MCP command is invalid");
    const args = value.args === undefined ? [] : value.args;
    if (!Array.isArray(args) || args.length > 128
      || args.some(item => typeof item !== "string" || item.length > 8_192)) {
      throw new Error("DeskPilot MCP args must be a string array with at most 128 items");
    }
    if (value.cwd !== undefined
      && (typeof value.cwd !== "string" || value.cwd.length > 32_768)) {
      throw new Error("DeskPilot MCP working directory is invalid");
    }
    return {
      name,
      transport,
      config: {
        command,
        args,
        ...(typeof value.cwd === "string" && value.cwd.trim() ? { cwd: value.cwd.trim() } : {}),
      },
    };
  }

  if (transport !== "streamable-http") {
    throw new Error("DeskPilot MCP transport must be stdio or streamable-http");
  }
  const endpoint = typeof value.url === "string" ? value.url.trim() : "";
  if (!endpoint || endpoint.length > 8_192) {
    throw new Error("DeskPilot Streamable HTTP endpoint URL is invalid");
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("DeskPilot Streamable HTTP endpoint URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("DeskPilot Streamable HTTP endpoint must use http or https");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("DeskPilot Streamable HTTP endpoint must not contain credentials, query parameters, or a fragment");
  }

  const rawHeaders = value.headers;
  if (rawHeaders !== undefined
    && (!rawHeaders || typeof rawHeaders !== "object" || Array.isArray(rawHeaders))) {
    throw new Error("DeskPilot Streamable HTTP headers must be an object of string values");
  }
  const entries = Object.entries(rawHeaders || {});
  if (entries.length > 64) throw new Error("DeskPilot Streamable HTTP supports at most 64 custom headers");
  const seen = new Set();
  const headers = {};
  for (const [rawName, rawValue] of entries) {
    const headerName = rawName.trim();
    const lowerName = headerName.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(headerName)) {
      throw new Error("DeskPilot Streamable HTTP header name is invalid");
    }
    if (MCP_MANAGED_HTTP_HEADERS.has(lowerName)) {
      throw new Error("DeskPilot Streamable HTTP header is managed by the MCP transport: " + headerName);
    }
    if (seen.has(lowerName)) throw new Error("DeskPilot Streamable HTTP header names must be unique");
    seen.add(lowerName);
    if (typeof rawValue !== "string" || rawValue.length === 0 || rawValue.length > 16_384
      || /[\r\n\0]/.test(rawValue)) {
      throw new Error("DeskPilot Streamable HTTP header values must be non-empty single-line strings");
    }
    headers[headerName] = rawValue;
  }

  return {
    name,
    transport,
    config: {
      url: url.toString(),
      ...(entries.length > 0 ? { headers } : {}),
    },
  };
}

module.exports = { validateDeskPilotMcpInput };
