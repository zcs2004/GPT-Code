const test = require("node:test");
const assert = require("node:assert/strict");
const manifest = require("../package.json");
const {
  verifyStage5McpAcceptanceEvidence,
  verifyStage5WindowsAcceptanceHost,
  windowsRegisteredInstallLocation,
} = require("../electron/stage5-windows-acceptance.cjs");

const APP_DATA = "C:\\Users\\Tester\\AppData\\Roaming";
const USER_DATA = `${APP_DATA}\\${manifest.build.productName}`;
const INSTALL_ROOT = `C:\\Users\\Tester\\AppData\\Local\\Programs\\${manifest.build.productName}`;
const EXECUTABLE = `${INSTALL_ROOT}\\${manifest.build.productName}.exe`;
const EXECUTABLE_SHA256 = "a".repeat(64);

function registeredInstallResult(location = INSTALL_ROOT) {
  return {
    status: 0,
    stdout: `HKEY_CURRENT_USER\\Software\\${manifest.build.nsis.guid}\r\n    InstallLocation    REG_SZ    ${location}\r\n`,
    stderr: "",
  };
}

function validSignature() {
  return {
    status: "Valid",
    subject: "CN=DeskPilot Publisher",
    thumbprint: "A1B2C3D4",
  };
}

function safeAcl(protectedAcl = true) {
  return { safe: true, protected: protectedAcl, untrustedAllowSids: [] };
}

test("Stage 5 Windows acceptance binds evidence to the frozen installed signed production host", () => {
  let registryInvocation = null;
  const aclTargets = [];
  const result = verifyStage5WindowsAcceptanceHost({
    platform: "win32",
    packaged: true,
    developmentProfile: false,
    executablePath: EXECUTABLE.toLowerCase(),
    appDataPath: APP_DATA,
    userDataPath: `${USER_DATA}\\`,
    spawnSyncImpl: (command, args, options) => {
      registryInvocation = { command, args, options };
      return registeredInstallResult();
    },
    inspect: (target) => {
      assert.equal(target, EXECUTABLE.toLowerCase());
      return validSignature();
    },
    hashFile: (target) => {
      assert.equal(target, EXECUTABLE.toLowerCase());
      return EXECUTABLE_SHA256;
    },
    exists: () => true,
    inspectPrivatePath: (target, options) => {
      aclTargets.push({ target, options });
      return safeAcl(true);
    },
  });

  assert.deepEqual(result, {
    platform: "win32",
    packaged: true,
    installation: "registered-current-user",
    authenticode: "valid",
    privateData: "verified",
    executableSha256: EXECUTABLE_SHA256,
  });
  assert.equal(Object.hasOwn(result, "subject"), false);
  assert.equal(Object.hasOwn(result, "thumbprint"), false);
  assert.equal(registryInvocation.command, "reg.exe");
  assert.deepEqual(registryInvocation.args, [
    "query",
    `HKCU\\Software\\${manifest.build.nsis.guid}`,
    "/v",
    "InstallLocation",
  ]);
  assert.deepEqual(registryInvocation.options, { encoding: "utf8", windowsHide: true });
  assert.deepEqual(aclTargets, [
    { target: `${USER_DATA}\\`, options: { platform: "win32" } },
    { target: `${USER_DATA}\\DeskPilot`, options: { platform: "win32" } },
    { target: `${USER_DATA}\\Partitions\\gpt-code-chatgpt`, options: { platform: "win32" } },
  ]);
});

test("Stage 5 Windows acceptance rejects non-Windows, unpackaged, and development launchers", () => {
  const common = {
    executablePath: EXECUTABLE,
    appDataPath: APP_DATA,
    userDataPath: USER_DATA,
    spawnSyncImpl: () => registeredInstallResult(),
    inspect: validSignature,
    hashFile: () => EXECUTABLE_SHA256,
    exists: () => true,
    inspectPrivatePath: () => safeAcl(true),
  };
  assert.throws(
    () => verifyStage5WindowsAcceptanceHost({ ...common, platform: "linux", packaged: true }),
    /only valid on Windows/,
  );
  assert.throws(
    () => verifyStage5WindowsAcceptanceHost({ ...common, platform: "win32", packaged: false }),
    /packaged production Launcher/,
  );
  assert.throws(
    () => verifyStage5WindowsAcceptanceHost({
      ...common,
      platform: "win32",
      packaged: true,
      developmentProfile: true,
    }),
    /packaged production Launcher/,
  );
});

