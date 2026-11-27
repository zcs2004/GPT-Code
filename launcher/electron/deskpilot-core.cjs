const { spawn } = require("node:child_process");

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SHUTDOWN_TIMEOUT_MS = 5_000;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function createDeskPilotCoreClient({ supervisor, databasePath, browserDescriptorPath }) {
  if (!supervisor || typeof supervisor.runtimeCommand !== "function") {
    throw new Error("DeskPilot Core requires the launcher RuntimeSupervisor");
  }
  if (typeof databasePath !== "string" || !databasePath.trim()) {
    throw new Error("DeskPilot Core requires a private database path");
  }
  if (typeof browserDescriptorPath !== "string" || !browserDescriptorPath.trim()) {
    throw new Error("DeskPilot Core requires the Launcher browser descriptor path");
  }

  let child = null;
  let stdoutBuffer = "";
  let stdoutBytes = 0;
  let stderrBuffer = "";
  let nextRequestId = 1;
  const pending = new Map();

  const rejectPending = error => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  const handleLine = line => {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      const failure = new Error(`DeskPilot Core returned invalid JSON: ${errorMessage(error)}`);
      rejectPending(failure);
      child?.kill();
      return;
    }
    const id = typeof message?.id === "string" ? message.id : "";
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (message.error && typeof message.error.message === "string") {
      request.reject(new Error(message.error.message));
      return;
    }
    request.resolve(message.result);
  };

  const ensureChild = () => {
    if (child && child.exitCode === null && !child.killed) return child;
    const invocation = supervisor.runtimeCommand(["deskpilot-core"]);
    const spawned = spawn(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      env: {
        ...process.env,
        DESKPILOT_DATABASE_PATH: databasePath,
        CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR: browserDescriptorPath,
      },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child = spawned;
    stdoutBuffer = "";
    stdoutBytes = 0;
    stderrBuffer = "";
    spawned.stdout.setEncoding("utf8");
    spawned.stdout.on("data", chunk => {
      stdoutBuffer += chunk;
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > MAX_RESPONSE_BYTES) {
        const failure = new Error("DeskPilot Core response exceeds maximum size");
        rejectPending(failure);
        spawned.kill();
        return;
      }
      while (true) {
        const newline = stdoutBuffer.indexOf("\n");
        if (newline < 0) break;
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        stdoutBytes = Buffer.byteLength(stdoutBuffer);
        if (line) handleLine(line);
      }
    });
    spawned.stderr.setEncoding("utf8");
    spawned.stderr.on("data", chunk => {
      if (stderrBuffer.length < 16_384) stderrBuffer += chunk.slice(0, 16_384 - stderrBuffer.length);
    });
    spawned.once("error", error => {
      if (child === spawned) child = null;
      rejectPending(error);
    });
    spawned.once("exit", code => {
      if (child === spawned) child = null;
      const detail = stderrBuffer.trim();
      rejectPending(new Error(detail || `DeskPilot Core exited with code ${code ?? 1}`));
    });
    return spawned;
  };

  const request = (method, params) => {
    const activeChild = ensureChild();
    const id = String(nextRequestId++);
    const payload = JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }) + "\n";
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      activeChild.stdin.write(payload, error => {
        if (!error) return;
        if (pending.delete(id)) reject(error);
      });
    });
  };

  const shutdown = async () => {
    const activeChild = child;
    if (!activeChild || activeChild.exitCode !== null || activeChild.killed) return { status: "stopped" };
    let timer;
    try {
      const result = await Promise.race([
        request("shutdown"),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("DeskPilot Core shutdown timed out")), SHUTDOWN_TIMEOUT_MS);
        }),
      ]);
      activeChild.stdin.end();
      return result;
    } finally {
      clearTimeout(timer);
      if (child === activeChild && activeChild.exitCode === null) activeChild.kill();
    }
  };

  return {
    start: () => request("health"),
    snapshot: () => request("snapshot"),
    mcpInventory: () => request("mcp.inventory"),
    bindBrowserConversation: input => request("conversation.bindBrowser", input),
    startMcpToolTask: input => request("task.startMcpTool", input),
    startCurrentMcpToolTask: input => request("task.startCurrentMcpTool", input),
    consumeMcpToolResult: taskId => request("task.consumeMcpResult", { taskId }),
    waitForTask: taskId => request("task.wait", { taskId }),
    hasActiveTask: taskId => request("task.isActive", { taskId }),
    cancelTask: taskId => request("task.cancel", { taskId }),
    deliverTask: taskId => request("task.deliver", { taskId }),
    hasApprovalWaiter: approvalId => request("approval.hasWaiter", { approvalId }),
    approvalPreview: approvalId => request("approval.preview", { approvalId }),
    decideApproval: (approvalId, decision) => request("approval.decide", { approvalId, decision }),
    disconnectMcpServer: serverId => request("mcp.disconnect", { serverId }),
    shutdown,
    _childPid: () => child?.pid ?? null,
  };
}

module.exports = { createDeskPilotCoreClient };
