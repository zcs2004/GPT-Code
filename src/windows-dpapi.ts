import { spawnSync } from "node:child_process";
import { windowsPowerShellExecutable } from "./windows-file-security";

export const WINDOWS_DPAPI_SECRET_PREFIX = "codex-chatgpt-web-dpapi-v1:";
const WINDOWS_DPAPI_ENTROPY = "codex-chatgpt-web:tunnel-runtime-key:v1";
const MAX_SECRET_BYTES = 64 * 1024;

type SpawnSyncLike = typeof spawnSync;

function checkedSecretBytes(value: Uint8Array | string): Uint8Array {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SECRET_BYTES) {
    throw new Error("Windows DPAPI secret is empty or unexpectedly large");
  }
  return bytes;
}

function strictBase64(value: string, label: string): Uint8Array {
  const normalized = value.trim();
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`Windows DPAPI returned invalid ${label}`);
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.toString("base64") !== normalized) {
    throw new Error(`Windows DPAPI returned invalid ${label}`);
  }
  return bytes;
}

function runWindowsDpapi(
  operation: "Protect" | "Unprotect",
  input: Uint8Array,
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    spawnSyncImpl?: SpawnSyncLike;
    entropy?: string;
  } = {},
): Uint8Array {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
  const entropy = options.entropy ?? WINDOWS_DPAPI_ENTROPY;
  if (!entropy || entropy.length > 256 || /[\r\n\0]/.test(entropy)) {
    throw new Error("Windows DPAPI entropy is invalid");
  }
  if (platform !== "win32") throw new Error("Windows DPAPI is available only on Windows");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Security",
    "$payload = [Console]::In.ReadToEnd().Trim()",
    "if ([string]::IsNullOrWhiteSpace($payload)) { throw 'DPAPI input was empty' }",
    "$bytes = [Convert]::FromBase64String($payload)",
    `$entropy = [Text.Encoding]::UTF8.GetBytes('${entropy.replace(/'/g, "''")}')`,
    `$result = [System.Security.Cryptography.ProtectedData]::${operation}($bytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    "[Console]::Out.Write([Convert]::ToBase64String($result))",
  ].join("; ");
  const result = spawnSyncImpl(windowsPowerShellExecutable(platform, env), [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ], {
    encoding: "utf8",
    input: Buffer.from(input).toString("base64"),
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error) throw new Error(`Windows DPAPI ${operation.toLowerCase()} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || "").trim() || `PowerShell exited with code ${result.status}`;
    throw new Error(`Windows DPAPI ${operation.toLowerCase()} failed: ${detail}`);
  }
  return strictBase64(String(result.stdout || ""), `${operation.toLowerCase()} response`);
}

export function isWindowsDpapiEnvelope(value: Uint8Array | string): boolean {
  const text = typeof value === "string" ? value : Buffer.from(value).toString("utf8");
  return text.trim().startsWith(WINDOWS_DPAPI_SECRET_PREFIX);
}

export function protectWindowsSecret(
  value: Uint8Array | string,
  options: Parameters<typeof runWindowsDpapi>[2] = {},
): string {
  const protectedBytes = runWindowsDpapi("Protect", checkedSecretBytes(value), options);
  return `${WINDOWS_DPAPI_SECRET_PREFIX}${Buffer.from(protectedBytes).toString("base64")}\n`;
}

export function unprotectWindowsSecret(
  envelope: Uint8Array | string,
  options: Parameters<typeof runWindowsDpapi>[2] = {},
): Uint8Array {
  const text = typeof envelope === "string" ? envelope.trim() : Buffer.from(envelope).toString("utf8").trim();
  if (!text.startsWith(WINDOWS_DPAPI_SECRET_PREFIX)) {
    throw new Error("Windows DPAPI secret envelope is missing or unsupported");
  }
  const protectedBytes = strictBase64(text.slice(WINDOWS_DPAPI_SECRET_PREFIX.length), "protected payload");
  return checkedSecretBytes(runWindowsDpapi("Unprotect", protectedBytes, options));
}
