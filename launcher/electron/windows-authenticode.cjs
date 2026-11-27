const path = require("node:path");
const { spawnSync } = require("node:child_process");

function windowsPowerShellExecutable() {
  if (process.platform !== "win32") return "powershell.exe";
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!windowsRoot || !path.win32.isAbsolute(windowsRoot)) {
    throw new Error("Windows Authenticode inspection could not resolve an absolute SystemRoot");
  }
  return path.win32.join(
    windowsRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

function inspectWindowsAuthenticode(filePath, spawnSyncImpl = spawnSync) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new Error("Windows Authenticode inspection requires an absolute file path");
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$securityModule = Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'",
    "Import-Module -Name $securityModule -Force -ErrorAction Stop",
    "$targetPath = [Console]::In.ReadToEnd()",
    "if ([string]::IsNullOrWhiteSpace($targetPath)) { throw 'Authenticode target path was empty' }",
    "$signature = Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $targetPath",
    "$subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }",
    "$thumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }",
    "@{ status = [string]$signature.Status; subject = $subject; thumbprint = $thumbprint } | ConvertTo-Json -Compress",
  ].join("; ");
  const result = spawnSyncImpl(windowsPowerShellExecutable(), [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ], {
    encoding: "utf8",
    input: filePath,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error) throw new Error(`Could not inspect Windows Authenticode signature: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`Could not inspect Windows Authenticode signature: ${String(result.stderr || "").trim() || `PowerShell exited with code ${result.status}`}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout || "").trim());
  } catch {
    throw new Error("Could not inspect Windows Authenticode signature: invalid PowerShell response");
  }
  return {
    status: typeof parsed?.status === "string" ? parsed.status : "UnknownError",
    subject: typeof parsed?.subject === "string" && parsed.subject.trim() ? parsed.subject.trim() : null,
    thumbprint: typeof parsed?.thumbprint === "string" && /^[A-Fa-f0-9]+$/.test(parsed.thumbprint)
      ? parsed.thumbprint.toUpperCase()
      : null,
  };
}

function sameWindowsPublisher(left, right) {
  return typeof left === "string"
    && typeof right === "string"
    && left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US");
}

module.exports = {
  inspectWindowsAuthenticode,
  sameWindowsPublisher,
  windowsPowerShellExecutable,
};