test("Stage 5 Windows acceptance rejects userData overrides before touching the install registry", () => {
  let registryCalls = 0;
  assert.throws(
    () => verifyStage5WindowsAcceptanceHost({
      platform: "win32",
      packaged: true,
      executablePath: EXECUTABLE,
      appDataPath: APP_DATA,
      userDataPath: "D:\\temporary-launcher-data",
      spawnSyncImpl: () => {
        registryCalls += 1;
        return registeredInstallResult();
      },
      inspect: validSignature,
      hashFile: () => EXECUTABLE_SHA256,
      exists: () => true,
      inspectPrivatePath: () => safeAcl(true),
    }),
    /frozen production Launcher userData path/,
  );
  assert.equal(registryCalls, 0);
});

test("Stage 5 Windows acceptance requires a valid registered install location and the registered executable", () => {
  assert.throws(
    () => windowsRegisteredInstallLocation({
      spawnSyncImpl: () => ({ status: 1, stdout: "", stderr: "missing" }),
    }),
    /registered current-user Windows installation/,
  );
  assert.throws(
    () => windowsRegisteredInstallLocation({
      spawnSyncImpl: () => ({ status: 0, stdout: "InstallLocation    REG_SZ    relative\\path", stderr: "" }),
    }),
    /invalid registered installation location/,
  );
  assert.throws(
    () => verifyStage5WindowsAcceptanceHost({
      platform: "win32",
      packaged: true,
      executablePath: "C:\\Temp\\GPT Code.exe",
      appDataPath: APP_DATA,
      userDataPath: USER_DATA,
      spawnSyncImpl: () => registeredInstallResult(),
      inspect: validSignature,
      hashFile: () => EXECUTABLE_SHA256,
      exists: () => true,
      inspectPrivatePath: () => safeAcl(true),
    }),
    /currently registered Windows installation/,
  );
});

test("Stage 5 Windows acceptance fails closed for unsigned or certificate-less installed executables", () => {
  for (const signature of [
    { status: "NotSigned", subject: null, thumbprint: null },
    { status: "Valid", subject: null, thumbprint: null },
  ]) {
    assert.throws(
      () => verifyStage5WindowsAcceptanceHost({
        platform: "win32",
        packaged: true,
        executablePath: EXECUTABLE,
        appDataPath: APP_DATA,
        userDataPath: USER_DATA,
        spawnSyncImpl: () => registeredInstallResult(),
        inspect: () => signature,
        hashFile: () => EXECUTABLE_SHA256,
        exists: () => true,
        inspectPrivatePath: () => safeAcl(true),
      }),
      /Authenticode-valid installed Launcher/,
    );
  }
});

test("Stage 5 Windows acceptance requires private ACL evidence for production data and browser state", () => {
  const common = {
    platform: "win32",
    packaged: true,
    executablePath: EXECUTABLE,
    appDataPath: APP_DATA,
    userDataPath: USER_DATA,
    spawnSyncImpl: () => registeredInstallResult(),
    inspect: validSignature,
    hashFile: () => EXECUTABLE_SHA256,
  };

  assert.throws(
    () => verifyStage5WindowsAcceptanceHost({
      ...common,
      exists: target => !target.endsWith("\\DeskPilot"),
      inspectPrivatePath: () => safeAcl(true),
    }),
    /private DeskPilot data directory/,
  );

  assert.throws(
    () => verifyStage5WindowsAcceptanceHost({
      ...common,
      exists: () => true,
      inspectPrivatePath: target => target === USER_DATA ? safeAcl(false) : safeAcl(true),
    }),
    /private Windows ACL for Launcher userData root/,
  );

  assert.throws(
    () => verifyStage5WindowsAcceptanceHost({
      ...common,
      exists: () => true,
      inspectPrivatePath: target => target.endsWith("gpt-code-chatgpt")
        ? { safe: false, protected: true, untrustedAllowSids: ["S-1-5-21-OTHER"] }
        : safeAcl(true),
    }),
    /private Windows ACL for ChatGPT browser partition/,
  );
});

test("Stage 5 Windows acceptance requires a privacy-safe lowercase executable SHA-256", () => {
  const common = {
    platform: "win32",
    packaged: true,
    executablePath: EXECUTABLE,
    appDataPath: APP_DATA,
    userDataPath: USER_DATA,
    spawnSyncImpl: () => registeredInstallResult(),
    inspect: validSignature,
    exists: () => true,
    inspectPrivatePath: () => safeAcl(true),
  };
  for (const invalidDigest of ["A".repeat(64), "a".repeat(63), "not-a-digest", null]) {
    assert.throws(
      () => verifyStage5WindowsAcceptanceHost({
        ...common,
        hashFile: () => invalidDigest,
      }),
      /invalid installed Launcher SHA-256/,
    );
  }
});

