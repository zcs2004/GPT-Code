import { spawnSync } from "node:child_process";
import { isAbsolute, win32 } from "node:path";

const WINDOWS_SYSTEM_SID = "S-1-5-18";
const WINDOWS_ADMINISTRATORS_SID = "S-1-5-32-544";

export interface WindowsAclRule {
  sid: string;
  type: string;
  inherited: boolean;
}

export interface WindowsAclInspection {
  ownerSid: string;
  currentUserSid: string;
  protected: boolean;
  access: WindowsAclRule[];
}

export interface WindowsPathPrivacy {
  safe: boolean;
  ownerSid: string;
  currentUserSid: string;
  protected: boolean;
  untrustedAllowSids: string[];
  detail?: string;
}

type SpawnSyncLike = typeof spawnSync;

function sid(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^S-\d(?:-\d+)+$/.test(value)) {
    throw new Error(`Windows ACL inspection returned an invalid ${label}`);
  }
  return value;
}

function accessRules(value: unknown): WindowsAclRule[] {
  const values = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  return values.map((rule, index) => {
    if (!rule || typeof rule !== "object") {
      throw new Error(`Windows ACL inspection returned an invalid access rule at index ${index}`);
    }
    const record = rule as Record<string, unknown>;
    if (record.type !== "Allow" && record.type !== "Deny") {
      throw new Error(`Windows ACL inspection returned an invalid access rule type at index ${index}`);
    }
    if (typeof record.inherited !== "boolean") {
      throw new Error(`Windows ACL inspection returned an invalid inheritance flag at index ${index}`);
    }
    return {
      sid: sid(record.sid, `access rule SID at index ${index}`),
      type: record.type,
      inherited: record.inherited,
    };
  });
}

export function evaluateWindowsPrivatePathAcl(inspection: WindowsAclInspection): WindowsPathPrivacy {
  const ownerSid = sid(inspection.ownerSid, "owner SID");
  const currentUserSid = sid(inspection.currentUserSid, "current user SID");
  if (typeof inspection.protected !== "boolean") {
    throw new Error("Windows ACL inspection returned an invalid protection flag");
  }
  const access = accessRules(inspection.access);
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

export function windowsPowerShellExecutable(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform !== "win32") throw new Error("Windows ACL inspection is available only on Windows");
  const windowsRoot = env.SystemRoot || env.WINDIR;
  if (!windowsRoot || !win32.isAbsolute(windowsRoot)) {
    throw new Error("Windows ACL inspection could not resolve an absolute SystemRoot");
  }
  return win32.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export function inspectWindowsPrivatePath(
  filePath: string,
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    spawnSyncImpl?: SpawnSyncLike;
  } = {},
): WindowsPathPrivacy {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
  const absolute = platform === "win32" ? win32.isAbsolute(filePath) : isAbsolute(filePath);
  if (platform !== "win32" || typeof filePath !== "string" || !absolute) {
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(result.stdout || "").trim());
  } catch {
    throw new Error("Could not inspect Windows ACL: invalid PowerShell response");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Could not inspect Windows ACL: invalid PowerShell response");
  }
  const record = parsed as Record<string, unknown>;
  return evaluateWindowsPrivatePathAcl({
    ownerSid: sid(record.ownerSid, "owner SID"),
    currentUserSid: sid(record.currentUserSid, "current user SID"),
    protected: record.protected as boolean,
    access: accessRules(record.access),
  });
}
