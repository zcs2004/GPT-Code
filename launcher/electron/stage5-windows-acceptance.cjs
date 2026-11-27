const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const launcherManifest = require("../package.json");
const { inspectWindowsAuthenticode, sha256 } = require("./update.cjs");
const { inspectWindowsPrivatePath } = require("./windows-file-security.cjs");

const STAGE5_MCP_ACCEPTANCE_SCHEMA = "deskpilot-stage5-mcp-acceptance-v2";
const STAGE5_MCP_ACCEPTANCE_MAX_AGE_MS = 60 * 60 * 1000;
const STAGE5_MCP_ACCEPTANCE_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const STAGE5_EVIDENCE_KEYS = [
  "appVersion",
  "connector",
  "effort",
  "generatedAt",
  "profile",
  "release",
  "response",
  "runtime",
  "schema",
  "tool",
];
const STAGE5_RELEASE_EVIDENCE_KEYS = [
  "authenticode",
  "executableSha256",
  "installation",
  "packaged",
  "platform",
  "privateData",
];

function normalizeWindowsPath(value) {
  if (typeof value !== "string" || !path.win32.isAbsolute(value)) return null;
  return path.win32.normalize(value).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
}

function sameWindowsPath(left, right) {
  const normalizedLeft = normalizeWindowsPath(left);
  const normalizedRight = normalizeWindowsPath(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function windowsRegisteredInstallLocation({
  spawnSyncImpl = spawnSync,
  guid = launcherManifest.build.nsis.guid,
} = {}) {
  if (typeof guid !== "string" || !/^[a-f0-9-]{36}$/i.test(guid)) {
    throw new Error("Stage 5 Windows acceptance could not resolve the launcher installation identity");
  }
  const registryKey = `HKCU\\Software\\${guid}`;
  const result = spawnSyncImpl("reg.exe", ["query", registryKey, "/v", "InstallLocation"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result?.error) {
    throw new Error(`Stage 5 Windows acceptance could not inspect the registered installation: ${result.error.message}`);
  }
  if (result?.status !== 0) {
    throw new Error("Stage 5 MCP acceptance requires the registered current-user Windows installation");
  }
  const match = String(result.stdout || "").match(/^\s*InstallLocation\s+REG_SZ\s+(.+?)\s*$/mi);
  if (!match || !path.win32.isAbsolute(match[1])) {
    throw new Error("Stage 5 Windows acceptance found an invalid registered installation location");
  }
  return path.win32.normalize(match[1]);
}

function verifyStage5PrivatePath(targetPath, label, {
  requireProtected = false,
  exists = fs.existsSync,
  inspectPrivatePath = inspectWindowsPrivatePath,
} = {}) {
  if (!exists(targetPath)) {
    throw new Error(`Stage 5 MCP acceptance requires the private ${label}`);
  }
  const inspection = inspectPrivatePath(targetPath, { platform: "win32" });
  if (!inspection?.safe || (requireProtected && !inspection.protected)) {
    throw new Error(`Stage 5 MCP acceptance requires a private Windows ACL for ${label}`);
  }
}

function hashStage5Executable(executablePath, hashFile) {
  let digest;
  try {
    digest = hashFile(executablePath);
  } catch {
    throw new Error("Stage 5 Windows acceptance could not hash the installed Launcher executable");
  }
  if (!isSha256(digest)) {
    throw new Error("Stage 5 Windows acceptance received an invalid installed Launcher SHA-256");
  }
  return digest;
}

function verifyStage5WindowsAcceptanceHost({
  platform = process.platform,
  packaged,
  developmentProfile = false,
  executablePath = process.execPath,
  appDataPath,
  userDataPath,
  spawnSyncImpl = spawnSync,
  inspect = inspectWindowsAuthenticode,
  hashFile = sha256,
  exists = fs.existsSync,
  inspectPrivatePath = inspectWindowsPrivatePath,
  manifest = launcherManifest,
} = {}) {
  if (platform !== "win32") {
    throw new Error("Stage 5 MCP acceptance is only valid on Windows");
  }
  if (!packaged || developmentProfile) {
    throw new Error("Stage 5 MCP acceptance requires a packaged production Launcher");
  }

  const productName = manifest?.build?.productName;
  const guid = manifest?.build?.nsis?.guid;
  if (typeof productName !== "string" || !productName.trim() || typeof guid !== "string") {
    throw new Error("Stage 5 Windows acceptance could not resolve the packaged Launcher identity");
  }
  if (typeof appDataPath !== "string" || !path.win32.isAbsolute(appDataPath)) {
    throw new Error("Stage 5 Windows acceptance could not resolve the production app-data root");
  }

  const expectedUserData = path.win32.join(appDataPath, productName);
  if (!sameWindowsPath(userDataPath, expectedUserData)) {
    throw new Error("Stage 5 MCP acceptance requires the frozen production Launcher userData path");
  }

  const installLocation = windowsRegisteredInstallLocation({ spawnSyncImpl, guid });
  const expectedExecutable = path.win32.join(installLocation, `${productName}.exe`);
  if (!sameWindowsPath(executablePath, expectedExecutable)) {
    throw new Error("Stage 5 MCP acceptance requires the currently registered Windows installation");
  }

  const executableSha256BeforeSignature = hashStage5Executable(executablePath, hashFile);
  const signature = inspect(executablePath);
  if (signature?.status !== "Valid" || !signature.subject || !signature.thumbprint) {
    throw new Error(
      `Stage 5 MCP acceptance requires an Authenticode-valid installed Launcher: ${signature?.status || "UnknownError"}`,
    );
  }
  const executableSha256 = hashStage5Executable(executablePath, hashFile);
  if (executableSha256 !== executableSha256BeforeSignature) {
    throw new Error("Stage 5 Windows acceptance detected the installed Launcher changing during verification");
  }

  verifyStage5PrivatePath(userDataPath, "Launcher userData root", {
    requireProtected: true,
    exists,
    inspectPrivatePath,
  });
  verifyStage5PrivatePath(path.win32.join(userDataPath, "DeskPilot"), "DeskPilot data directory", {
    exists,
    inspectPrivatePath,
  });
  verifyStage5PrivatePath(
    path.win32.join(userDataPath, "Partitions", "gpt-code-chatgpt"),
    "ChatGPT browser partition",
    { exists, inspectPrivatePath },
  );

  return {
    platform: "win32",
    packaged: true,
    installation: "registered-current-user",
    authenticode: "valid",
    privateData: "verified",
    executableSha256,
  };
}

function verifyStage5McpAcceptanceEvidence({
  evidence,
  expectedAppVersion,
  releaseEvidence,
  now = Date.now(),
} = {}) {
  if (!hasExactKeys(evidence, STAGE5_EVIDENCE_KEYS)) {
    throw new Error("Stage 5 MCP acceptance evidence has an invalid top-level schema");
  }
  if (evidence.schema !== STAGE5_MCP_ACCEPTANCE_SCHEMA) {
    throw new Error("Stage 5 MCP acceptance evidence uses an unsupported schema");
  }
  if (typeof expectedAppVersion !== "string" || !expectedAppVersion.trim()
    || evidence.appVersion !== expectedAppVersion) {
    throw new Error("Stage 5 MCP acceptance evidence does not match the expected app version");
  }
  if (evidence.profile !== "production") {
    throw new Error("Stage 5 MCP acceptance evidence is not from the production profile");
  }
  const generatedAtMs = typeof evidence.generatedAt === "string"
    ? Date.parse(evidence.generatedAt)
    : Number.NaN;
  if (Number.isNaN(generatedAtMs)
    || new Date(generatedAtMs).toISOString() !== evidence.generatedAt) {
    throw new Error("Stage 5 MCP acceptance evidence has an invalid generation timestamp");
  }
  if (!Number.isFinite(now)) {
    throw new Error("Stage 5 MCP acceptance verification could not resolve the current time");
  }
  if (generatedAtMs > now + STAGE5_MCP_ACCEPTANCE_FUTURE_TOLERANCE_MS) {
    throw new Error("Stage 5 MCP acceptance evidence generation timestamp is in the future");
  }
  if (now - generatedAtMs > STAGE5_MCP_ACCEPTANCE_MAX_AGE_MS) {
    throw new Error("Stage 5 MCP acceptance evidence is stale; rerun the MCP acceptance before final verification");
  }
  if (!hasExactKeys(evidence.release, STAGE5_RELEASE_EVIDENCE_KEYS)
    || !hasExactKeys(releaseEvidence, STAGE5_RELEASE_EVIDENCE_KEYS)) {
    throw new Error("Stage 5 MCP acceptance evidence has an invalid release schema");
  }
  if (!isSha256(evidence.release.executableSha256)
    || !isSha256(releaseEvidence.executableSha256)) {
    throw new Error("Stage 5 MCP acceptance evidence has an invalid executable SHA-256");
  }
  for (const key of STAGE5_RELEASE_EVIDENCE_KEYS) {
    if (evidence.release[key] !== releaseEvidence[key]) {
      throw new Error(`Stage 5 MCP acceptance evidence does not match the current installed release: ${key}`);
    }
  }
  if (evidence.runtime !== "healthy"
    || evidence.connector !== "verified"
    || evidence.tool !== "deskpilot_acceptance_probe"
    || typeof evidence.effort !== "string"
    || !evidence.effort.trim()
    || evidence.response !== "DESKPILOT MCP READY") {
    throw new Error("Stage 5 MCP acceptance evidence does not prove the required MCP round trip");
  }
  return {
    schema: evidence.schema,
    generatedAt: evidence.generatedAt,
    appVersion: evidence.appVersion,
    release: { ...releaseEvidence },
    runtime: evidence.runtime,
    connector: evidence.connector,
    tool: evidence.tool,
  };
}

module.exports = {
  STAGE5_MCP_ACCEPTANCE_FUTURE_TOLERANCE_MS,
  STAGE5_MCP_ACCEPTANCE_MAX_AGE_MS,
  STAGE5_MCP_ACCEPTANCE_SCHEMA,
  normalizeWindowsPath,
  sameWindowsPath,
  verifyStage5McpAcceptanceEvidence,
  verifyStage5PrivatePath,
  verifyStage5WindowsAcceptanceHost,
  windowsRegisteredInstallLocation,
};
