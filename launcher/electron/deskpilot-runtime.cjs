const { spawn } = require("node:child_process");

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function createDeskPilotRuntime({ supervisor, databasePath }) {
  if (!supervisor || typeof supervisor.runtimeCommand !== "function") {
    throw new Error("DeskPilot runtime requires the launcher RuntimeSupervisor");
  }
  if (typeof databasePath !== "string" || !databasePath.trim()) {
    throw new Error("DeskPilot runtime requires a private database path");
  }

  const run = async (args, input) => {
    const invocation = supervisor.runtimeCommand(["deskpilot", ...args]);
    const inputJson = input === undefined ? null : JSON.stringify(input);
    return await new Promise((resolve, reject) => {
      const child = spawn(invocation.executable, invocation.args, {
        cwd: invocation.cwd,
        env: {
          ...process.env,
          DESKPILOT_DATABASE_PATH: databasePath,
        },
        windowsHide: true,
        stdio: [inputJson === null ? "ignore" : "pipe", "pipe", "pipe"],
      });
      const stdout = [];
      const stderr = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      const capture = (target, chunk, stream) => {
        const current = stream === "stdout" ? stdoutBytes : stderrBytes;
        const remaining = MAX_OUTPUT_BYTES - current;
        if (remaining <= 0) return;
        const value = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        target.push(value);
        if (stream === "stdout") stdoutBytes += value.length;
        else stderrBytes += value.length;
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error(`DeskPilot runtime command timed out after ${COMMAND_TIMEOUT_MS}ms`));
      }, COMMAND_TIMEOUT_MS);
      const finish = () => clearTimeout(timer);
      child.stdout.on("data", chunk => capture(stdout, chunk, "stdout"));
      child.stderr.on("data", chunk => capture(stderr, chunk, "stderr"));
      if (inputJson !== null) child.stdin.end(inputJson);
      child.once("error", error => {
        if (settled) return;
        settled = true;
        finish();
        reject(error);
      });
      child.once("exit", code => {
        if (settled) return;
        settled = true;
        finish();
        const stdoutText = Buffer.concat(stdout).toString("utf8").trim();
        const stderrText = Buffer.concat(stderr).toString("utf8").trim();
        if (code !== 0) {
          reject(new Error(stderrText || stdoutText || `DeskPilot runtime exited with code ${code ?? 1}`));
          return;
        }
        try {
          resolve(JSON.parse(stdoutText));
        } catch (error) {
          reject(new Error(`DeskPilot runtime returned invalid JSON: ${errorMessage(error)}`));
        }
      });
    });
  };

  return {
    snapshot: () => run(["snapshot"]),
    cancelTask: id => run(["tasks", "cancel", "--id", id]),
    decideApproval: (id, decision) => run(["approvals", "decide", "--id", id, "--decision", decision]),
    addMcpServer: input => run(["mcp", "add", "--input-stdin"], input),
    setMcpServerEnabled: (id, enabled) => run(["mcp", enabled ? "enable" : "disable", "--id", id]),
    removeMcpServer: id => run(["mcp", "remove", "--id", id]),
    testMcpServer: id => run(["mcp", "test", "--id", id]),
  };
}

module.exports = { createDeskPilotRuntime };
