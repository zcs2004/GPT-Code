const test = require("node:test");
const assert = require("node:assert/strict");
const {
  WINDOWS_DPAPI_SECRET_PREFIX,
  WINDOWS_TUNNEL_RUNTIME_KEY_ENV,
  runtimeKeyTransport,
  unprotectWindowsSecret,
} = require("../electron/windows-dpapi.cjs");

test("Launcher DPAPI decrypt keeps protected bytes on stdin and plaintext out of argv", () => {
  const secret = "launcher-runtime-key-fixture";
  const protectedBytes = Buffer.from("protected-launcher-fixture");
  const envelope = `${WINDOWS_DPAPI_SECRET_PREFIX}${protectedBytes.toString("base64")}\n`;
  let invocation;
  const decrypted = unprotectWindowsSecret(envelope, {
    platform: "win32",
    env: { SystemRoot: "C:\\Windows" },
    spawnSyncImpl: (command, args, options) => {
      invocation = { command, args, options };
      return { status: 0, error: null, stderr: "", stdout: Buffer.from(secret).toString("base64") };
    },
  });
  assert.match(invocation.command, /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.equal(invocation.args.join(" ").includes(secret), false);
  assert.equal(invocation.options.input, protectedBytes.toString("base64"));
  assert.equal(decrypted.toString("utf8"), secret);
});

test("Launcher Windows tunnel uses only an env reference in argv for DPAPI and legacy keys", () => {
  const secret = "runtime-key-never-in-argv";
  for (const protectedAtRest of [true, false]) {
    const stored = protectedAtRest
      ? Buffer.from(`${WINDOWS_DPAPI_SECRET_PREFIX}${Buffer.from("ciphertext").toString("base64")}\n`)
      : Buffer.from(`${secret}\n`);
    const transport = runtimeKeyTransport("C:\\private\\runtime.key", { EXISTING: "1" }, {
      platform: "win32",
      fsImpl: { readFileSync: () => stored },
      unprotectImpl: () => Buffer.from(secret),
    });
    assert.equal(transport.reference, `env:${WINDOWS_TUNNEL_RUNTIME_KEY_ENV}`);
    assert.equal(transport.reference.includes(secret), false);
    assert.equal(transport.env[WINDOWS_TUNNEL_RUNTIME_KEY_ENV], secret);
    assert.equal(transport.env.EXISTING, "1");
    assert.equal(transport.protectedAtRest, protectedAtRest);
  }
});

test("Launcher non-Windows tunnel keeps the existing file reference", () => {
  const env = { EXISTING: "1" };
  const transport = runtimeKeyTransport("/private/runtime.key", env, { platform: "darwin" });
  assert.deepEqual(transport, { reference: "file:/private/runtime.key", env, protectedAtRest: false });
});
