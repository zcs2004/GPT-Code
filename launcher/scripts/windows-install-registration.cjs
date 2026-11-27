const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const launcherManifest = require("../package.json");
const { windowsPowerShellExecutable } = require("../electron/windows-file-security.cjs");

const WINDOWS_INSTALL_REGISTRATION_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$guid = [Console]::In.ReadToEnd().Trim()
if ($guid -notmatch '^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$') {
  throw 'Invalid launcher installation GUID'
}
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(('Software\' + $guid), $false)
if ($null -eq $key) {
  @{ present = $false } | ConvertTo-Json -Compress
} else {
  try {
    $installLocation = $key.GetValue(
      'InstallLocation',
      $null,
      [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
    )
    if (-not ($installLocation -is [string]) -or [string]::IsNullOrWhiteSpace($installLocation)) {
      throw 'Launcher registration exists without a valid InstallLocation value'
    }
    @{ present = $true; installLocation = [string]$installLocation } | ConvertTo-Json -Compress
  } finally {
    $key.Dispose()
  }
}
`;

function inspectWindowsInstallRegistration({
  guid = launcherManifest.build.nsis.guid,
  platform = process.platform,
  env = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  if (typeof guid !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(guid)) {
    throw new Error("Windows installer registration inspection requires a valid launcher GUID");
  }
  const result = spawnSyncImpl(windowsPowerShellExecutable(platform, env), [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    WINDOWS_INSTALL_REGISTRATION_SCRIPT,
  ], {
    encoding: "utf8",
    input: guid,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result?.error) {
    throw new Error(`Could not inspect Windows installer registration: ${result.error.message}`);
  }
  if (result?.status !== 0) {
    const detail = String(result?.stderr || "").trim() || `PowerShell exited with code ${result?.status}`;
    throw new Error(`Could not inspect Windows installer registration: ${detail}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result?.stdout || "").trim());
  } catch {
    throw new Error("Windows installer registration inspection returned invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.present !== "boolean") {
    throw new Error("Windows installer registration inspection returned an invalid response");
  }
  if (!parsed.present) {
    if (Object.keys(parsed).some(key => key !== "present")) {
      throw new Error("Windows installer registration inspection returned an invalid absent response");
    }
    return { present: false, installLocation: null };
  }
  if (Object.keys(parsed).some(key => key !== "present" && key !== "installLocation")
    || typeof parsed.installLocation !== "string"
    || !path.win32.isAbsolute(parsed.installLocation)) {
    throw new Error("Windows installer registered an invalid InstallLocation");
  }
  return {
    present: true,
    installLocation: path.win32.normalize(parsed.installLocation),
  };
}

function windowsRegisteredInstallLocation({ required = true, ...options } = {}) {
  const registration = inspectWindowsInstallRegistration(options);
  if (!registration.present) {
    if (!required) return null;
    const guid = options.guid || launcherManifest.build.nsis.guid;
    throw new Error(`Windows installer did not register HKCU\\Software\\${guid} with InstallLocation`);
  }
  return registration.installLocation;
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function waitForWindowsUninstallCompletion(installLocation, executablePath, {
  timeoutMs = 10_000,
  pollIntervalMs = 100,
  registeredInstallLocation = windowsRegisteredInstallLocation,
  exists = fs.existsSync,
  now = Date.now,
  sleep = sleepSync,
} = {}) {
  if (typeof installLocation !== "string" || !path.win32.isAbsolute(installLocation)
    || typeof executablePath !== "string" || !path.win32.isAbsolute(executablePath)) {
    throw new Error("Windows uninstall completion requires absolute install and executable paths");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0
    || !Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error("Windows uninstall completion requires valid bounded timing values");
  }
  const deadline = now() + timeoutMs;
  while (true) {
    const registered = registeredInstallLocation({ required: false });
    const executableExists = exists(executablePath);
    const installRootExists = exists(installLocation);
    if (!registered && !executableExists && !installRootExists) return;
    if (now() >= deadline) {
      const leftovers = [
        registered ? `registry=${registered}` : null,
        executableExists ? `executable=${executablePath}` : null,
        installRootExists ? `installRoot=${installLocation}` : null,
      ].filter(Boolean).join(", ");
      throw new Error(`Windows uninstaller did not fully remove the staged installation: ${leftovers}`);
    }
    sleep(pollIntervalMs);
  }
}

module.exports = {
  WINDOWS_INSTALL_REGISTRATION_SCRIPT,
  inspectWindowsInstallRegistration,
  waitForWindowsUninstallCompletion,
  windowsRegisteredInstallLocation,
};
