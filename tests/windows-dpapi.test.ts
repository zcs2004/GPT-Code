import { expect, test } from "bun:test";
import {
  WINDOWS_DPAPI_SECRET_PREFIX,
  isWindowsDpapiEnvelope,
  protectWindowsSecret,
  unprotectWindowsSecret,
} from "../src/windows-dpapi";

test("Windows DPAPI protection keeps the secret out of argv and round-trips through a fixed PowerShell", () => {
  const secret = "runtime-secret-fixture";
  const entropy = "deskpilot:mcp-http-header:v1";
  const protectedBytes = Buffer.from("protected-fixture");
  let protectInvocation: { command: string; args: readonly string[]; input: unknown } | undefined;
  const envelope = protectWindowsSecret(secret, {
    entropy,
    platform: "win32",
    env: { SystemRoot: "C:\\Windows" },
    spawnSyncImpl: ((command: string, args: readonly string[], options: { input?: unknown }) => {
      protectInvocation = { command, args, input: options.input };
      return { status: 0, signal: null, pid: 1, output: [], error: undefined, stderr: "", stdout: protectedBytes.toString("base64") };
    }) as never,
  });
  expect(protectInvocation!.command.toLowerCase()).toEndWith("\\system32\\windowspowershell\\v1.0\\powershell.exe");
  expect(protectInvocation!.args.join(" ")).not.toContain(secret);
  expect(protectInvocation!.args.join(" ")).toContain(entropy);
  expect(protectInvocation!.input).toBe(Buffer.from(secret).toString("base64"));
  expect(envelope).toBe(`${WINDOWS_DPAPI_SECRET_PREFIX}${protectedBytes.toString("base64")}\n`);
  expect(isWindowsDpapiEnvelope(envelope)).toBeTrue();

  let unprotectInvocation: { args: readonly string[]; input: unknown } | undefined;
  const decrypted = unprotectWindowsSecret(envelope, {
    entropy,
    platform: "win32",
    env: { SystemRoot: "C:\\Windows" },
    spawnSyncImpl: ((_command: string, args: readonly string[], options: { input?: unknown }) => {
      unprotectInvocation = { args, input: options.input };
      return { status: 0, signal: null, pid: 1, output: [], error: undefined, stderr: "", stdout: Buffer.from(secret).toString("base64") };
    }) as never,
  });
  expect(unprotectInvocation!.args.join(" ")).not.toContain(secret);
  expect(unprotectInvocation!.args.join(" ")).toContain(entropy);
  expect(unprotectInvocation!.input).toBe(protectedBytes.toString("base64"));
  expect(Buffer.from(decrypted).toString("utf8")).toBe(secret);
});

if (process.platform === "win32") {
  test("Windows DPAPI real CurrentUser round-trip works on Windows", () => {
    const secret = `deskpilot-dpapi-${process.pid}-${Date.now()}`;
    const envelope = protectWindowsSecret(secret);
    expect(envelope).not.toContain(secret);
    expect(Buffer.from(unprotectWindowsSecret(envelope)).toString("utf8")).toBe(secret);
  });
} else {
  test.skip("Windows DPAPI real CurrentUser round-trip works on Windows", () => {});
}
