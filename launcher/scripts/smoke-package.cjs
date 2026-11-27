const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateRuntimeBundle } = require("../electron/runtime-install.cjs");
const { inspectWindowsPrivatePath } = require("../electron/windows-file-security.cjs");
const {
  verifyWindowsAuthenticodeFile,
  verifyWindowsPublisherPair,
} = require("./windows-authenticode.cjs");
const {
  waitForWindowsUninstallCompletion,
  windowsRegisteredInstallLocation,
} = require("./windows-install-registration.cjs");

const launcherRoot = path.resolve(__dirname, "..");
const artifactsDirectory = path.join(launcherRoot, "artifacts");
const launcherManifest = JSON.parse(
  fs.readFileSync(path.join(launcherRoot, "package.json"), "utf8"),
);
const expectedVersion = launcherManifest.version;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-package-smoke-"));
const markerPath = path.join(scratch, "ready.json");
const coreHome = path.join(scratch, "core-home");
let macAppBundle;
let windowsInstallRoot = null;
let ownsWindowsInstall = false;
let windowsLauncherData = null;
let ownsWindowsLauncherData = false;
const legacyDeskPilotConversationId = "package-smoke-legacy-conversation";
const legacyDeskPilotConversationTitle = "Preserve me across migration";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || scratch,
    env: options.env || process.env,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: options.timeout || 45_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with status ${result.status}: ${result.stderr?.trim() || result.stdout?.trim() || "no output"}`,
    );
  }
}

function windowsUninstaller(installLocation) {
  const matches = fs.readdirSync(installLocation)
    .filter((name) => /^Uninstall .+\.exe$/i.test(name))
    .sort();
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one Windows uninstaller in ${installLocation}; found ${matches.join(", ") || "none"}`,
    );
  }
  return path.join(installLocation, matches[0]);
}

function verifyWindowsPrivateAcl(targetPath, label, { requireProtected = false } = {}) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} is missing before Windows ACL verification`);
  }
  const inspection = inspectWindowsPrivatePath(targetPath, { platform: "win32" });
  if (!inspection.safe || (requireProtected && !inspection.protected)) {
    throw new Error(
      `${label} does not have the required private Windows ACL`
      + (inspection.detail ? `: ${inspection.detail}` : requireProtected && !inspection.protected
        ? ": parent ACL inheritance is still enabled"
        : ""),
    );
  }
  return inspection;
}

function artifact(pattern, label) {
  const matches = fs.readdirSync(artifactsDirectory)
    .filter((name) => pattern.test(name))
    .sort();
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label} in ${artifactsDirectory}; found ${matches.join(", ") || "none"}`);
  }
  return path.join(artifactsDirectory, matches[0]);
}

function smokeEnvironment() {
  const environment = {
    ...process.env,
    TMPDIR: scratch,
    CODEX_CHATGPT_WEB_HOME: coreHome,
    CODEX_HOME: path.join(scratch, "codex-home"),
    CODEX_WEB_GPT_SMOKE_FILE: markerPath,
  };
  if (process.platform === "win32") {
    delete environment.CODEX_WEB_GPT_LAUNCHER_DATA_DIR;
  } else {
    environment.CODEX_WEB_GPT_LAUNCHER_DATA_DIR = path.join(scratch, "launcher-data");
  }
  return environment;
}

function windowsProductionLauncherData() {
  const appData = process.env.APPDATA?.trim();
  if (!appData || !path.win32.isAbsolute(appData)) {
    throw new Error("Windows package smoke requires an absolute APPDATA path");
  }
  return path.win32.join(appData, launcherManifest.build.productName);
}

function seedLegacyDeskPilotDatabase(databasePath) {
  const { Database } = require("bun:sqlite");
  const { migrateDeskPilotDatabase } = require("../../src/deskpilot/storage/migrations.ts");
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath, { create: true, strict: true });
  try {
    migrateDeskPilotDatabase(database);
    database.exec("DROP TABLE file_changes");
    database.exec("DROP TABLE workspaces");
    database.query("DELETE FROM schema_migrations WHERE version > 1").run();
    database.query(
      "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run(
      legacyDeskPilotConversationId,
      legacyDeskPilotConversationTitle,
      "2026-11-24T00:00:00.000Z",
      "2026-11-24T00:00:00.000Z",
    );
  } finally {
    database.close();
  }
}

