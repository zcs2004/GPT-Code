import { expect, test } from "bun:test";
import {
  evaluateWindowsPrivatePathAcl,
  inspectWindowsPrivatePath,
} from "../src/windows-file-security";

const USER_SID = "S-1-5-21-111-222-333-1001";

test("Windows private-file ACL accepts only the current user, SYSTEM, and Administrators", () => {
  expect(evaluateWindowsPrivatePathAcl({
    ownerSid: USER_SID,
    currentUserSid: USER_SID,
    protected: false,
    access: [
      { sid: USER_SID, type: "Allow", inherited: true },
      { sid: "S-1-5-18", type: "Allow", inherited: true },
      { sid: "S-1-5-32-544", type: "Allow", inherited: true },
    ],
  })).toEqual({
    safe: true,
    ownerSid: USER_SID,
    currentUserSid: USER_SID,
    protected: false,
    untrustedAllowSids: [],
  });

  const unsafe = evaluateWindowsPrivatePathAcl({
    ownerSid: USER_SID,
    currentUserSid: USER_SID,
    protected: false,
    access: [
      { sid: USER_SID, type: "Allow", inherited: true },
      { sid: "S-1-5-21-444-555-666-1005", type: "Allow", inherited: true },
      { sid: "S-1-1-0", type: "Deny", inherited: false },
    ],
  });
  expect(unsafe.safe).toBeFalse();
  expect(unsafe.untrustedAllowSids).toEqual(["S-1-5-21-444-555-666-1005"]);
  expect(unsafe.detail).toContain("untrusted SID");
});

test("Windows private-file ACL inspection sends paths over stdin instead of PowerShell source", () => {
  const filePath = "C:\\Users\\Example\\.codex-chatgpt-web\\secrets\\quoted ' $(literal).key";
  let invocation: { command: string; args: readonly string[]; options: Record<string, unknown> } | undefined;
  const result = inspectWindowsPrivatePath(filePath, {
    platform: "win32",
    env: { SystemRoot: "C:\\Windows" },
    spawnSyncImpl: ((command: string, args: readonly string[], options: Record<string, unknown>) => {
      invocation = { command, args, options };
      return {
        status: 0,
        signal: null,
        pid: 1,
        output: [],
        error: undefined,
        stderr: "",
        stdout: JSON.stringify({
          ownerSid: USER_SID,
          currentUserSid: USER_SID,
          protected: true,
          access: [{ sid: USER_SID, type: "Allow", inherited: false }],
        }),
      };
    }) as unknown as typeof import("node:child_process").spawnSync,
  });

  expect(invocation).toBeDefined();
  expect(invocation!.command.toLowerCase()).toEndWith("\\system32\\windowspowershell\\v1.0\\powershell.exe");
  expect(invocation!.args.includes(filePath)).toBeFalse();
  expect(invocation!.args.at(-1)?.includes(filePath)).toBeFalse();
  expect(invocation!.options.input).toBe(filePath);
  expect(invocation!.options.windowsHide).toBe(true);
  expect(result.safe).toBeTrue();
});

test("Windows private-file ACL rejects an unexpected owner", () => {
  const result = evaluateWindowsPrivatePathAcl({
    ownerSid: "S-1-5-32-544",
    currentUserSid: USER_SID,
    protected: true,
    access: [{ sid: USER_SID, type: "Allow", inherited: false }],
  });
  expect(result.safe).toBeFalse();
  expect(result.detail).toMatch(/owner .* is not the current user/);
});
