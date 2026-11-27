import { readLauncherBrowserHostDescriptor } from "../launcher-browser-host";

const CONTROL_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_RESULT_POLL_INTERVAL_MS = 200;

export interface DeskPilotChatGptMcpCallInput {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface DeskPilotChatGptMcpTaskResult {
  ready: boolean;
  terminal: boolean;
  task: {
    id: string;
    status: string;
    conversationId: string;
  };
  result?: unknown;
}

export function deskPilotChatGptMcpDescriptorPath(): string | undefined {
  const value = process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR?.trim();
  return value || undefined;
}

function objectResult(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " returned an invalid response");
  }
  return value as Record<string, unknown>;
}

async function controlRequest(
  descriptorPath: string,
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTROL_REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(descriptor.control.endpoint + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.control.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const decoded = objectResult(await response.json(), "DeskPilot Launcher control");
    if (!response.ok) {
      const message = typeof decoded.error === "string" ? decoded.error : `HTTP ${response.status}`;
      throw new Error("DeskPilot Launcher control rejected the request: " + message);
    }
    return decoded;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function deskPilotChatGptMcpInventory(
  descriptorPath: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return await controlRequest(descriptorPath, "/v1/deskpilot/mcp/inventory", {}, signal);
}

export async function deskPilotChatGptMcpAcceptanceProbe(
  descriptorPath: string,
  probeId: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!/^stage5_[a-f0-9]{32}$/.test(probeId)) {
    throw new Error("DeskPilot ChatGPT MCP acceptance probe identity is invalid");
  }
  return await controlRequest(
    descriptorPath,
    "/v1/deskpilot/mcp/acceptance",
    { probeId },
    signal,
  );
}

export async function startDeskPilotChatGptMcpTool(
  descriptorPath: string,
  input: DeskPilotChatGptMcpCallInput,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return await controlRequest(descriptorPath, "/v1/deskpilot/mcp/invoke", {
    serverId: input.serverId,
    toolName: input.toolName,
    arguments: input.arguments,
  }, signal);
}

export async function readDeskPilotChatGptMcpTaskResult(
  descriptorPath: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<DeskPilotChatGptMcpTaskResult> {
  const decoded = await controlRequest(
    descriptorPath,
    "/v1/deskpilot/mcp/result",
    { taskId },
    signal,
  );
  if (typeof decoded.ready !== "boolean" || typeof decoded.terminal !== "boolean") {
    throw new Error("DeskPilot task result response is invalid");
  }
  const task = objectResult(decoded.task, "DeskPilot task result") as DeskPilotChatGptMcpTaskResult["task"];
  if (typeof task.id !== "string" || typeof task.status !== "string" || typeof task.conversationId !== "string") {
    throw new Error("DeskPilot task result is missing task metadata");
  }
  return {
    ready: decoded.ready,
    terminal: decoded.terminal,
    task,
    ...(decoded.ready ? { result: decoded.result } : {}),
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("DeskPilot MCP request was aborted"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new Error("DeskPilot MCP request was aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForDeskPilotChatGptMcpTaskResult(
  descriptorPath: string,
  taskId: string,
  options: {
    timeoutMs: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
  },
): Promise<DeskPilotChatGptMcpTaskResult> {
  const deadline = Date.now() + Math.max(0, options.timeoutMs);
  const interval = Math.max(25, options.pollIntervalMs ?? DEFAULT_RESULT_POLL_INTERVAL_MS);
  let result = await readDeskPilotChatGptMcpTaskResult(descriptorPath, taskId, options.signal);
  while (!result.ready && !result.terminal && Date.now() < deadline) {
    await delay(Math.min(interval, Math.max(1, deadline - Date.now())), options.signal);
    result = await readDeskPilotChatGptMcpTaskResult(descriptorPath, taskId, options.signal);
  }
  return result;
}
