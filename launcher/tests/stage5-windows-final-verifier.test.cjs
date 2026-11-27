const test = require("node:test");
const assert = require("node:assert/strict");
const manifest = require("../package.json");
const {
  STAGE5_MCP_ACCEPTANCE_MAX_BYTES,
  readEvidence,
  verifyInstalledStage5Release,
} = require("../scripts/verify-stage5-windows.cjs");

const APP_DATA = "C:\\Users\\Tester\\AppData\\Roaming";
const USER_DATA = `${APP_DATA}\\${manifest.build.productName}`;
const INSTALL_ROOT = `C:\\Users\\Tester\\AppData\\Local\\Programs\\${manifest.build.productName}`;
const EXECUTABLE = `${INSTALL_ROOT}\\${manifest.build.productName}.exe`;
const EXECUTABLE_SHA256 = "a".repeat(64);
const RELEASE = {
  platform: "win32",
  packaged: true,
  installation: "registered-current-user",
  authenticode: "valid",
  privateData: "verified",
  executableSha256: EXECUTABLE_SHA256,
};

function validEvidence(release = RELEASE) {
  return {
    schema: "deskpilot-stage5-mcp-acceptance-v2",
    generatedAt: "2026-11-24T08:00:00.000Z",
    appVersion: manifest.version,
    profile: "production",
    release: { ...release },
    runtime: "healthy",
    connector: "verified",
    tool: "deskpilot_acceptance_probe",
    effort: "5.6 Sol High",
    response: "DESKPILOT MCP READY",
  };
}

test("Stage 5 evidence reader accepts only a bounded regular file", () => {
  const serialized = JSON.stringify(validEvidence());
  const regularFile = {
    isFile: () => true,
    isSymbolicLink: () => false,
    size: Buffer.byteLength(serialized),
    dev: 1,
    ino: 2,
    mtimeMs: 3,
    ctimeMs: 4,
  };
  assert.deepEqual(
    readEvidence("C:\\evidence.json", {
      lstat: () => regularFile,
      readFile: () => Buffer.from(serialized),
    }),
    validEvidence(),
  );
  assert.throws(
    () => readEvidence("C:\\evidence.json", {
      lstat: () => ({ ...regularFile, isFile: () => false, isSymbolicLink: () => true }),
      readFile: () => Buffer.from(serialized),
    }),
    /must be a regular file/,
  );
  assert.throws(
    () => readEvidence("C:\\evidence.json", {
      lstat: () => ({ ...regularFile, size: STAGE5_MCP_ACCEPTANCE_MAX_BYTES + 1 }),
      readFile: () => Buffer.from(serialized),
    }),
    /invalid file size/,
  );
});

test("Stage 5 evidence reader rejects changes during the evidence read", () => {
  const serialized = JSON.stringify(validEvidence());
  const regularFile = {
    isFile: () => true,
    isSymbolicLink: () => false,
    size: Buffer.byteLength(serialized),
    dev: 1,
    ino: 2,
    mtimeMs: 3,
    ctimeMs: 4,
  };
  let lstatCalls = 0;
  assert.throws(
    () => readEvidence("C:\\evidence.json", {
      lstat: () => (++lstatCalls === 1 ? regularFile : { ...regularFile, ino: 99 }),
      readFile: () => Buffer.from(serialized),
    }),
    /changed while it was being read/,
  );
  assert.equal(lstatCalls, 2);
  assert.throws(
    () => readEvidence("C:\\evidence.json", {
      lstat: () => regularFile,
      readFile: () => Buffer.from(`${serialized}\n`),
    }),
    /changed while it was being read/,
  );
});

test("Stage 5 evidence reader rejects invalid UTF-8 before JSON parsing", () => {
  const invalidUtf8 = Buffer.from([0xc3, 0x28]);
  const stat = {
    isFile: () => true,
    isSymbolicLink: () => false,
    size: invalidUtf8.length,
    dev: 1,
    ino: 2,
    mtimeMs: 3,
    ctimeMs: 4,
  };
  assert.throws(
    () => readEvidence("C:\\evidence.json", {
      lstat: () => stat,
      readFile: () => invalidUtf8,
    }),
    /not valid UTF-8/,
  );
});

test("Stage 5 final verifier checks the registered installed release and bounded evidence read-only", () => {
  const calls = [];
  const result = verifyInstalledStage5Release({
    platform: "win32",
    appDataPath: APP_DATA,
    now: Date.parse("2026-11-24T08:30:00.000Z"),
    registeredInstallLocation: () => {
      calls.push("registry");
      return INSTALL_ROOT;
    },
    verifyHost: (options) => {
      calls.push(["host", options]);
      return RELEASE;
    },
    verifyPrivatePath: (target, label) => {
      calls.push(["private", target, label]);
    },
    readEvidenceFile: (target) => {
      calls.push(["read", target]);
      return validEvidence();
    },
  });

  assert.equal(calls[0], "registry");
  assert.deepEqual(calls[1], ["host", {
    platform: "win32",
    packaged: true,
    developmentProfile: false,
    executablePath: EXECUTABLE,
    appDataPath: APP_DATA,
    userDataPath: USER_DATA,
  }]);
  assert.deepEqual(calls[2], [
    "private",
    `${USER_DATA}\\DeskPilot\\stage5-mcp-acceptance.json`,
    "MCP acceptance evidence file",
  ]);
  assert.deepEqual(calls[3], [
    "read",
    `${USER_DATA}\\DeskPilot\\stage5-mcp-acceptance.json`,
  ]);
  assert.deepEqual(calls[4], ["host", {
    platform: "win32",
    packaged: true,
    developmentProfile: false,
    executablePath: EXECUTABLE,
    appDataPath: APP_DATA,
    userDataPath: USER_DATA,
  }]);
  assert.deepEqual(calls[5], [
    "private",
    `${USER_DATA}\\DeskPilot\\stage5-mcp-acceptance.json`,
    "MCP acceptance evidence file",
  ]);
  assert.deepEqual(result.release, RELEASE);
  assert.equal(result.appVersion, manifest.version);
  assert.equal(Object.hasOwn(result, "profile"), false);
  assert.equal(JSON.stringify(result).includes(INSTALL_ROOT), false);
  assert.equal(JSON.stringify(result).includes("Publisher"), false);
});

