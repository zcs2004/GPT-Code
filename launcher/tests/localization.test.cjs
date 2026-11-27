const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const launcherRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(launcherRoot, "..");
const read = (...parts) => fs.readFileSync(path.join(repositoryRoot, ...parts), "utf8");

const englishReadme = read("README.md");
const chineseReadme = read("README.zh-CN.md");
const japaneseReadme = read("README.ja.md");
const koreanReadme = read("README.ko.md");
const languages = require("../electron/languages.json");
const appSource = read("launcher", "src", "App.tsx");

function loadI18nModule() {
  const source = read("launcher", "src", "i18n.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
    },
  }).outputText;
  const loaded = { exports: {} };
  Function("module", "exports", "require", output)(loaded, loaded.exports, require);
  return loaded.exports;
}

function loadSupportCopyModule() {
  const source = read("launcher", "src", "support-copy.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
    },
  }).outputText;
  const loaded = { exports: {} };
  Function("module", "exports", "require", output)(loaded, loaded.exports, require);
  return loaded.exports;
}

function commandFences(source) {
  return [...source.matchAll(/```(bash|powershell)\r?\n([\s\S]*?)```/g)]
    .map((match) => `${match[1]}\n${match[2].replace(/\r\n/g, "\n").trim()}`);
}

function linkTargets(source) {
  const markdown = [...source.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]);
  const html = [...source.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  return [...new Set([...markdown, ...html])].sort();
}

test("localized READMEs preserve every command block and link target from English", () => {
  for (const source of [chineseReadme, japaneseReadme, koreanReadme]) {
    assert.deepEqual(commandFences(source), commandFences(englishReadme));
    assert.deepEqual(linkTargets(source), linkTargets(englishReadme));
  }
});

