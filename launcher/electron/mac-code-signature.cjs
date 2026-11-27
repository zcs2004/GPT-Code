const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function runChecked(command, args, label, spawnSyncImpl) {
  const result = spawnSyncImpl(command, args, {
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${String(result.stderr || result.stdout || "").trim() || `exit ${result.status}`}`);
  }
  return result;
}

function inspectMacCodeSignature(applicationPath, spawnSyncImpl = spawnSync) {
  if (typeof applicationPath !== "string" || !path.isAbsolute(applicationPath)
    || !fs.statSync(applicationPath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("macOS code-signature inspection requires an absolute application bundle");
  }
  runChecked(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", applicationPath],
    "macOS code-signature verification",
    spawnSyncImpl,
  );
  const details = runChecked(
    "/usr/bin/codesign",
    ["-dv", "--verbose=4", applicationPath],
    "macOS code-signature inspection",
    spawnSyncImpl,
  );
  const output = `${details.stdout || ""}\n${details.stderr || ""}`;
  const teamIdentifier = /^TeamIdentifier=(\S+)$/m.exec(output)?.[1] || null;
  if (!teamIdentifier || teamIdentifier === "not set") {
    throw new Error("macOS application does not have a Developer ID team identifier");
  }
  runChecked(
    "/usr/sbin/spctl",
    ["--assess", "--type", "execute", "--verbose=2", applicationPath],
    "macOS Gatekeeper assessment",
    spawnSyncImpl,
  );
  return { teamIdentifier };
}

function verifyMacCodeSignatureUpdate(stagedApplication, currentApplication, inspect = inspectMacCodeSignature) {
  const staged = inspect(stagedApplication);
  const current = inspect(currentApplication);
  if (staged.teamIdentifier !== current.teamIdentifier) {
    throw new Error("macOS update signer does not match the installed launcher");
  }
  return { teamIdentifier: staged.teamIdentifier };
}

module.exports = {
  inspectMacCodeSignature,
  verifyMacCodeSignatureUpdate,
};