function verifyMigratedDeskPilotDatabase(databasePath) {
  const { Database } = require("bun:sqlite");
  const {
    DESKPILOT_SCHEMA_VERSION,
    currentDeskPilotSchemaVersion,
  } = require("../../src/deskpilot/storage/migrations.ts");
  const migrationBackupPath = `${databasePath}.pre-migration-v1.bak`;
  const migrationMetadataPath = `${migrationBackupPath}.meta`;
  const verifyDatabase = (targetPath, expectedVersion, label) => {
    if (!fs.existsSync(targetPath)) throw new Error(`${label} is missing: ${targetPath}`);
    const database = new Database(targetPath, { readonly: true, strict: true });
    try {
      const version = currentDeskPilotSchemaVersion(database);
      const conversation = database.query(
        "SELECT title FROM conversations WHERE id = ?",
      ).get(legacyDeskPilotConversationId);
      if (version !== expectedVersion || conversation?.title !== legacyDeskPilotConversationTitle) {
        throw new Error(
          `${label} did not preserve the legacy DeskPilot record`
          + ` (schema=${version}, title=${JSON.stringify(conversation?.title ?? null)})`,
        );
      }
    } finally {
      database.close();
    }
  };
  verifyDatabase(databasePath, DESKPILOT_SCHEMA_VERSION, "Migrated DeskPilot database");
  verifyDatabase(migrationBackupPath, 1, "DeskPilot migration recovery point");
  if (!fs.existsSync(migrationMetadataPath)) {
    throw new Error(`DeskPilot migration recovery metadata is missing: ${migrationMetadataPath}`);
  }
  const metadata = JSON.parse(fs.readFileSync(migrationMetadataPath, "utf8"));
  if (metadata.schemaVersion !== 1 || !Number.isFinite(Date.parse(metadata.createdAt))) {
    throw new Error(`Unexpected DeskPilot migration recovery metadata: ${JSON.stringify(metadata)}`);
  }
  return { migrationBackupPath, migrationMetadataPath };
}

function readSmokeMarker(expectedStatePhase) {
  if (!fs.existsSync(markerPath)) throw new Error("Packaged launcher did not write its readiness marker");
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  if (marker.ok !== true
    || marker.packaged !== true
    || marker.runtimeVerified !== true
    || marker.version !== expectedVersion
    || marker.platform !== process.platform
    || marker.statePhase !== expectedStatePhase
    || marker.statePersistenceVerified !== (expectedStatePhase === "verify")) {
    throw new Error(`Unexpected packaged launcher marker: ${JSON.stringify(marker)}`);
  }
  return marker;
}

