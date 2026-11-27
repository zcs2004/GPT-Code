const { spawnSync } = require("node:child_process");
const { windowsPowerShellExecutable } = require("./windows-file-security.cjs");

const WINDOWS_DPAPI_SECRET_PREFIX = "codex-chatgpt-web-dpapi-v1:";
const WINDOWS_DPAPI_ENTROPY = "codex-chatgpt-web:tunnel-runtime-key:v1";
const WINDOWS_TUNNEL_RUNTIME_KEY_ENV = "CODEX_CHATGPT_WEB_TUNNEL_RUNTIME_KEY";
const MAX_SECRET_BYTES = 64 * 1024;

function strictBase64(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`Windows DPAPI returned invalid ${label}`);
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.toString("base64") !== normalized) {
    throw new Error(`Windows DPAPI returned invalid ${label}`);
  }
  return bytes;
}

function isWindowsDpapiEnvelope(value) {
  return Buffer.isBuffer(value)
    ? value.toString("utf8").trim().startsWith(WINDOWS_DPAPI_SECRET_PREFIX)
    : String(value || "").trim().startsWith(WINDOWS_DPAPI_SECRET_PREFIX);
}

function unprotectWindowsSecret(envelope, {
  platform = process.platform,
  env = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  if (platform !== "win32") throw new Error("Windows DPAPI is available only on Windows");
  const text = Buffer.isBuffer(envelope) ? envelope.toString("utf8").trim() : String(envelope || "").trim();
  if (!text.startsWith(WINDOWS_DPAPI_SECRET_PREFIX)) {
    throw new Error("Windows DPAPI secret envelope is missing or unsupported");
  }
  const protectedBytes = strictBase64(text.slice(WINDOWS_DPAPI_SECRET_PREFIX.length), "protected payload");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Security",
    "$payload = [Console]::In.ReadToEnd().Trim()",
    "if ([string]::IsNullOrWhiteSpace($payload)) { throw 'DPAPI input was empty' }",
    "$bytes = [Convert]::FromBase64String($payload)",
    `$entropy = [Text.Encoding]::UTF8.GetBytes('${WINDOWS_DPAPI_ENTROPY}')`,
    "$result = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
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
    input: protectedBytes.toString("base64"),
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error) throw new Error(`Windows DPAPI unprotect failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || "").trim() || `PowerShell exited with code ${result.status}`;
    throw new Error(`Windows DPAPI unprotect failed: ${detail}`);
  }
  const secret = strictBase64(String(result.stdout || ""), "unprotect response");
  if (secret.length === 0 || secret.length > MAX_SECRET_BYTES) {
    throw new Error("Windows DPAPI secret is empty or unexpectedly large");
  }
  return secret;
}

function runtimeKeyTransport(runtimeKeyFile, baseEnv = process.env, {
  platform = process.platform,
  fsImpl = require("node:fs"),
  unprotectImpl = unprotectWindowsSecret,
} = {}) {
  if (platform !== "win32") {
    return { reference: `file:${runtimeKeyFile}`, env: baseEnv, protectedAtRest: false };
  }
  const stored = fsImpl.readFileSync(runtimeKeyFile);
  const secretBytes = isWindowsDpapiEnvelope(stored)
    ? unprotectImpl(stored, { platform: "win32" })
    : stored;
  if (!secretBytes || secretBytes.length === 0 || secretBytes.length > MAX_SECRET_BYTES) {
    throw new Error("Tunnel runtime key is empty or unexpectedly large");
  }
  const secret = Buffer.from(secretBytes).toString("utf8").trim();
  if (!secret || /[\r\n\0]/.test(secret)) {
    throw new Error("Tunnel runtime key must be a non-empty single-line UTF-8 value");
  }
  return {
    reference: `env:${WINDOWS_TUNNEL_RUNTIME_KEY_ENV}`,
    env: { ...baseEnv, [WINDOWS_TUNNEL_RUNTIME_KEY_ENV]: secret },
    protectedAtRest: isWindowsDpapiEnvelope(stored),
  };
}

module.exports = {
  WINDOWS_DPAPI_SECRET_PREFIX,
  WINDOWS_TUNNEL_RUNTIME_KEY_ENV,
  isWindowsDpapiEnvelope,
  runtimeKeyTransport,
  unprotectWindowsSecret,
};
