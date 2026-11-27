const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { inspectWindowsAuthenticode, sameWindowsPublisher } = require("./windows-authenticode.cjs");
const { inspectMacCodeSignature } = require("./mac-code-signature.cjs");

function appendLog(job, message) {
  try {
    fs.mkdirSync(path.dirname(job.logPath), { recursive: true, mode: 0o700 });
    fs.appendFileSync(job.logPath, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
  } catch {}
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitForParent(pid, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (processAlive(pid)) {
    if (Date.now() >= deadline) throw new Error(`Launcher process ${pid} did not exit in time`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function launch(bin, args = []) {
  const child = spawn(bin, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

function requireFile(filePath, label) {
  if (!filePath || !path.isAbsolute(filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} is missing: ${filePath || "unknown"}`);
  }
}

function requireWindowsPublisher(filePath, expectedPublisher, label, inspect = inspectWindowsAuthenticode) {
  if (typeof expectedPublisher !== "string" || !expectedPublisher.trim()) {
    throw new Error("Windows update job is missing its verified Authenticode publisher");
  }
  const signature = inspect(filePath);
  if (signature.status !== "Valid" || !signature.subject || !signature.thumbprint) {
    throw new Error(`${label} Authenticode verification failed: ${signature.status}`);
  }
  if (!sameWindowsPublisher(signature.subject, expectedPublisher)) {
    throw new Error(`${label} publisher does not match the verified update publisher`);
  }
  return signature;
}

function requireMacTeam(applicationPath, expectedTeamIdentifier, label, inspect = inspectMacCodeSignature) {
  if (typeof expectedTeamIdentifier !== "string" || !expectedTeamIdentifier.trim()) {
    throw new Error("macOS update job is missing its verified Developer ID team identifier");
  }
  const signature = inspect(applicationPath);
  if (signature.teamIdentifier !== expectedTeamIdentifier) {
    throw new Error(`${label} signer does not match the verified update signer`);
  }
  return signature;
}

function updateMac(job, dependencies = {}) {
  const inspectImpl = dependencies.inspectMacCodeSignature ?? inspectMacCodeSignature;
  const sourceExecutable = path.join(job.source, "Contents", "MacOS", "GPT Code");
  requireFile(sourceExecutable, "Staged macOS launcher");
  requireMacTeam(job.source, job.expectedTeamIdentifier, "Staged macOS launcher", inspectImpl);
  requireMacTeam(job.target, job.expectedTeamIdentifier, "Installed macOS launcher", inspectImpl);
  const next = `${job.target}.updating-${process.pid}`;
  const previous = `${job.target}.swap-${process.pid}`;
  fs.rmSync(next, { recursive: true, force: true });
  fs.rmSync(previous, { recursive: true, force: true });
  const copied = spawnSync("/usr/bin/ditto", [job.source, next], { encoding: "utf8", timeout: 180_000 });
  if (copied.error) throw copied.error;
  if (copied.status !== 0) throw new Error(`Could not stage the macOS application: ${copied.stderr.trim()}`);
  requireFile(path.join(next, "Contents", "MacOS", "GPT Code"), "Copied macOS launcher");
  requireMacTeam(next, job.expectedTeamIdentifier, "Copied macOS launcher", inspectImpl);

  fs.renameSync(job.target, previous);
  try {
    fs.renameSync(next, job.target);
  } catch (error) {
    fs.renameSync(previous, job.target);
    throw error;
  }
  fs.rmSync(previous, { recursive: true, force: true });
  launch("/usr/bin/open", [job.target]);
}

function updateWindows(job, dependencies = {}) {
  const requireFileImpl = dependencies.requireFile ?? requireFile;
  const spawnSyncImpl = dependencies.spawnSync ?? spawnSync;
  const launchImpl = dependencies.launch ?? launch;
  const inspectImpl = dependencies.inspectWindowsAuthenticode ?? inspectWindowsAuthenticode;
  requireFileImpl(job.source, "Windows installer");
  requireWindowsPublisher(job.source, job.expectedPublisher, "Windows update installer", inspectImpl);
  const result = spawnSyncImpl(job.source, ["/S", "/currentuser"], {
    encoding: "utf8",
    timeout: 15 * 60_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Windows installer exited with code ${result.status}`);
  requireFileImpl(job.target, "Installed Windows launcher");
  requireWindowsPublisher(job.target, job.expectedPublisher, "Installed Windows launcher", inspectImpl);
  launchImpl(job.target);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function installLinuxFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const next = `${target}.updating-${process.pid}`;
  fs.rmSync(next, { force: true });
  fs.copyFileSync(source, next);
  fs.chmodSync(next, 0o755);
  fs.renameSync(next, target);
}

function updateLinux(job) {
  requireFile(job.source, "Linux AppImage");
  requireFile(job.runnerSource, "Linux AppImage runner");
  const wrapper = job.wrapper && path.isAbsolute(job.wrapper) ? job.wrapper : null;
  if (!wrapper) throw new Error("Linux update job requires an absolute stable launcher wrapper");
  const versionsRoot = path.dirname(path.dirname(job.target));
  const nextTarget = path.join(versionsRoot, job.version, path.basename(job.target));
  const runner = path.join(versionsRoot, "run-appimage");
  installLinuxFile(job.source, nextTarget);
  installLinuxFile(job.runnerSource, runner);
  const wrapperNext = `${wrapper}.updating-${process.pid}`;
  fs.writeFileSync(wrapperNext, [
    "#!/bin/sh",
    "set -eu",
    `export CODEX_WEB_GPT_LAUNCHER_EXECUTABLE=${shellQuote(wrapper)}`,
    `export CODEX_WEB_GPT_APPIMAGE=${shellQuote(nextTarget)}`,
    `exec ${shellQuote(runner)} ${shellQuote(nextTarget)} "$@"`,
    "",
  ].join("\n"), { mode: 0o755 });
  fs.renameSync(wrapperNext, wrapper);
  if (path.dirname(job.target) !== path.dirname(nextTarget)
    && path.dirname(path.dirname(job.target)) === versionsRoot) {
    fs.rmSync(path.dirname(job.target), { recursive: true, force: true });
  }
  launch(wrapper);
}

function relaunchExisting(job) {
  try {
    if (job.platform === "darwin" && fs.existsSync(job.target)) {
      requireMacTeam(job.target, job.expectedTeamIdentifier, "Recovery macOS launcher");
      launch("/usr/bin/open", [job.target]);
    }
    else if (job.platform === "win32" && fs.existsSync(job.target)) {
      requireWindowsPublisher(job.target, job.expectedPublisher, "Recovery Windows launcher");
      launch(job.target);
    }
    else if (job.platform === "linux") {
      const target = job.wrapper && fs.existsSync(job.wrapper) ? job.wrapper : job.target;
      if (fs.existsSync(target)) launch(target);
    }
  } catch {}
}

async function main() {
  const jobPath = process.argv[2];
  if (!jobPath || !path.isAbsolute(jobPath)) throw new Error("Update worker requires an absolute job path");
  const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
  appendLog(job, `waiting for launcher PID ${job.parentPid} before installing v${job.version}`);
  await waitForParent(job.parentPid);
  await executeUpdateJob(job);
}

async function executeUpdateJob(job, dependencies = {}) {
  const appendLogImpl = dependencies.appendLog ?? appendLog;
  const updateMacImpl = dependencies.updateMac ?? updateMac;
  const updateWindowsImpl = dependencies.updateWindows ?? updateWindows;
  const updateLinuxImpl = dependencies.updateLinux ?? updateLinux;
  const relaunchExistingImpl = dependencies.relaunchExisting ?? relaunchExisting;
  appendLogImpl(job, `installing v${job.version} on ${job.platform}`);
  try {
    if (job.platform === "darwin") updateMacImpl(job);
    else if (job.platform === "win32") updateWindowsImpl(job);
    else if (job.platform === "linux") updateLinuxImpl(job);
    else throw new Error(`Unsupported update platform: ${job.platform}`);
    appendLogImpl(job, `v${job.version} installed and relaunched`);
    try { fs.rmSync(job.tempRoot, { recursive: true, force: true }); } catch {}
  } catch (error) {
    appendLogImpl(job, `update failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    relaunchExistingImpl(job);
    throw error;
  }
}

if (require.main === module) {
  void main().catch(() => process.exit(1));
}

module.exports = {
  executeUpdateJob,
  relaunchExisting,
  requireMacTeam,
  requireWindowsPublisher,
  updateMac,
  updateWindows,
};