test("Stage 5 final verifier rejects stale evidence for a different installed EXE", () => {
  assert.throws(
    () => verifyInstalledStage5Release({
      platform: "win32",
      appDataPath: APP_DATA,
      now: Date.parse("2026-11-24T08:30:00.000Z"),
      registeredInstallLocation: () => INSTALL_ROOT,
      verifyHost: () => ({ ...RELEASE, executableSha256: "b".repeat(64) }),
      verifyPrivatePath: () => {},
      readEvidenceFile: () => validEvidence(),
    }),
    /does not match the current installed release: executableSha256/,
  );
});

test("Stage 5 final verifier rejects expired MCP acceptance evidence", () => {
  assert.throws(
    () => verifyInstalledStage5Release({
      platform: "win32",
      appDataPath: APP_DATA,
      now: Date.parse("2026-11-24T09:00:00.001Z"),
      registeredInstallLocation: () => INSTALL_ROOT,
      verifyHost: () => RELEASE,
      verifyPrivatePath: () => {},
      readEvidenceFile: () => validEvidence(),
    }),
    /evidence is stale/,
  );
});

test("Stage 5 final verifier rechecks evidence freshness at the final release gate", () => {
  const times = [
    Date.parse("2026-11-24T08:59:59.999Z"),
    Date.parse("2026-11-24T09:00:00.001Z"),
  ];
  assert.throws(
    () => verifyInstalledStage5Release({
      platform: "win32",
      appDataPath: APP_DATA,
      now: () => times.shift(),
      registeredInstallLocation: () => INSTALL_ROOT,
      verifyHost: () => RELEASE,
      verifyPrivatePath: () => {},
      readEvidenceFile: () => validEvidence(),
    }),
    /evidence is stale/,
  );
  assert.equal(times.length, 0);
});

test("Stage 5 final verifier rejects installed release changes after evidence verification", () => {
  let hostCalls = 0;
  assert.throws(
    () => verifyInstalledStage5Release({
      platform: "win32",
      appDataPath: APP_DATA,
      now: Date.parse("2026-11-24T08:30:00.000Z"),
      registeredInstallLocation: () => INSTALL_ROOT,
      verifyHost: () => (++hostCalls === 1 ? RELEASE : { ...RELEASE, executableSha256: "b".repeat(64) }),
      verifyPrivatePath: () => {},
      readEvidenceFile: () => validEvidence(),
    }),
    /installed release changing after evidence verification: executableSha256/,
  );
  assert.equal(hostCalls, 2);
});

test("Stage 5 final verifier rechecks the evidence ACL after the second release gate", () => {
  let privateChecks = 0;
  assert.throws(
    () => verifyInstalledStage5Release({
      platform: "win32",
      appDataPath: APP_DATA,
      now: Date.parse("2026-11-24T08:30:00.000Z"),
      registeredInstallLocation: () => INSTALL_ROOT,
      verifyHost: () => RELEASE,
      verifyPrivatePath: () => {
        privateChecks += 1;
        if (privateChecks === 2) {
          throw new Error("Stage 5 MCP acceptance requires a private MCP acceptance evidence file");
        }
      },
      readEvidenceFile: () => validEvidence(),
    }),
    /private MCP acceptance evidence file/,
  );
  assert.equal(privateChecks, 2);
});

test("Stage 5 final verifier rejects a non-private acceptance evidence file before reading it", () => {
  let evidenceRead = false;
  assert.throws(
    () => verifyInstalledStage5Release({
      platform: "win32",
      appDataPath: APP_DATA,
      now: Date.parse("2026-11-24T08:30:00.000Z"),
      registeredInstallLocation: () => INSTALL_ROOT,
      verifyHost: () => RELEASE,
      verifyPrivatePath: () => {
        throw new Error("Stage 5 MCP acceptance requires a private MCP acceptance evidence file");
      },
      readEvidenceFile: () => {
        evidenceRead = true;
        return validEvidence();
      },
    }),
    /private MCP acceptance evidence file/,
  );
  assert.equal(evidenceRead, false);
});

test("Stage 5 final verifier rejects non-Windows before inspecting install or evidence", () => {
  let touched = false;
  assert.throws(
    () => verifyInstalledStage5Release({
      platform: "linux",
      appDataPath: APP_DATA,
      now: Date.parse("2026-11-24T08:30:00.000Z"),
      registeredInstallLocation: () => {
        touched = true;
        return INSTALL_ROOT;
      },
      verifyHost: () => {
        touched = true;
        return RELEASE;
      },
      verifyPrivatePath: () => {
        touched = true;
      },
      readEvidenceFile: () => {
        touched = true;
        return validEvidence();
      },
    }),
    /only valid on Windows/,
  );
  assert.equal(touched, false);
});
