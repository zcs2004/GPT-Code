const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const WINDOWS_SYSTEM_SID = "S-1-5-18";
const WINDOWS_ADMINISTRATORS_SID = "S-1-5-32-544";

function requireSid(value, label) {
  if (typeof value !== "string" || !/^S-\d(?:-\d+)+$/.test(value)) {
    throw new Error(`Windows ACL inspection returned an invalid ${label}`);
  }
  return value;
}

function normalizeAccessRules(value) {
  const values = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  return values.map((rule, index) => {
    if (!rule || typeof rule !== "object") {
      throw new Error(`Windows ACL inspection returned an invalid access rule at index ${index}`);
    }
    if (rule.type !== "Allow" && rule.type !== "Deny") {
      throw new Error(`Windows ACL inspection returned an invalid access rule type at index ${index}`);
    }
    if (typeof rule.inherited !== "boolean") {
      throw new Error(`Windows ACL inspection returned an invalid inheritance flag at index ${index}`);
    }
    return {
      sid: requireSid(rule.sid, `access rule SID at index ${index}`),
      type: rule.type,
      inherited: rule.inherited,
    };
  });
}

function evaluateWindowsPrivatePathAcl(inspection) {
  const ownerSid = requireSid(inspection?.ownerSid, "owner SID");
  const currentUserSid = requireSid(inspection?.currentUserSid, "current user SID");
  if (typeof inspection?.protected !== "boolean") {
    throw new Error("Windows ACL inspection returned an invalid protection flag");
  }
  const access = normalizeAccessRules(inspection.access);
  const trustedAllowSids = new Set([
    currentUserSid,
    WINDOWS_SYSTEM_SID,
    WINDOWS_ADMINISTRATORS_SID,
  ]);
  const untrustedAllowSids = [...new Set(access
    .filter(rule => rule.type === "Allow" && !trustedAllowSids.has(rule.sid))
    .map(rule => rule.sid))];
  const ownerSafe = ownerSid === currentUserSid;
  const safe = ownerSafe && untrustedAllowSids.length === 0;
  const problems = [
    ...(!ownerSafe ? [`owner ${ownerSid} is not the current user`] : []),
    ...(untrustedAllowSids.length > 0
      ? [`access is granted to untrusted SID(s): ${untrustedAllowSids.join(", ")}`]
      : []),
  ];
  return {
    safe,
    ownerSid,
    currentUserSid,
    protected: inspection.protected,
    untrustedAllowSids,
    ...(problems.length > 0 ? { detail: `Windows ACL ${problems.join("; ")}` } : {}),
  };
}

function windowsPowerShellExecutable(platform = process.platform, env = process.env) {
  if (platform !== "win32") throw new Error("Windows ACL inspection is available only on Windows");
  const windowsRoot = env.SystemRoot || env.WINDIR;
  if (!windowsRoot || !path.win32.isAbsolute(windowsRoot)) {
    throw new Error("Windows ACL inspection could not resolve an absolute SystemRoot");
  }
  return path.win32.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function inspectWindowsPrivatePath(filePath, {
  platform = process.platform,
  env = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  if (platform !== "win32" || typeof filePath !== "string" || !path.win32.isAbsolute(filePath)) {
    throw new Error("Windows ACL inspection requires an absolute Windows path");
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$securityModule = Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'",
    "Import-Module -Name $securityModule -Force -ErrorAction Stop",
    "$targetPath = [Console]::In.ReadToEnd()",
    "if ([string]::IsNullOrWhiteSpace($targetPath)) { throw 'ACL target path was empty' }",
    "$acl = Microsoft.PowerShell.Security\\Get-Acl -LiteralPath $targetPath",
    "$currentUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "$ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value",
    "$access = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { @{ sid = $_.IdentityReference.Value; type = [string]$_.AccessControlType; inherited = [bool]$_.IsInherited } })",
    "@{ ownerSid = $ownerSid; currentUserSid = $currentUserSid; protected = [bool]$acl.AreAccessRulesProtected; access = $access } | ConvertTo-Json -Compress -Depth 4",
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
    input: filePath,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error) throw new Error(`Could not inspect Windows ACL: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || "").trim() || `PowerShell exited with code ${result.status}`;
    throw new Error(`Could not inspect Windows ACL: ${detail}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout || "").trim());
  } catch {
    throw new Error("Could not inspect Windows ACL: invalid PowerShell response");
  }
  return evaluateWindowsPrivatePathAcl({
    ownerSid: requireSid(parsed?.ownerSid, "owner SID"),
    currentUserSid: requireSid(parsed?.currentUserSid, "current user SID"),
    protected: parsed?.protected,
    access: normalizeAccessRules(parsed?.access),
  });
}

