const fs = require("node:fs");
const path = require("node:path");
const manifest = require("../package.json");
const {
  STAGE5_MCP_ACCEPTANCE_SCHEMA,
  verifyStage5McpAcceptanceEvidence,
  verifyStage5PrivatePath,
  verifyStage5WindowsAcceptanceHost,
  windowsRegisteredInstallLocation,
} = require("../electron/stage5-windows-acceptance.cjs");

const STAGE5_MCP_ACCEPTANCE_MAX_BYTES = 64 * 1024;

function readEvidence(evidencePath, {
  lstat = fs.lstatSync,
  readFile = fs.readFileSync,
} = {}) {
  let before;
  try {
    before = lstat(evidencePath);
  } catch {
    throw new Error("Stage 5 final verification requires MCP acceptance evidence");
  }
  if (!before?.isFile?.() || before.isSymbolicLink?.()) {
    throw new Error("Stage 5 MCP acceptance evidence must be a regular file");
  }
  if (!Number.isSafeInteger(before.size) || before.size < 1 || before.size > STAGE5_MCP_ACCEPTANCE_MAX_BYTES) {
    throw new Error("Stage 5 MCP acceptance evidence has an invalid file size");
  }
  let bytes;
  try {
    bytes = readFile(evidencePath);
  } catch {
    throw new Error("Stage 5 final verification requires MCP acceptance evidence");
  }
  if (!Buffer.isBuffer(bytes) || bytes.length !== before.size) {
    throw new Error("Stage 5 MCP acceptance evidence changed while it was being read");
  }
  let after;
  try {
    after = lstat(evidencePath);
  } catch {
    throw new Error("Stage 5 MCP acceptance evidence changed while it was being read");
  }
  if (!after?.isFile?.() || after.isSymbolicLink?.()
    || after.size !== before.size
    || after.dev !== before.dev
    || after.ino !== before.ino
    || after.mtimeMs !== before.mtimeMs
    || after.ctimeMs !== before.ctimeMs) {
    throw new Error("Stage 5 MCP acceptance evidence changed while it was being read");
  }
  let raw;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Stage 5 MCP acceptance evidence is not valid UTF-8");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Stage 5 MCP acceptance evidence is not valid JSON");
  }
}

function verifyInstalledStage5Release({
  platform = process.platform,
  appDataPath = process.env.APPDATA,
  expectedAppVersion = manifest.version,
  now = Date.now,
  registeredInstallLocation = windowsRegisteredInstallLocation,
  verifyHost = verifyStage5WindowsAcceptanceHost,
  verifyPrivatePath = verifyStage5PrivatePath,
  readEvidenceFile = readEvidence,
} = {}) {
  if (platform !== "win32") {
    throw new Error("Stage 5 final verification is only valid on Windows");
  }
  if (typeof appDataPath !== "string" || !path.win32.isAbsolute(appDataPath)) {
    throw new Error("Stage 5 final verification could not resolve the production app-data root");
  }
  const productName = manifest.build.productName;
  const installLocation = registeredInstallLocation();
  const executablePath = path.win32.join(installLocation, `${productName}.exe`);
  const userDataPath = path.win32.join(appDataPath, productName);
  const evidencePath = path.win32.join(userDataPath, "DeskPilot", "stage5-mcp-acceptance.json");
  const releaseEvidence = verifyHost({
    platform: "win32",
    packaged: true,
    developmentProfile: false,
    executablePath,
    appDataPath,
    userDataPath,
  });
  verifyPrivatePath(evidencePath, "MCP acceptance evidence file");
  const evidence = readEvidenceFile(evidencePath);
  const evidenceVerificationNow = typeof now === "function" ? now() : now;
  const result = verifyStage5McpAcceptanceEvidence({
    evidence,
    expectedAppVersion,
    releaseEvidence,
    now: evidenceVerificationNow,
  });
  const finalReleaseEvidence = verifyHost({
    platform: "win32",
    packaged: true,
    developmentProfile: false,
    executablePath,
    appDataPath,
    userDataPath,
  });
  for (const key of Object.keys(releaseEvidence)) {
    if (finalReleaseEvidence?.[key] !== releaseEvidence[key]) {
      throw new Error(`Stage 5 final verification detected the installed release changing after evidence verification: ${key}`);
    }
  }
  verifyPrivatePath(evidencePath, "MCP acceptance evidence file");
  const finalVerificationNow = typeof now === "function" ? now() : now;
  return verifyStage5McpAcceptanceEvidence({
    evidence,
    expectedAppVersion,
    releaseEvidence: finalReleaseEvidence,
    now: finalVerificationNow,
  });
}

function main() {
  const result = verifyInstalledStage5Release();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    schema: STAGE5_MCP_ACCEPTANCE_SCHEMA,
    generatedAt: result.generatedAt,
    appVersion: result.appVersion,
    release: result.release,
    runtime: result.runtime,
    connector: result.connector,
    tool: result.tool,
  }, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  STAGE5_MCP_ACCEPTANCE_MAX_BYTES,
  readEvidence,
  verifyInstalledStage5Release,
};
