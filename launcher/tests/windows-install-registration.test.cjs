const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const manifest = require("../package.json");
const {
  inspectWindowsInstallRegistration,
  waitForWindowsUninstallCompletion,
  windowsRegisteredInstallLocation,
} = require("../scripts/windows-install-registration.cjs");

const GUID = manifest.build.nsis.guid;
const INSTALL_ROOT = "C:\\Users\\Example\\AppData\\Local\\Programs\\GPT Code";

function registrationResult(value) {
  return {
    status: 0,
    stdout: `${JSON.stringify(value)}\r\n`,
    stderr: "",
  };
}

test("Windows install registration uses fixed Windows PowerShell and keeps the GUID on stdin", () => {
  let captured;
  const result = inspectWindowsInstallRegistration({
    platform: "win32",
    env: { SystemRoot: "C:\\Windows" },
    spawnSyncImpl: (command, args, options) => {
      captured = { command, args, options };
      return registrationResult({ present: true, installLocation: INSTALL_ROOT });
    },
  });
  assert.equal(
    captured.command,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  assert.equal(captured.options.input, GUID);
  assert.equal(captured.args.includes(GUID), false);
  assert.equal(captured.args.some(value => value.includes(INSTALL_ROOT)), false);
  assert.deepEqual(result, {
    present: true,
    installLocation: path.win32.normalize(INSTALL_ROOT),
  });
});

test("an explicitly absent Windows install registration is the only optional missing state", () => {
  const options = {
    platform: "win32",
    env: { SystemRoot: "C:\\Windows" },
    spawnSyncImpl: () => registrationResult({ present: false }),
  };
  assert.equal(windowsRegisteredInstallLocation({ ...options, required: false }), null);
  assert.throws(
    () => windowsRegisteredInstallLocation(options),
    /did not register HKCU\\Software/,
  );
});

test("Windows install registration query failures fail closed", () => {
  assert.throws(
    () => windowsRegisteredInstallLocation({
      required: false,
      platform: "win32",
      env: { SystemRoot: "C:\\Windows" },
      spawnSyncImpl: () => ({ status: 1, stdout: "", stderr: "registry access failed" }),
    }),
    /Could not inspect Windows installer registration: registry access failed/,
  );
});

test("Windows install registration rejects malformed inspection responses", () => {
  for (const stdout of [
    "not-json",
    JSON.stringify({ present: "no" }),
    JSON.stringify({ present: false, installLocation: INSTALL_ROOT }),
  ]) {
    assert.throws(
      () => inspectWindowsInstallRegistration({
        platform: "win32",
        env: { SystemRoot: "C:\\Windows" },
        spawnSyncImpl: () => ({ status: 0, stdout, stderr: "" }),
      }),
      /registration inspection returned/,
    );
  }
});

test("Windows install registration rejects a relative InstallLocation", () => {
  assert.throws(
    () => inspectWindowsInstallRegistration({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows" },
      spawnSyncImpl: () => registrationResult({ present: true, installLocation: "relative\\path" }),
    }),
    /invalid InstallLocation/,
  );
});

test("Windows uninstall completion succeeds only after registration, executable, and install root are all absent", () => {
  const executable = path.win32.join(INSTALL_ROOT, "GPT Code.exe");
  let elapsed = 0;
  let polls = 0;
  const exists = (target) => {
    if (polls === 0) return target === executable || target === INSTALL_ROOT;
    return false;
  };
  waitForWindowsUninstallCompletion(INSTALL_ROOT, executable, {
    timeoutMs: 500,
    pollIntervalMs: 50,
    registeredInstallLocation: () => (polls++ === 0 ? INSTALL_ROOT : null),
    exists,
    now: () => elapsed,
    sleep: milliseconds => { elapsed += milliseconds; },
  });
  assert.equal(polls, 2);
  assert.equal(elapsed, 50);
});

test("Windows uninstall completion fails closed for every residual installation surface", () => {
  const executable = path.win32.join(INSTALL_ROOT, "GPT Code.exe");
  const cases = [
    {
      label: "registry",
      registeredInstallLocation: () => INSTALL_ROOT,
      exists: () => false,
      expected: `registry=${INSTALL_ROOT}`,
    },
    {
      label: "executable",
      registeredInstallLocation: () => null,
      exists: target => target === executable,
      expected: `executable=${executable}`,
    },
    {
      label: "install root",
      registeredInstallLocation: () => null,
      exists: target => target === INSTALL_ROOT,
      expected: `installRoot=${INSTALL_ROOT}`,
    },
  ];
  for (const item of cases) {
    assert.throws(
      () => waitForWindowsUninstallCompletion(INSTALL_ROOT, executable, {
        timeoutMs: 0,
        registeredInstallLocation: item.registeredInstallLocation,
        exists: item.exists,
        now: () => 100,
        sleep: () => assert.fail(`should not sleep for ${item.label}`),
      }),
      error => error instanceof Error
        && /Windows uninstaller did not fully remove the staged installation/.test(error.message)
        && error.message.includes(item.expected),
    );
  }
});

test("Windows uninstall completion rejects unsafe paths and unbounded timing", () => {
  const executable = path.win32.join(INSTALL_ROOT, "GPT Code.exe");
  assert.throws(
    () => waitForWindowsUninstallCompletion("relative", executable),
    /absolute install and executable paths/,
  );
  assert.throws(
    () => waitForWindowsUninstallCompletion(INSTALL_ROOT, executable, { timeoutMs: -1 }),
    /valid bounded timing values/,
  );
  assert.throws(
    () => waitForWindowsUninstallCompletion(INSTALL_ROOT, executable, { pollIntervalMs: 0 }),
    /valid bounded timing values/,
  );
});