function hardenWindowsPrivateDirectory(directoryPath, {
  platform = process.platform,
  env = process.env,
  spawnSyncImpl = spawnSync,
} = {}) {
  if (platform !== "win32" || typeof directoryPath !== "string" || !path.win32.isAbsolute(directoryPath)) {
    throw new Error("Windows ACL hardening requires an absolute Windows directory path");
  }
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$securityModule = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
Import-Module -Name $securityModule -Force -ErrorAction Stop
$targetPath = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($targetPath)) { throw 'ACL target path was empty' }
$root = Get-Item -LiteralPath $targetPath -Force -ErrorAction Stop
if (-not $root.PSIsContainer) { throw 'ACL target is not a directory' }
if (($root.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'ACL target cannot be a reparse point' }
$currentUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$trustedSidValues = @($currentUserSid.Value, 'S-1-5-18', 'S-1-5-32-544')
$script:protectedEntries = 0

function Test-IsDirectoryEntry($entry) {
  return (($entry.Attributes -band [System.IO.FileAttributes]::Directory) -ne 0)
}

function Set-PrivateAcl($entry) {
  $existingAcl = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $entry.FullName
  $existingOwnerSid = $existingAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  if ($existingOwnerSid -ne $currentUserSid.Value) {
    throw 'ACL hardening refused an entry not owned by the current user'
  }
  $isDirectory = Test-IsDirectoryEntry $entry
  $privateAcl = if ($isDirectory) {
    New-Object System.Security.AccessControl.DirectorySecurity
  } else {
    New-Object System.Security.AccessControl.FileSecurity
  }
  $privateAcl.SetAccessRuleProtection($true, $false)
  $inheritance = if ($isDirectory) {
    [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    [System.Security.AccessControl.InheritanceFlags]::None
  }
  foreach ($sidValue in $trustedSidValues) {
    $identity = New-Object System.Security.Principal.SecurityIdentifier -ArgumentList $sidValue
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule -ArgumentList @(
      $identity,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$privateAcl.AddAccessRule($rule)
  }
  if ($isDirectory) {
    [System.IO.Directory]::SetAccessControl($entry.FullName, $privateAcl)
  } else {
    [System.IO.File]::SetAccessControl($entry.FullName, $privateAcl)
  }
  $verifiedEntryAcl = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $entry.FullName
  $verifiedEntryOwnerSid = $verifiedEntryAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  $verifiedEntryRules = @($verifiedEntryAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  $verifiedEntryUntrustedAllowSids = @($verifiedEntryRules |
    Where-Object { [string]$_.AccessControlType -eq 'Allow' -and $trustedSidValues -notcontains $_.IdentityReference.Value } |
    ForEach-Object { $_.IdentityReference.Value } |
    Select-Object -Unique)
  $currentUserFullControl = $false
  $requiredInheritance = [System.Security.AccessControl.InheritanceFlags]::None
  if ($isDirectory) {
    $requiredInheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  }
  foreach ($verifiedRule in $verifiedEntryRules) {
    if ($verifiedRule.IdentityReference.Value -eq $currentUserSid.Value -and [string]$verifiedRule.AccessControlType -eq 'Allow' -and (($verifiedRule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl) -and (($verifiedRule.InheritanceFlags -band $requiredInheritance) -eq $requiredInheritance)) {
      $currentUserFullControl = $true
      break
    }
  }
  if ($verifiedEntryOwnerSid -ne $currentUserSid.Value -or -not $verifiedEntryAcl.AreAccessRulesProtected -or $verifiedEntryUntrustedAllowSids.Count -ne 0 -or -not $currentUserFullControl) {
    throw 'ACL hardening verification failed for an entry'
  }
  $script:protectedEntries += 1
}

function Protect-Tree($directory) {
  if (($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'ACL hardening refused a reparse point in private data'
  }
  Set-PrivateAcl $directory
  foreach ($entry in $directory.EnumerateFileSystemInfos()) {
    if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'ACL hardening refused a reparse point in private data'
    }
    if (Test-IsDirectoryEntry $entry) { Protect-Tree $entry } else { Set-PrivateAcl $entry }
  }
}

Protect-Tree $root
$verifiedAcl = Microsoft.PowerShell.Security\Get-Acl -LiteralPath $targetPath
$verifiedOwnerSid = $verifiedAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$untrustedAllowSids = @($verifiedAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) |
  Where-Object { [string]$_.AccessControlType -eq 'Allow' -and $trustedSidValues -notcontains $_.IdentityReference.Value } |
  ForEach-Object { $_.IdentityReference.Value } |
  Select-Object -Unique)
if ($verifiedOwnerSid -ne $currentUserSid.Value -or -not $verifiedAcl.AreAccessRulesProtected -or $untrustedAllowSids.Count -ne 0) {
  throw 'ACL hardening verification failed'
}
@{ changed = $true; protected = $true; protectedEntries = $script:protectedEntries } | ConvertTo-Json -Compress
`.trim();
  const result = spawnSyncImpl(windowsPowerShellExecutable(platform, env), [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ], {
    encoding: "utf8",
    input: directoryPath,
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.error) throw new Error(`Could not harden Windows ACL: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || "").trim() || `PowerShell exited with code ${result.status}`;
    throw new Error(`Could not harden Windows ACL: ${detail}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout || "").trim());
  } catch {
    throw new Error("Could not harden Windows ACL: invalid PowerShell response");
  }
  if (parsed?.changed !== true || parsed?.protected !== true
    || !Number.isInteger(parsed?.protectedEntries) || parsed.protectedEntries < 1) {
    throw new Error("Could not harden Windows ACL: invalid PowerShell response");
  }
  return {
    changed: true,
    protected: true,
    protectedEntries: parsed.protectedEntries,
  };
}

function ensureWindowsPrivateDirectory(directoryPath, {
  platform = process.platform,
  fsImpl = fs,
  inspectImpl = inspectWindowsPrivatePath,
  hardenImpl = hardenWindowsPrivateDirectory,
} = {}) {
  if (platform !== "win32" || typeof directoryPath !== "string" || !path.win32.isAbsolute(directoryPath)) {
    throw new Error("Windows private directory preparation requires an absolute Windows path");
  }
  let existed = true;
  let stat;
  try {
    stat = fsImpl.lstatSync(directoryPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    existed = false;
  }
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
    throw new Error("Windows private data path must be a real directory");
  }
  fsImpl.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  const before = inspectImpl(directoryPath, { platform: "win32" });
  if (before.safe && before.protected) {
    return { hardened: false, migrated: false, inspection: before };
  }
  const hardening = hardenImpl(directoryPath, { platform: "win32" });
  const inspection = inspectImpl(directoryPath, { platform: "win32" });
  if (!inspection.safe || !inspection.protected) {
    throw new Error(inspection.detail || "Windows private data ACL remained unsafe after hardening");
  }
  return {
    hardened: true,
    migrated: existed,
    protectedEntries: hardening.protectedEntries,
    inspection,
  };
}

module.exports = {
  ensureWindowsPrivateDirectory,
  evaluateWindowsPrivatePathAcl,
  hardenWindowsPrivateDirectory,
  inspectWindowsPrivatePath,
  windowsPowerShellExecutable,
};