try {
  let executable;
  let command;
  let args;
  let windowsInstaller = null;
  const env = smokeEnvironment();
  const workspaceRoot = path.join(scratch, "user-workspace");
  const workspaceMarker = path.join(workspaceRoot, "keep-me.txt");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(workspaceMarker, "workspace data must survive app uninstall\n");

  if (process.platform === "darwin") {
    const archive = artifact(/-mac-(?:arm64|x64)\.zip$/, "macOS launcher archive");
    const stage = path.join(scratch, "stage");
    fs.mkdirSync(stage);
    run("ditto", ["-x", "-k", archive, stage]);
    macAppBundle = path.join(stage, "GPT Code.app");
    executable = path.join(macAppBundle, "Contents", "MacOS", "GPT Code");
    command = executable;
    args = ["--launcher-smoke-test"];
  } else if (process.platform === "linux") {
    if (!["x64", "arm64"].includes(process.arch)) {
      throw new Error(`Unsupported Linux AppImage architecture: ${process.arch}`);
    }
    executable = artifact(new RegExp(`-linux-${process.arch}\\.AppImage$`), `Linux ${process.arch} AppImage`);
    fs.chmodSync(executable, 0o755);
    run(path.join(launcherRoot, "scripts", "smoke-linux-appimage-symbols.sh"), [executable], {
      timeout: 120_000,
    });
    command = "xvfb-run";
    args = ["-a", executable, "--launcher-smoke-test"];
    env.APPIMAGE_EXTRACT_AND_RUN = "1";
  } else if (process.platform === "win32") {
    const existingInstall = windowsRegisteredInstallLocation({ required: false });
    if (existingInstall) {
      throw new Error(
        `Refusing package smoke because this Windows user already has the launcher installed at ${existingInstall}`,
      );
    }
    windowsLauncherData = windowsProductionLauncherData();
    if (fs.existsSync(windowsLauncherData)) {
      throw new Error(
        `Refusing package smoke because production Launcher userData already exists at ${windowsLauncherData}`,
      );
    }
    const installer = artifact(/-win-x64\.exe$/, "Windows installer");
    windowsInstaller = installer;
    if (process.env.CODEX_WEB_GPT_REQUIRE_AUTHENTICODE === "1") {
      verifyWindowsAuthenticodeFile(installer, "package smoke installer");
    }
    ownsWindowsInstall = true;
    run(installer, ["/S", "/currentuser"], { timeout: 120_000 });
    windowsInstallRoot = windowsRegisteredInstallLocation();
    executable = path.join(windowsInstallRoot, `${launcherManifest.build.productName}.exe`);
    if (fs.existsSync(windowsLauncherData)) {
      throw new Error(
        `Windows installer created production Launcher userData before the controlled smoke launch: ${windowsLauncherData}`,
      );
    }
    ownsWindowsLauncherData = true;
    seedLegacyDeskPilotDatabase(path.join(
      windowsLauncherData,
      "DeskPilot",
      "deskpilot.sqlite",
    ));
    if (process.env.CODEX_WEB_GPT_REQUIRE_AUTHENTICODE === "1") {
      verifyWindowsPublisherPair({
        installerPath: windowsInstaller,
        executablePath: executable,
        labelPrefix: "Windows package smoke",
      });
    }
    command = executable;
    args = ["--launcher-smoke-test"];
  } else {
    throw new Error(`Unsupported package smoke platform: ${process.platform}`);
  }

  if (!fs.existsSync(executable)) throw new Error(`Packaged launcher executable is missing: ${executable}`);
  if (process.platform === "win32") {
    env.CODEX_WEB_GPT_SMOKE_STATE_PHASE = "write";
    run(command, args, { env });
    readSmokeMarker("write");
    fs.rmSync(markerPath, { force: true });
    env.CODEX_WEB_GPT_SMOKE_STATE_PHASE = "verify";
    run(command, args, { env });
    readSmokeMarker("verify");
  } else {
    env.CODEX_WEB_GPT_SMOKE_STATE_PHASE = "single";
    run(command, args, { env });
    readSmokeMarker("single");
  }
  const installedRuntime = path.join(
    coreHome,
    "versions",
    `${expectedVersion}-${process.platform}-${process.arch}`,
  );
  const installedManifest = JSON.parse(
    fs.readFileSync(path.join(installedRuntime, "manifest.json"), "utf8"),
  );
  validateRuntimeBundle(installedRuntime, {
    version: expectedVersion,
    platform: process.platform,
    arch: process.arch,
  });
  if (installedManifest.schemaVersion !== 2
    || installedManifest.appVersion !== expectedVersion
    || installedManifest.platform !== process.platform
    || installedManifest.arch !== process.arch
    || !Array.isArray(installedManifest.files)
    || installedManifest.files.length === 0
    || !/^[a-f0-9]{64}$/.test(installedManifest.bundleId)) {
    throw new Error(`Packaged launcher installed the wrong durable runtime: ${JSON.stringify(installedManifest)}`);
  }

  if (process.platform === "win32") {
    const launcherData = windowsLauncherData;
    if (!launcherData) throw new Error("Windows package smoke lost its production Launcher userData path");
    const launcherDataMarker = path.join(launcherData, "uninstall-preserve.marker");
    const launcherStatePath = path.join(launcherData, "launcher-state.json");
    const deskPilotDatabasePath = path.join(launcherData, "DeskPilot", "deskpilot.sqlite");
    const browserPartitionPath = path.join(
      launcherData,
      "Partitions",
      "gpt-code-chatgpt",
    );
    if (!fs.existsSync(launcherStatePath)) {
      throw new Error("Windows package smoke did not persist launcher state before uninstall");
    }
    if (!fs.existsSync(deskPilotDatabasePath)) {
      throw new Error("Windows package smoke did not create the persisted DeskPilot database before uninstall");
    }
    const { migrationBackupPath, migrationMetadataPath } = verifyMigratedDeskPilotDatabase(
      deskPilotDatabasePath,
    );
    verifyWindowsPrivateAcl(launcherData, "Windows package smoke launcher userData", { requireProtected: true });
    verifyWindowsPrivateAcl(launcherStatePath, "Windows package smoke launcher state");
    verifyWindowsPrivateAcl(path.dirname(deskPilotDatabasePath), "Windows package smoke DeskPilot directory");
    verifyWindowsPrivateAcl(deskPilotDatabasePath, "Windows package smoke DeskPilot database");
    verifyWindowsPrivateAcl(migrationBackupPath, "Windows package smoke DeskPilot migration backup");
    verifyWindowsPrivateAcl(migrationMetadataPath, "Windows package smoke DeskPilot migration metadata");
    verifyWindowsPrivateAcl(browserPartitionPath, "Windows package smoke browser partition");
    const launcherStateBeforeUninstall = fs.readFileSync(launcherStatePath);
    const deskPilotDatabaseBeforeUninstall = fs.readFileSync(deskPilotDatabasePath);
    const deskPilotMigrationBackupBeforeUninstall = fs.readFileSync(migrationBackupPath);
    const deskPilotMigrationMetadataBeforeUninstall = fs.readFileSync(migrationMetadataPath);
    fs.mkdirSync(launcherData, { recursive: true });
    fs.writeFileSync(launcherDataMarker, "launcher data must survive app uninstall\n");
    const uninstaller = windowsUninstaller(windowsInstallRoot);
    run(uninstaller, ["/S"], { timeout: 120_000 });
    waitForWindowsUninstallCompletion(windowsInstallRoot, executable);
    if (!fs.existsSync(launcherDataMarker)) {
      throw new Error("Windows uninstaller deleted launcher user data");
    }
    if (!fs.existsSync(launcherStatePath)
      || !fs.readFileSync(launcherStatePath).equals(launcherStateBeforeUninstall)) {
      throw new Error("Windows uninstaller changed or deleted persisted launcher state");
    }
    if (!fs.existsSync(deskPilotDatabasePath)
      || !fs.readFileSync(deskPilotDatabasePath).equals(deskPilotDatabaseBeforeUninstall)) {
      throw new Error("Windows uninstaller changed or deleted persisted DeskPilot data");
    }
    if (!fs.existsSync(migrationBackupPath)
      || !fs.readFileSync(migrationBackupPath).equals(deskPilotMigrationBackupBeforeUninstall)
      || !fs.existsSync(migrationMetadataPath)
      || !fs.readFileSync(migrationMetadataPath).equals(deskPilotMigrationMetadataBeforeUninstall)) {
      throw new Error("Windows uninstaller changed or deleted DeskPilot migration recovery data");
    }
    if (!fs.existsSync(workspaceMarker)
      || fs.readFileSync(workspaceMarker, "utf8") !== "workspace data must survive app uninstall\n") {
      throw new Error("Windows uninstaller changed or deleted an external user workspace file");
    }
  }
  process.stdout.write(`PACKAGED_LAUNCHER_SMOKE_OK ${process.platform}/${process.arch}\n`);
} finally {
  try {
    if (macAppBundle) {
      const launchServices =
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
      run(
        launchServices,
        ["-u", macAppBundle],
      );
      run(launchServices, ["-gc"]);
    }
  } finally {
    try {
      if (process.platform === "win32" && ownsWindowsInstall) {
        const registered = windowsRegisteredInstallLocation({ required: false });
        const knownRootMatches = !registered || !windowsInstallRoot
          || path.win32.resolve(registered).toLowerCase() === path.win32.resolve(windowsInstallRoot).toLowerCase();
        if (registered && !knownRootMatches) {
          process.stderr.write(
            `Windows package smoke cleanup refused an unexpected install location: ${registered}\n`,
          );
        } else if (registered) {
          try {
            run(windowsUninstaller(registered), ["/S"], { timeout: 120_000 });
          } catch (error) {
            process.stderr.write(`Windows package smoke cleanup could not uninstall its staged app: ${error.message}\n`);
          }
        }
      }
      if (ownsWindowsLauncherData && windowsLauncherData) {
        fs.rmSync(windowsLauncherData, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
}