test("Stage 5 Windows acceptance rejects an executable that changes during signature verification", () => {
  let hashCalls = 0;
  assert.throws(
    () => verifyStage5WindowsAcceptanceHost({
      platform: "win32",
      packaged: true,
      executablePath: EXECUTABLE,
      appDataPath: APP_DATA,
      userDataPath: USER_DATA,
      spawnSyncImpl: () => registeredInstallResult(),
      inspect: validSignature,
      hashFile: () => (++hashCalls === 1 ? EXECUTABLE_SHA256 : "b".repeat(64)),
      exists: () => true,
      inspectPrivatePath: () => safeAcl(true),
    }),
    /changing during verification/,
  );
  assert.equal(hashCalls, 2);
});

test("Stage 5 MCP evidence is bound to the exact installed executable digest", () => {
  const releaseEvidence = {
    platform: "win32",
    packaged: true,
    installation: "registered-current-user",
    authenticode: "valid",
    privateData: "verified",
    executableSha256: EXECUTABLE_SHA256,
  };
  const evidence = {
    schema: "deskpilot-stage5-mcp-acceptance-v2",
    generatedAt: "2026-11-24T08:00:00.000Z",
    appVersion: manifest.version,
    profile: "production",
    release: { ...releaseEvidence },
    runtime: "healthy",
    connector: "verified",
    tool: "deskpilot_acceptance_probe",
    effort: "5.6 Sol High",
    response: "DESKPILOT MCP READY",
  };
  assert.deepEqual(
    verifyStage5McpAcceptanceEvidence({
      evidence,
      expectedAppVersion: manifest.version,
      releaseEvidence,
      now: Date.parse("2026-11-24T08:30:00.000Z"),
    }).release,
    releaseEvidence,
  );
  assert.throws(
    () => verifyStage5McpAcceptanceEvidence({
      evidence,
      expectedAppVersion: manifest.version,
      releaseEvidence: { ...releaseEvidence, executableSha256: "b".repeat(64) },
      now: Date.parse("2026-11-24T08:30:00.000Z"),
    }),
    /does not match the current installed release: executableSha256/,
  );
  assert.throws(
    () => verifyStage5McpAcceptanceEvidence({
      evidence: { ...evidence, unexpected: "must-not-be-accepted" },
      expectedAppVersion: manifest.version,
      releaseEvidence,
      now: Date.parse("2026-11-24T08:30:00.000Z"),
    }),
    /invalid top-level schema/,
  );
  assert.equal(JSON.stringify(evidence).includes(EXECUTABLE), false);
  assert.equal(JSON.stringify(evidence).includes("DeskPilot Publisher"), false);
});

test("Stage 5 MCP evidence requires a fresh canonical generation timestamp", () => {
  const releaseEvidence = {
    platform: "win32",
    packaged: true,
    installation: "registered-current-user",
    authenticode: "valid",
    privateData: "verified",
    executableSha256: EXECUTABLE_SHA256,
  };
  const evidence = {
    schema: "deskpilot-stage5-mcp-acceptance-v2",
    generatedAt: "2026-11-24T08:00:00.000Z",
    appVersion: manifest.version,
    profile: "production",
    release: { ...releaseEvidence },
    runtime: "healthy",
    connector: "verified",
    tool: "deskpilot_acceptance_probe",
    effort: "5.6 Sol High",
    response: "DESKPILOT MCP READY",
  };
  const verify = (generatedAt, now) => verifyStage5McpAcceptanceEvidence({
    evidence: { ...evidence, generatedAt },
    expectedAppVersion: manifest.version,
    releaseEvidence,
    now: Date.parse(now),
  });

  assert.equal(
    verify("2026-11-24T08:00:00.000Z", "2026-11-24T08:59:59.999Z").generatedAt,
    "2026-11-24T08:00:00.000Z",
  );
  assert.throws(
    () => verify("2026-11-24 08:00:00Z", "2026-11-24T08:30:00.000Z"),
    /invalid generation timestamp/,
  );
  assert.throws(
    () => verify("2026-11-24T08:00:00.000Z", "2026-11-24T09:00:00.001Z"),
    /evidence is stale/,
  );
  assert.throws(
    () => verify("2026-11-24T08:35:00.001Z", "2026-11-24T08:30:00.000Z"),
    /timestamp is in the future/,
  );
});
