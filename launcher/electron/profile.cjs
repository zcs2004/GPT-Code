const os = require("node:os");
const path = require("node:path");

const PRODUCTION_PROFILE = "production";
const DEVELOPMENT_PROFILE = "development";

function resolveUserPath(value, homeDir = os.homedir()) {
  if (value === "~") return homeDir;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.resolve(homeDir, value.slice(2));
  }
  return path.resolve(value);
}

function resolveLauncherProfile({
  argv = process.argv,
  env = process.env,
  homeDir = os.homedir(),
  appData,
} = {}) {
  if (typeof appData !== "string" || !path.isAbsolute(appData)) {
    throw new Error("Launcher profile resolution requires an absolute appData path");
  }
  const development = argv.includes("--dev-profile");
  if (!development) {
    const coreHome = env.CODEX_CHATGPT_WEB_HOME?.trim()
      ? resolveUserPath(env.CODEX_CHATGPT_WEB_HOME.trim(), homeDir)
      : path.join(homeDir, ".gpt-code");
    const userData = env.CODEX_WEB_GPT_LAUNCHER_DATA_DIR?.trim()
      ? resolveUserPath(env.CODEX_WEB_GPT_LAUNCHER_DATA_DIR.trim(), homeDir)
      : path.join(appData, "GPT Code");
    return {
      kind: PRODUCTION_PROFILE,
      displayName: "GPT Code",
      coreHome,
      codexHome: env.CODEX_HOME?.trim()
        ? resolveUserPath(env.CODEX_HOME.trim(), homeDir)
        : path.join(homeDir, ".codex"),
      userData,
      browserPartition: "persist:gpt-code-chatgpt",
    };
  }

  const coreHome = env.CODEX_WEB_GPT_DEV_HOME?.trim()
    ? resolveUserPath(env.CODEX_WEB_GPT_DEV_HOME.trim(), homeDir)
    : path.join(homeDir, ".gpt-code-dev");
  const productionHome = env.CODEX_CHATGPT_WEB_HOME?.trim()
    ? resolveUserPath(env.CODEX_CHATGPT_WEB_HOME.trim(), homeDir)
    : path.join(homeDir, ".gpt-code");
  if (path.resolve(coreHome) === path.resolve(productionHome)) {
    throw new Error("DEV profile home must differ from the production GPT Code home");
  }
  return {
    kind: DEVELOPMENT_PROFILE,
    displayName: "GPT Code DEV",
    coreHome,
    codexHome: path.join(coreHome, "codex-home"),
    userData: path.join(coreHome, "launcher"),
    browserPartition: "persist:gpt-code-dev-chatgpt",
  };
}

module.exports = {
  DEVELOPMENT_PROFILE,
  PRODUCTION_PROFILE,
  resolveLauncherProfile,
};