test("Linux README download buttons distinguish x64 and ARM64 artwork", () => {
  const readmes = [englishReadme, chineseReadme, japaneseReadme, koreanReadme];
  const x64Button = /gpt-code-[^"]+-linux-x64\.AppImage"><img src="assets\/readme\/download-linux\.svg"/;
  const arm64Button = /gpt-code-[^"]+-linux-arm64\.AppImage"><img src="assets\/readme\/download-linux-arm64\.svg"/;
  const arm64UsingX64Artwork = /linux-arm64\.AppImage"><img src="assets\/readme\/download-linux\.svg"/;

  for (const source of readmes) {
    assert.match(source, x64Button);
    assert.match(source, arm64Button);
    assert.doesNotMatch(source, arm64UsingX64Artwork);
  }

  assert.match(read("assets", "readme", "download-linux.svg"), />x64 AppImage</);
  assert.match(read("assets", "readme", "download-linux-arm64.svg"), />ARM64 AppImage</);
});


for (const language of Object.keys(languages).filter(language => language !== "en")) test(`${language} runtime localization preserves literal connector names and endpoints`, () => {
  const { copyFor, localizeRuntimeMessage } = loadI18nModule();
  const copy = copyFor(language);
  const connectorNames = [
    "Codex Native2",
    "Native $&",
    "Native $'",
    "Native $`",
    "Native $1",
    'Native "quoted"',
    "Native \\path",
    "Native \u2028X",
    "Native \u2029X",
  ];

  for (const connectorName of connectorNames) {
    const message = `ChatGPT connector ${JSON.stringify(connectorName)} is available`;
    assert.equal(
      localizeRuntimeMessage(copy, message, "connector", language),
      copy.doctorConnectorAvailable.replace("{name}", () => connectorName),
    );
  }

  assert.equal(
    localizeRuntimeMessage(copy, "Responses proxy is healthy on 127.0.0.1:17841", "proxy", language),
    copy.doctorProxyHealthy.replace("{endpoint}", () => "127.0.0.1:17841"),
  );
  for (const [message, translated] of [
    ["This runtime has not observed a completed Codex model-list request yet", copy.doctorCatalogPending],
    ["Codex's latest model-list request succeeded", copy.doctorCatalogReady],
    ["Codex's latest model-list request failed; the local runtime is reachable", copy.doctorCatalogFailed],
  ]) {
    assert.equal(localizeRuntimeMessage(copy, message, "model-catalog", language), translated);
  }
});

test("runtime message localization preserves other languages and unknown backend messages", () => {
  const { copyFor, localizeRuntimeMessage } = loadI18nModule();
  const connectorNames = ["Codex Native2", "Native $&", "Native $'", "Native $`", 'Native "quoted"', "Native \\path"];

  for (const language of ["en"]) {
    for (const connectorName of connectorNames) {
      const connector = `ChatGPT connector ${JSON.stringify(connectorName)} is available`;
      assert.equal(localizeRuntimeMessage(copyFor(language), connector, "connector", language), connector);
    }
    assert.equal(
      localizeRuntimeMessage(copyFor(language), "Checking ChatGPT connector", undefined, language),
      "Checking ChatGPT connector",
    );
  }
  assert.equal(
    localizeRuntimeMessage(copyFor("ja"), "Tunnel runtime is not ready", "tunnel-runtime", "ja"),
    "Tunnel runtime is not ready",
  );
  assert.equal(
    localizeRuntimeMessage(copyFor("ja"), "Unexpected connector diagnostic", "connector", "ja"),
    copyFor("ja").connectorCheckFailed,
  );
  assert.equal(
    localizeRuntimeMessage(copyFor("ja"), 'ChatGPT connector "unterminated is available', "connector", "ja"),
    copyFor("ja").connectorCheckFailed,
  );
  assert.equal(
    localizeRuntimeMessage(copyFor("ja"), 'ChatGPT connector "Codex Native2" is available', "wrong-id", "ja"),
    'ChatGPT connector "Codex Native2" is available',
  );
  assert.equal(
    localizeRuntimeMessage(copyFor("ja"), "Checking ChatGPT connector", "unknown-check", "ja"),
    "Checking ChatGPT connector",
  );
  assert.equal(
    localizeRuntimeMessage(copyFor("ja"), 'ChatGPT connector "Codex Native2" is available (warning)', "connector", "ja"),
    copyFor("ja").connectorCheckFailed,
  );
});

test("launcher UI localizes MCP verification progress and doctor check messages", () => {
  assert.match(appSource, /message=\{localizeRuntimeMessage\(copy, error, undefined, language\)\}/);
  assert.match(appSource, /localizeRuntimeMessage\(copy, operation\.message, undefined, language\)/);
  assert.match(
    appSource,
    /<span>\{localizeRuntimeMessage\(copy, check\.message, check\.id, language\)\}<\/span>/,
  );
});

test("support and donation surfaces are complete in every launcher language", () => {
  const { supportCopyFor } = loadSupportCopyModule();
  const english = supportCopyFor("en");
  const keys = Object.keys(english).sort();
  assert.match(english.supportPrice, /6/);
  for (const language of Object.keys(languages)) {
    const copy = supportCopyFor(language);
    assert.deepEqual(Object.keys(copy).sort(), keys, language);
    assert.ok(Object.values(copy).every(value => typeof value === "string" && value.trim()), language);
    assert.match(copy.supportPrice, /6/, language);
    if (language !== "en") {
      for (const key of ["group", "technicalSupport", "donation", "donationBody"]) {
        assert.notEqual(copy[key], english[key], `${language}: ${key}`);
      }
    }
  }
  assert.doesNotMatch(appSource, /Task Center|任务中心|surface === "tasks"/);
});

test("Stage 5 user-visible messages cannot bypass the language catalog", () => {
  const { copyFor, localizeRuntimeMessage } = loadI18nModule();
  const stage5Source = read("launcher", "electron", "stage5-windows-acceptance.cjs");
  const stage5Messages = [...stage5Source.matchAll(/throw new Error\("(Stage 5 [^"]+)"\)/g)]
    .map(match => match[1]);
  assert.ok(stage5Messages.length >= 10, "expected the Stage 5 static error catalog");

  const operationMessages = [
    "Checking signed Windows installation",
    "Signed installed Windows release verified",
    "Running ChatGPT MCP acceptance",
    "ChatGPT invoked the local GPT Code MCP acceptance tool",
    "Finish the active Codex task before running the MCP acceptance test",
    "ChatGPT MCP acceptance requires Automation mode",
  ];
  for (const language of Object.keys(languages).filter(value => value !== "en")) {
    const copy = copyFor(language);
    for (const message of stage5Messages) {
      assert.notEqual(localizeRuntimeMessage(copy, message, "release-installation", language), message, `${language}: ${message}`);
    }
    for (const message of operationMessages) {
      assert.notEqual(localizeRuntimeMessage(copy, message, undefined, language), message, `${language}: ${message}`);
    }
  }
});

test("first-time language selection and Settings explain the embedded browser restart", () => {
  const { copyFor } = loadI18nModule();
  assert.match(appSource, /isLanguage\s*\? localized\.chooseLanguageHint/);
  assert.match(appSource, /<SettingRow body=\{copy\.embeddedBrowserLanguageHint\} label=\{copy\.language\}>/);
  const english = copyFor("en");
  assert.match(english.chooseLanguageHint, /first-time setup/);
  assert.match(english.embeddedBrowserLanguageHint, /Restart required/);
  assert.match(english.embeddedBrowserLanguageHint, /ChatGPT may use its own saved language setting/);
  for (const language of Object.keys(languages)) {
    const copy = copyFor(language);
    assert.equal(copy.product, "GPT Code", language);
    assert.ok(copy.setupTitle.includes("GPT Code"), language);
    assert.ok(copy.chooseLanguageHint.includes("GPT Code"), language);
    assert.ok(copy.embeddedBrowserLanguageHint.includes("GPT Code"), language);
    assert.ok(copy.embeddedBrowserLanguageHint.includes("ChatGPT"), language);
    if (language !== "en") {
      assert.notEqual(copy.chooseLanguageHint, english.chooseLanguageHint);
      assert.notEqual(copy.embeddedBrowserLanguageHint, english.embeddedBrowserLanguageHint);
    }
  }
});



test("native dialogs and IPC accept exactly the renderer's supported languages", () => {
  const main = read("launcher", "electron", "main.cjs");
  const copySource = main.slice(main.indexOf("const NATIVE_COPY ="), main.indexOf("function updateTrayMenu("));
  const validation = main.slice(main.indexOf("function validateLanguage("), main.indexOf("function validateBrowserInteractionMode("));
  const { nativeCopyFor, validateLanguage } = Function("languages", `${copySource}\n${validation}\nreturn {nativeCopyFor, validateLanguage};`)(languages);
  const english = nativeCopyFor("en");
  for (const language of Object.keys(languages)) {
    assert.equal(validateLanguage(language), language);
    const copy = nativeCopyFor(language);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(english).sort());
    assert.ok(Object.values(copy).every(value => typeof value === "string" && value.trim()));
    assert.ok(copy.openLauncher.includes("GPT Code"), language);
    assert.ok(copy.removeTitle.includes("GPT Code"), language);
    assert.ok(copy.startupTitle.includes("GPT Code"), language);
    if (language !== "en") for (const key of ["quit", "remove", "retry", "startupTitle"]) assert.notEqual(copy[key], english[key]);
  }
  for (const language of ["__proto__", "constructor", "unknown", null, [], {}]) assert.throws(() => validateLanguage(language), /Language must/);
});

test("all locales translate known doctor success checks without changing literal diagnostic data", () => {
  const { copyFor, localizeRuntimeMessage } = loadI18nModule();
  const fixturePath = "C:\\sample $&\\config.toml";
  const checks = [
    [undefined, "Checking local runtime", "checkingLocalRuntime"],
    [undefined, "Checking ChatGPT connector", "checkingChatGptConnector"],
    [undefined, "Checking signed Windows installation", "checkingSignedWindowsInstallation"],
    [undefined, "Signed installed Windows release verified", "signedWindowsReleaseVerified"],
    [undefined, "Running ChatGPT MCP acceptance", "runningMcpAcceptance"],
    [undefined, "ChatGPT invoked the local GPT Code MCP acceptance tool", "mcpAcceptanceSucceeded"],
    ["release-installation", "Stage 5 Windows acceptance could not resolve the packaged Launcher identity", "packagedLauncherIdentityMissing"],
    ["release-installation", "Stage 5 MCP acceptance requires a packaged production Launcher", "stage5WindowsAcceptanceFailed"],
    ["mcp-acceptance", "ChatGPT MCP acceptance requires Automation mode", "mcpAcceptanceRequiresAutomation"],
    ["tunnel-binary", "Pinned openai/tunnel-client binary is installed", "doctorTunnelBinaryInstalled"],
    ["tunnel-key", "Tunnel runtime key is stored privately", "doctorTunnelKeyStored"],
    ["tunnel-service", "Launcher owns the tunnel runtime", "doctorTunnelRuntimeOwned"],
    ["tunnel-runtime", "Tunnel runtime reports healthy and ready", "doctorTunnelRuntimeReady"],
    ["config", `Configuration is valid (${fixturePath})`, "doctorConfigValid", "{path}", fixturePath],
    ["browser-host", "Embedded launcher browser is authenticated and reachable (pid 345)", "doctorBrowserReady", "{pid}", "345"],
    ["browser-host", "Embedded launcher browser is reachable for Zero Risk (pid 678)", "doctorManualBrowserReady", "{pid}", "678"],
    ["codex", "Codex native model route is installed", "doctorCodexInstalled"],
    ["service", "Launcher owns the background runtime", "doctorRuntimeOwned"],
    ["chrome", `Chrome executable found: ${fixturePath}`, "doctorChromeFound", "{path}", fixturePath],
    ["login", "ChatGPT login state has authenticated browser evidence", "doctorLoginVerified"],
    ["service", "macOS background service is loaded", "doctorMacServiceLoaded"],
    ["tunnel-service", "macOS tunnel service is installed, loaded, and running", "doctorMacTunnelRunning"],
  ];
  for (const language of Object.keys(languages)) {
    const copy = copyFor(language);
    for (const [id, message, key, placeholder, value] of checks) {
      const expected = language === "en"
        ? message
        : placeholder ? copy[key].replace(placeholder, () => value) : copy[key];
      assert.equal(localizeRuntimeMessage(copy, message, id, language), expected);
      if (language !== "en") assert.notEqual(expected, message);
      if (language !== "en") assert.notEqual(expected, message);
      assert.equal(localizeRuntimeMessage(copy, message, "wrong-check", language), message);
    }
    for (const message of ["Configuration is invalid", "Embedded launcher browser is unavailable", "Original error $& /private/path"]) {
      assert.equal(localizeRuntimeMessage(copy, message, "config", language), message);
    }
  }
  for (const language of Object.keys(languages)) {
    const copy = copyFor(language);
    assert.equal(localizeRuntimeMessage(copy, "Tunnel runtime is not ready", "tunnel-runtime", language), "Tunnel runtime is not ready");
    assert.equal(
      localizeRuntimeMessage(copy, "Unexpected connector diagnostic", "connector", language),
      language === "en" ? "Unexpected connector diagnostic" : copy.connectorCheckFailed,
    );
  }
  assert.equal(copyFor("ko").install, "모델 설치");
  assert.equal(copyFor("zh-TW").install, "安裝模型");
});

test("runtime verification distinguishes an unsafe key from a connector that was not checked", () => {
  const { copyFor, localizeRuntimeMessage } = loadI18nModule();
  const connectorName = "Codex Native2";
  const keyError = "Tunnel runtime key permissions are unsafe; restart GPT Code to repair them";
  const pending = `ChatGPT connector ${JSON.stringify(connectorName)} has not been checked by the local runtime`;
  for (const language of Object.keys(languages)) {
    const copy = copyFor(language);
    assert.equal(
      localizeRuntimeMessage(copy, keyError, "tunnel-key", language),
      copy.doctorTunnelKeyUnsafe,
    );
    assert.equal(
      localizeRuntimeMessage(copy, pending, "connector", language),
      copy.doctorConnectorNotChecked.replace("{name}", () => connectorName),
    );
    assert.notEqual(
      localizeRuntimeMessage(copy, pending, "connector", language),
      copy.connectorCheckFailed,
    );
  }
});


test("plugin setup and Zero Risk instructions show configured names in every language", () => {
  const { copyFor } = loadI18nModule();
  const names = { automatic: "Codex Work", manual: "Codex Manual" };
  for (const language of Object.keys(languages)) {
    const copy = copyFor(language, names);
    for (const key of ["manualMcpStepThreeBody", "manualConnectorNotice", "manualPromptInstruction", "manualPromptWaiting"]) {
      assert.ok(copy[key].includes(names.manual), `${language}: ${key}`);
    }
    assert.ok(copy.connectorMigrationNotice.includes(names.automatic));
    assert.ok(copy.pluginNameWarning.length > 0);
    assert.equal(copyFor(language).manualPromptInstruction.includes("Codex Manual"), false);
  }
});
