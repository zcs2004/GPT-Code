const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  ensureWindowsPrivateDirectory,
  evaluateWindowsPrivatePathAcl,
  hardenWindowsPrivateDirectory,
  inspectWindowsPrivatePath,
} = require("../electron/windows-file-security.cjs");

const USER_SID = "S-1-5-21-111-222-333-1001";

test("Windows ACL evaluation allows only the current user, SYSTEM, and Administrators", () => {
  assert.deepEqual(evaluateWindowsPrivatePathAcl({
    ownerSid: USER_SID,
    currentUserSid: USER_SID,
    protected: false,
    access: [
      { sid: USER_SID, type: "Allow", inherited: true },
      { sid: "S-1-5-18", type: "Allow", inherited: true },
      { sid: "S-1-5-32-544", type: "Allow", inherited: true },
    ],
  }), {
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
  assert.equal(unsafe.safe, false);
  assert.deepEqual(unsafe.untrustedAllowSids, ["S-1-5-21-444-555-666-1005"]);
  assert.match(unsafe.detail, /untrusted SID/);
});

test("Windows ACL inspection passes the target path through stdin and uses fixed Windows PowerShell", () => {
  const filePath = "C:\\Users\\Example\\AppData\\Roaming\\GPT Code\\quoted ' $(literal)";
  let invocation;
  const result = inspectWindowsPrivatePath(filePath, {
    platform: "win32",
    env: { SystemRoot: "C:\\Windows" },
    spawnSyncImpl: (command, args, options) => {
      invocation = { command, args, options };
      return {
        status: 0,
        error: null,
        stderr: "",
        stdout: JSON.stringify({
          ownerSid: USER_SID,
          currentUserSid: USER_SID,
          protected: true,
          access: [{ sid: USER_SID, type: "Allow", inherited: false }],
        }),
      };
    },
  });

  assert.equal(path.win32.basename(invocation.command).toLowerCase(), "powershell.exe");
  assert.match(invocation.command, /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.equal(invocation.args.includes(filePath), false);
  assert.equal(invocation.args.at(-1).includes(filePath), false);
  assert.equal(invocation.options.input, filePath);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(result.safe, true);
});

test("Windows ACL evaluation rejects an unexpected owner even when access entries are otherwise trusted", () => {
  const result = evaluateWindowsPrivatePathAcl({
    ownerSid: "S-1-5-32-544",
    currentUserSid: USER_SID,
    protected: true,
    access: [{ sid: USER_SID, type: "Allow", inherited: false }],
  });
  assert.equal(result.safe, false);
  assert.match(result.detail, /owner .* is not the current user/);
});

test("Windows ACL hardening passes only the target path through stdin and requests a protected private tree", () => {
  const directoryPath = "C:\\Users\\Example\\AppData\\Roaming\\GPT Code\\quoted ' $(literal)";
  let invocation;
  const result = hardenWindowsPrivateDirectory(directoryPath, {
    platform: "win32",
    env: { SystemRoot: "C:\\Windows" },
    spawnSyncImpl: (command, args, options) => {
      invocation = { command, args, options };
      return {
        status: 0,
        error: null,
        stderr: "",
        stdout: JSON.stringify({ changed: true, protected: true, protectedEntries: 9 }),
      };
    },
  });

  assert.match(invocation.command, /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.equal(invocation.args.includes(directoryPath), false);
  assert.equal(invocation.args.at(-1).includes(directoryPath), false);
  assert.equal(invocation.options.input, directoryPath);
  assert.equal(invocation.options.windowsHide, true);
  assert.match(invocation.args.at(-1), /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(invocation.args.at(-1), /FileAttributes\]::Directory/);
  assert.match(invocation.args.at(-1), /FileSystemRights\]::FullControl/);
  assert.match(invocation.args.at(-1), /ACL hardening verification failed for an entry/);
  assert.match(invocation.args.at(-1), /ReparsePoint/);
  assert.match(invocation.args.at(-1), /Directory\]::SetAccessControl/);
  assert.match(invocation.args.at(-1), /File\]::SetAccessControl/);
  assert.doesNotMatch(invocation.args.at(-1), /Set-Acl/);
  assert.deepEqual(result, { changed: true, protected: true, protectedEntries: 9 });
});

test("Windows private directory preparation migrates an existing unsafe tree and verifies the result", () => {
  const directoryPath = "C:\\Users\\Example\\AppData\\Roaming\\GPT Code";
  let inspections = 0;
  let hardeningCalls = 0;
  let mkdirCalls = 0;
  const result = ensureWindowsPrivateDirectory(directoryPath, {
    platform: "win32",
    fsImpl: {
      lstatSync: () => ({ isSymbolicLink: () => false, isDirectory: () => true }),
      mkdirSync: () => { mkdirCalls += 1; },
    },
    inspectImpl: () => {
      inspections += 1;
      return inspections === 1
        ? { safe: false, protected: false, detail: "untrusted inherited access" }
        : { safe: true, protected: true, detail: undefined };
    },
    hardenImpl: () => {
      hardeningCalls += 1;
      return { changed: true, protected: true, protectedEntries: 17 };
    },
  });

  assert.equal(mkdirCalls, 1);
  assert.equal(hardeningCalls, 1);
  assert.equal(inspections, 2);
  assert.equal(result.hardened, true);
  assert.equal(result.migrated, true);
  assert.equal(result.protectedEntries, 17);
  assert.equal(result.inspection.safe, true);
  assert.equal(result.inspection.protected, true);
});

test("Windows private directory preparation leaves an already protected safe tree unchanged", () => {
  let hardeningCalls = 0;
  const result = ensureWindowsPrivateDirectory("C:\\private", {
    platform: "win32",
    fsImpl: {
      lstatSync: () => ({ isSymbolicLink: () => false, isDirectory: () => true }),
      mkdirSync: () => {},
    },
    inspectImpl: () => ({ safe: true, protected: true }),
    hardenImpl: () => { hardeningCalls += 1; },
  });

  assert.equal(hardeningCalls, 0);
  assert.equal(result.hardened, false);
  assert.equal(result.migrated, false);
});

test("Windows private directory preparation rejects links before ACL mutation", () => {
  let hardened = false;
  assert.throws(() => ensureWindowsPrivateDirectory("C:\\private", {
    platform: "win32",
    fsImpl: {
      lstatSync: () => ({ isSymbolicLink: () => true, isDirectory: () => false }),
      mkdirSync: () => {},
    },
    inspectImpl: () => ({ safe: true, protected: true }),
    hardenImpl: () => { hardened = true; },
  }), /real directory/);
  assert.equal(hardened, false);
});

test("Windows private directory preparation fails closed when hardening fails", () => {
  let inspections = 0;
  assert.throws(() => ensureWindowsPrivateDirectory("C:\\private", {
    platform: "win32",
    fsImpl: {
      lstatSync: () => ({ isSymbolicLink: () => false, isDirectory: () => true }),
      mkdirSync: () => {},
    },
    inspectImpl: () => {
      inspections += 1;
      return { safe: false, protected: false, detail: "unsafe inherited ACL" };
    },
    hardenImpl: () => { throw new Error("ACL mutation unavailable"); },
  }), /ACL mutation unavailable/);
  assert.equal(inspections, 1);
});

test("Windows private directory preparation fails closed when post-hardening verification is still unsafe", () => {
  let inspections = 0;
  assert.throws(() => ensureWindowsPrivateDirectory("C:\\private", {
    platform: "win32",
    fsImpl: {
      lstatSync: () => ({ isSymbolicLink: () => false, isDirectory: () => true }),
      mkdirSync: () => {},
    },
    inspectImpl: () => {
      inspections += 1;
      return inspections === 1
        ? { safe: false, protected: false, detail: "before" }
        : { safe: true, protected: false, detail: undefined };
    },
    hardenImpl: () => ({ changed: true, protected: true, protectedEntries: 2 }),
  }), /remained unsafe/);
  assert.equal(inspections, 2);
});

test("Launcher prepares Windows userData privacy before any persistent launcher state is opened", () => {
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const lock = main.indexOf("const gotLock = app.requestSingleInstanceLock()");
  const prepare = main.indexOf("ensureWindowsPrivateDirectory(launcherUserData)");
  const setPath = main.indexOf('app.setPath("userData", launcherUserData)');
  const setSessionPath = main.indexOf('app.setPath("sessionData", launcherUserData)');
  const state = main.indexOf("const stateStore = createStateStore(");
  const assignState = main.indexOf("stateStore = createStateStore(");
  assert.ok(lock >= 0);
  assert.ok(prepare >= 0);
  assert.ok(lock < prepare);
  assert.ok(prepare < setPath);
  assert.ok(setPath < setSessionPath);
  assert.equal(state, -1);
  assert.ok(setSessionPath < assignState);
});
