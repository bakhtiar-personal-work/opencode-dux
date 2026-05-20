#!/usr/bin/env bun
// @bun
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/cli/install.ts
import { existsSync as existsSync3 } from "node:fs";
import { createInterface } from "node:readline/promises";

// src/cli/config-io.ts
import {
  copyFileSync,
  existsSync as existsSync2,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";

// src/cli/paths.ts
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
function getDefaultOpenCodeConfigDir() {
  const userConfigDir = process.env.XDG_CONFIG_HOME ? process.env.XDG_CONFIG_HOME : join(homedir(), ".config");
  return join(userConfigDir, "opencode");
}
function getCustomOpenCodeConfigDir() {
  const configDir = process.env.OPENCODE_CONFIG_DIR?.trim();
  return configDir || undefined;
}
function getCustomTuiConfigPath() {
  const configPath = process.env.OPENCODE_TUI_CONFIG?.trim();
  return configPath || undefined;
}
function getConfigDir() {
  const customConfigDir = getCustomOpenCodeConfigDir();
  if (customConfigDir) {
    return customConfigDir;
  }
  return getDefaultOpenCodeConfigDir();
}
function getOpenCodeConfigPaths() {
  const configDir = getDefaultOpenCodeConfigDir();
  return [join(configDir, "opencode.json"), join(configDir, "opencode.jsonc")];
}
function getConfigJson() {
  return getOpenCodeConfigPaths()[0];
}
function getConfigJsonc() {
  return getOpenCodeConfigPaths()[1];
}
function getLiteConfig() {
  return join(getConfigDir(), "opencode-dux.json");
}
function getLiteConfigJsonc() {
  return join(getConfigDir(), "opencode-dux.jsonc");
}
function getTuiConfig() {
  const customConfigPath = getCustomTuiConfigPath();
  if (customConfigPath)
    return customConfigPath;
  return join(getConfigDir(), "tui.json");
}
function getTuiConfigJsonc() {
  return join(getConfigDir(), "tui.jsonc");
}
function getExistingLiteConfigPath() {
  const jsonPath = getLiteConfig();
  if (existsSync(jsonPath))
    return jsonPath;
  const jsoncPath = getLiteConfigJsonc();
  if (existsSync(jsoncPath))
    return jsoncPath;
  return jsonPath;
}
function getExistingTuiConfigPath() {
  const customConfigPath = getCustomTuiConfigPath();
  if (customConfigPath)
    return customConfigPath;
  const jsonPath = join(getConfigDir(), "tui.json");
  if (existsSync(jsonPath))
    return jsonPath;
  const jsoncPath = getTuiConfigJsonc();
  if (existsSync(jsoncPath))
    return jsoncPath;
  return jsonPath;
}
function getExistingConfigPath() {
  const jsonPath = getConfigJson();
  if (existsSync(jsonPath))
    return jsonPath;
  const jsoncPath = getConfigJsonc();
  if (existsSync(jsoncPath))
    return jsoncPath;
  return jsonPath;
}
function ensureConfigDir() {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}
function ensureTuiConfigDir() {
  const configDir = dirname(getTuiConfig());
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}
function ensureOpenCodeConfigDir() {
  const configDir = dirname(getConfigJson());
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

// src/cli/providers.ts
var SCHEMA_URL = "https://unpkg.com/opencode-dux@latest/opencode-dux.schema.json";
var GENERATED_PRESETS = ["openai", "opencode-go"];
var MODEL_MAPPINGS = {
  openai: {
    orchestrator: { model: "openai/gpt-5.5" },
    oracle: { model: "openai/gpt-5.5", variant: "high" },
    librarian: { model: "openai/gpt-5.4-mini", variant: "low" },
    explorer: { model: "openai/gpt-5.4-mini", variant: "low" },
    designer: { model: "openai/gpt-5.4-mini", variant: "medium" },
    fixer: { model: "openai/gpt-5.4-mini", variant: "low" }
  },
  kimi: {
    orchestrator: { model: "kimi-for-coding/k2p5" },
    oracle: { model: "kimi-for-coding/k2p5", variant: "high" },
    librarian: { model: "kimi-for-coding/k2p5", variant: "low" },
    explorer: { model: "kimi-for-coding/k2p5", variant: "low" },
    designer: { model: "kimi-for-coding/k2p5", variant: "medium" },
    fixer: { model: "kimi-for-coding/k2p5", variant: "low" }
  },
  copilot: {
    orchestrator: { model: "github-copilot/claude-opus-4.6" },
    oracle: { model: "github-copilot/claude-opus-4.6", variant: "high" },
    librarian: { model: "github-copilot/grok-code-fast-1", variant: "low" },
    explorer: { model: "github-copilot/grok-code-fast-1", variant: "low" },
    designer: {
      model: "github-copilot/gemini-3.1-pro-preview",
      variant: "medium"
    },
    fixer: { model: "github-copilot/claude-sonnet-4.6", variant: "low" }
  },
  "zai-plan": {
    orchestrator: { model: "zai-coding-plan/glm-5" },
    oracle: { model: "zai-coding-plan/glm-5", variant: "high" },
    librarian: { model: "zai-coding-plan/glm-5", variant: "low" },
    explorer: { model: "zai-coding-plan/glm-5", variant: "low" },
    designer: { model: "zai-coding-plan/glm-5", variant: "medium" },
    fixer: { model: "zai-coding-plan/glm-5", variant: "low" }
  },
  "opencode-go": {
    orchestrator: {
      model: "neuralwatt/zai-org/GLM-5.1-FP8",
      variant: "medium"
    },
    oracle: { model: "opencode-go/deepseek-v4-flash", variant: "medium" },
    librarian: { model: "opencode-go/deepseek-v4-flash", variant: "low" },
    explorer: { model: "neuralwatt/qwen3.5-397b-fast", variant: "low" },
    designer: { model: "opencode-go/mimo-v2.5-pro", variant: "medium" },
    fixer: { model: "opencode-go/deepseek-v4-flash", variant: "low" }
  }
};
function isGeneratedPresetName(value) {
  return GENERATED_PRESETS.includes(value);
}
function getGeneratedPresetNames() {
  return [...GENERATED_PRESETS];
}
function generateLiteConfig(installConfig) {
  const preset = installConfig.preset ?? "openai";
  if (!isGeneratedPresetName(preset)) {
    throw new Error(`Unsupported preset "${preset}". Available generated presets: ${getGeneratedPresetNames().join(", ")}`);
  }
  const config = {
    $schema: SCHEMA_URL,
    preset,
    presets: {}
  };
  const createAgentConfig = (agentName, modelInfo) => {
    return {
      model: modelInfo.model,
      variant: modelInfo.variant
    };
  };
  const buildPreset = (mappingName) => {
    const mapping = MODEL_MAPPINGS[mappingName];
    return Object.fromEntries(Object.entries(mapping).map(([agentName, modelInfo]) => [
      agentName,
      createAgentConfig(agentName, modelInfo)
    ]));
  };
  const presets = config.presets;
  for (const presetName of GENERATED_PRESETS) {
    presets[presetName] = buildPreset(presetName);
  }
  config.agents = {
    orchestrator: {
      skills: { "always-load": ["find-skills"], wildcard: true }
    },
    designer: {
      skills: {
        "always-load": ["agent-browser", "web-design-guidelines"],
        wildcard: false
      }
    },
    oracle: {
      skills: { "always-load": ["requesting-code-review"], wildcard: false }
    },
    librarian: {
      skills: { "always-load": ["find-skills"], wildcard: false }
    }
  };
  return config;
}

// src/cli/config-io.ts
var PACKAGE_NAME = "opencode-dux";
function isString(value) {
  return typeof value === "string";
}
function getPlugins(config) {
  return Array.isArray(config.plugin) ? config.plugin : [];
}
function getPluginEntries(config) {
  return getPlugins(config).filter(isString);
}
function getPluginSpec(entry) {
  if (isString(entry))
    return entry;
  if (!Array.isArray(entry))
    return;
  const spec = entry[0];
  return isString(spec) ? spec : undefined;
}
function normalizePathForMatch(path) {
  return path.replaceAll("\\", "/");
}
function findPackageRoot(startPath) {
  let currentPath = dirname2(startPath);
  while (true) {
    const packageJsonPath = join2(currentPath, "package.json");
    if (existsSync2(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        if (packageJson.name === PACKAGE_NAME) {
          return currentPath;
        }
      } catch {}
    }
    const parentPath = dirname2(currentPath);
    if (parentPath === currentPath) {
      return null;
    }
    currentPath = parentPath;
  }
}
function isPackageManagerInstall(path) {
  const normalizedPath = normalizePathForMatch(path);
  return normalizedPath.includes(`/node_modules/${PACKAGE_NAME}`);
}
function isLocalPackageRootEntry(entry) {
  if (!entry || entry.startsWith("file://")) {
    return false;
  }
  const packageJsonPath = join2(entry, "package.json");
  if (!existsSync2(packageJsonPath)) {
    return false;
  }
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return packageJson.name === PACKAGE_NAME;
  } catch {
    return false;
  }
}
function isPluginEntry(entry) {
  return entry === PACKAGE_NAME || entry.startsWith(`${PACKAGE_NAME}@`) || entry.startsWith("file://") && entry.includes(PACKAGE_NAME) || isLocalPackageRootEntry(entry);
}
function isMatchingPluginEntry(entry) {
  const spec = getPluginSpec(entry);
  return spec ? isPluginEntry(spec) : false;
}
function getPluginEntry() {
  const cliEntryPath = process.argv[1];
  if (!cliEntryPath) {
    return PACKAGE_NAME;
  }
  try {
    const packageRoot = findPackageRoot(cliEntryPath);
    if (!packageRoot || isPackageManagerInstall(packageRoot)) {
      return PACKAGE_NAME;
    }
    return packageRoot;
  } catch {
    return PACKAGE_NAME;
  }
}
function stripJsonComments(json) {
  const commentPattern = /\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g;
  const trailingCommaPattern = /\\"|"(?:\\"|[^"])*"|(,)(\s*[}\]])/g;
  return json.replace(commentPattern, (match, commentGroup) => commentGroup ? "" : match).replace(trailingCommaPattern, (match, comma, closing) => comma ? closing : match);
}
function parseConfigFile(path) {
  try {
    if (!existsSync2(path))
      return { config: null };
    const stat = statSync(path);
    if (stat.size === 0)
      return { config: null };
    const content = readFileSync(path, "utf-8");
    if (content.trim().length === 0)
      return { config: null };
    return { config: JSON.parse(stripJsonComments(content)) };
  } catch (err) {
    return { config: null, error: String(err) };
  }
}
function parseConfig(path) {
  const result = parseConfigFile(path);
  if (result.config || result.error)
    return result;
  if (path.endsWith(".json")) {
    const jsoncPath = path.replace(/\.json$/, ".jsonc");
    return parseConfigFile(jsoncPath);
  }
  return { config: null };
}
function writeConfig(configPath, config) {
  if (configPath.endsWith(".jsonc")) {
    console.warn("[config-manager] Writing to .jsonc file - comments will not be preserved");
  }
  const tmpPath = `${configPath}.tmp`;
  const bakPath = `${configPath}.bak`;
  const content = `${JSON.stringify(config, null, 2)}
`;
  if (existsSync2(configPath)) {
    copyFileSync(configPath, bakPath);
  }
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, configPath);
}
async function addPluginToOpenCodeConfig() {
  const configPath = getExistingConfigPath();
  try {
    ensureOpenCodeConfigDir();
  } catch (err) {
    return {
      success: false,
      configPath,
      error: `Failed to create config directory: ${err}`
    };
  }
  try {
    const { config: parsedConfig, error } = parseConfig(configPath);
    if (error) {
      return {
        success: false,
        configPath,
        error: `Failed to parse config: ${error}`
      };
    }
    const config = parsedConfig ?? {};
    const plugins = getPlugins(config);
    const pluginEntry = getPluginEntry();
    const filteredPlugins = plugins.filter((plugin) => !isMatchingPluginEntry(plugin));
    filteredPlugins.push(pluginEntry);
    config.plugin = filteredPlugins;
    writeConfig(configPath, config);
    return { success: true, configPath };
  } catch (err) {
    return {
      success: false,
      configPath,
      error: `Failed to update opencode config: ${err}`
    };
  }
}
async function addPluginToOpenCodeTuiConfig() {
  const configPath = getExistingTuiConfigPath();
  try {
    ensureTuiConfigDir();
  } catch (err) {
    return {
      success: false,
      configPath,
      error: `Failed to create config directory: ${err}`
    };
  }
  try {
    const { config: parsedConfig, error } = parseConfig(configPath);
    if (error) {
      return {
        success: false,
        configPath,
        error: `Failed to parse TUI config: ${error}`
      };
    }
    const config = parsedConfig ?? {};
    const plugins = getPlugins(config);
    const pluginEntry = getPluginEntry();
    const filteredPlugins = plugins.filter((plugin) => !isMatchingPluginEntry(plugin));
    filteredPlugins.push(pluginEntry);
    config.plugin = filteredPlugins;
    writeConfig(configPath, config);
    return { success: true, configPath };
  } catch (err) {
    return {
      success: false,
      configPath,
      error: `Failed to update opencode TUI config: ${err}`
    };
  }
}
function writeLiteConfig(installConfig, targetPath) {
  const configPath = targetPath ?? getLiteConfig();
  try {
    ensureConfigDir();
    const config = generateLiteConfig(installConfig);
    const tmpPath = `${configPath}.tmp`;
    const bakPath = `${configPath}.bak`;
    const content = `${JSON.stringify(config, null, 2)}
`;
    if (existsSync2(configPath)) {
      copyFileSync(configPath, bakPath);
    }
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, configPath);
    return { success: true, configPath };
  } catch (err) {
    return {
      success: false,
      configPath,
      error: `Failed to write lite config: ${err}`
    };
  }
}
function disableDefaultAgents() {
  const configPath = getExistingConfigPath();
  try {
    ensureOpenCodeConfigDir();
    const { config: parsedConfig, error } = parseConfig(configPath);
    if (error) {
      return {
        success: false,
        configPath,
        error: `Failed to parse config: ${error}`
      };
    }
    const config = parsedConfig ?? {};
    const agent = config.agent ?? {};
    agent.explore = { disable: true };
    agent.general = { disable: true };
    config.agent = agent;
    writeConfig(configPath, config);
    return { success: true, configPath };
  } catch (err) {
    return {
      success: false,
      configPath,
      error: `Failed to disable default agents: ${err}`
    };
  }
}
function enableLspByDefault() {
  const configPath = getExistingConfigPath();
  try {
    ensureOpenCodeConfigDir();
    const { config: parsedConfig, error } = parseConfig(configPath);
    if (error) {
      return {
        success: false,
        configPath,
        error: `Failed to parse config: ${error}`
      };
    }
    const config = parsedConfig ?? {};
    if (config.lsp === undefined) {
      config.lsp = true;
      writeConfig(configPath, config);
    }
    return { success: true, configPath };
  } catch (err) {
    return {
      success: false,
      configPath,
      error: `Failed to enable LSP: ${err}`
    };
  }
}
function detectCurrentConfig() {
  const result = {
    isInstalled: false,
    hasKimi: false,
    hasOpenAI: false,
    hasAnthropic: false,
    hasCopilot: false,
    hasZaiPlan: false,
    hasAntigravity: false,
    hasChutes: false,
    hasOpencodeZen: false
  };
  const { config } = parseConfig(getExistingConfigPath());
  if (!config)
    return result;
  const plugins = getPluginEntries(config);
  result.isInstalled = plugins.some((p) => isPluginEntry(p));
  result.hasAntigravity = plugins.some((p) => p.startsWith("opencode-antigravity-auth"));
  const providers = config.provider;
  result.hasKimi = !!providers?.kimi;
  result.hasAnthropic = !!providers?.anthropic;
  result.hasCopilot = !!providers?.["github-copilot"];
  result.hasZaiPlan = !!providers?.["zai-coding-plan"];
  result.hasChutes = !!providers?.chutes;
  if (providers?.google)
    result.hasAntigravity = true;
  const { config: liteConfig } = parseConfig(getLiteConfig());
  if (liteConfig && typeof liteConfig === "object") {
    const configObj = liteConfig;
    const presetName = configObj.preset;
    const presets = configObj.presets;
    const agents = presets?.[presetName];
    if (agents) {
      const models = Object.values(agents).map((a) => a?.model).filter(Boolean);
      result.hasOpenAI = models.some((m) => m?.startsWith("openai/"));
      result.hasAnthropic = models.some((m) => m?.startsWith("anthropic/"));
      result.hasCopilot = models.some((m) => m?.startsWith("github-copilot/"));
      result.hasZaiPlan = models.some((m) => m?.startsWith("zai-coding-plan/"));
      result.hasOpencodeZen = models.some((m) => m?.startsWith("opencode/"));
      if (models.some((m) => m?.startsWith("google/"))) {
        result.hasAntigravity = true;
      }
      if (models.some((m) => m?.startsWith("chutes/"))) {
        result.hasChutes = true;
      }
    }
  }
  return result;
}
// src/cli/system.ts
import { spawnSync } from "node:child_process";
import { statSync as statSync2 } from "node:fs";

// src/utils/compat.ts
import { spawn as nodeSpawn } from "node:child_process";
var isBun = typeof globalThis.Bun !== "undefined";
function collectStream(stream) {
  if (!stream)
    return () => Promise.resolve("");
  const chunks = [];
  stream.on("data", (chunk) => chunks.push(chunk));
  return () => new Promise((resolve, reject) => {
    if (!stream.readable) {
      resolve(Buffer.concat(chunks).toString("utf-8"));
      return;
    }
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}
function crossSpawn(command, options) {
  const [cmd, ...args] = command;
  const proc = nodeSpawn(cmd, args, {
    stdio: [
      options?.stdin ?? "ignore",
      options?.stdout ?? "pipe",
      options?.stderr ?? "pipe"
    ],
    cwd: options?.cwd,
    env: options?.env
  });
  const stdoutCollector = collectStream(proc.stdout);
  const stderrCollector = collectStream(proc.stderr);
  const exited = new Promise((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
  return {
    proc,
    stdout: stdoutCollector,
    stderr: stderrCollector,
    exited,
    kill: (signal) => proc.kill(signal),
    get exitCode() {
      return proc.exitCode;
    }
  };
}

// src/cli/system.ts
var cachedOpenCodePath = null;
function resolvePathCommand(command) {
  try {
    const resolver = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(resolver, [command], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    if (result.status !== 0) {
      return null;
    }
    const resolved = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return resolved ?? null;
  } catch {
    return null;
  }
}
function canExecute(command, args) {
  try {
    const result = spawnSync(command, args, {
      stdio: "ignore"
    });
    return result.status === 0;
  } catch {
    return false;
  }
}
function getOpenCodePaths() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return [
    "opencode",
    `${home}/.local/bin/opencode`,
    `${home}/.opencode/bin/opencode`,
    `${home}/bin/opencode`,
    "/usr/local/bin/opencode",
    "/opt/opencode/bin/opencode",
    "/usr/bin/opencode",
    "/bin/opencode",
    "/Applications/OpenCode.app/Contents/MacOS/opencode",
    `${home}/Applications/OpenCode.app/Contents/MacOS/opencode`,
    "/opt/homebrew/bin/opencode",
    "/home/linuxbrew/.linuxbrew/bin/opencode",
    `${home}/homebrew/bin/opencode`,
    `${home}/Library/Application Support/opencode/bin/opencode`,
    "/snap/bin/opencode",
    "/var/snap/opencode/current/bin/opencode",
    "/var/lib/flatpak/exports/bin/ai.opencode.OpenCode",
    `${home}/.local/share/flatpak/exports/bin/ai.opencode.OpenCode`,
    "/nix/store/opencode/bin/opencode",
    `${home}/.nix-profile/bin/opencode`,
    "/run/current-system/sw/bin/opencode",
    `${home}/.cargo/bin/opencode`,
    `${home}/.npm-global/bin/opencode`,
    "/usr/local/lib/node_modules/opencode/bin/opencode",
    `${home}/.yarn/bin/opencode`,
    `${home}/.pnpm-global/bin/opencode`
  ];
}
function resolveOpenCodePath() {
  if (cachedOpenCodePath) {
    return cachedOpenCodePath;
  }
  const pathOpenCodePath = resolvePathCommand("opencode");
  if (pathOpenCodePath) {
    cachedOpenCodePath = pathOpenCodePath;
    return pathOpenCodePath;
  }
  const paths = getOpenCodePaths();
  for (const opencodePath of paths) {
    if (opencodePath === "opencode")
      continue;
    try {
      const stat = statSync2(opencodePath);
      if (stat.isFile()) {
        cachedOpenCodePath = opencodePath;
        return opencodePath;
      }
    } catch {}
  }
  return "opencode";
}
async function isOpenCodeInstalled() {
  const pathOpenCodePath = resolvePathCommand("opencode");
  if (pathOpenCodePath && canExecute(pathOpenCodePath, ["--version"])) {
    cachedOpenCodePath = pathOpenCodePath;
    return true;
  }
  const paths = getOpenCodePaths();
  for (const opencodePath of paths) {
    if (opencodePath === "opencode")
      continue;
    try {
      const proc = crossSpawn([opencodePath, "--version"], {
        stdout: "pipe",
        stderr: "pipe"
      });
      await proc.exited;
      if (proc.exitCode === 0) {
        cachedOpenCodePath = opencodePath;
        return true;
      }
    } catch {}
  }
  return false;
}
async function getOpenCodeVersion() {
  const opencodePath = resolveOpenCodePath();
  try {
    const proc = crossSpawn([opencodePath, "--version"], {
      stdout: "pipe",
      stderr: "pipe"
    });
    const outputPromise = proc.stdout();
    await proc.exited;
    if (proc.exitCode === 0) {
      return (await outputPromise).trim();
    }
  } catch {}
  return null;
}
function getOpenCodePath() {
  const path = resolveOpenCodePath();
  return path === "opencode" ? null : path;
}
// src/cli/install.ts
var GREEN = "\x1B[32m";
var BLUE = "\x1B[34m";
var YELLOW = "\x1B[33m";
var RED = "\x1B[31m";
var BOLD = "\x1B[1m";
var DIM = "\x1B[2m";
var RESET = "\x1B[0m";
var SYMBOLS = {
  check: `${GREEN}[ok]${RESET}`,
  cross: `${RED}[x]${RESET}`,
  arrow: `${BLUE}->${RESET}`,
  bullet: `${DIM}-${RESET}`,
  info: `${BLUE}[i]${RESET}`,
  warn: `${YELLOW}[!]${RESET}`,
  star: `${YELLOW}★${RESET}`
};
var GITHUB_REPO = "bakhtiar-personal-work/opencode-dux";
var GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
function printHeader(isUpdate) {
  console.log();
  console.log(`${BOLD}opencode-dux ${isUpdate ? "Update" : "Install"}${RESET}`);
  console.log("=".repeat(30));
  console.log();
}
function printStep(step, total, message) {
  console.log(`${DIM}[${step}/${total}]${RESET} ${message}`);
}
function printSuccess(message) {
  console.log(`${SYMBOLS.check} ${message}`);
}
function printError(message) {
  console.log(`${SYMBOLS.cross} ${RED}${message}${RESET}`);
}
function printInfo(message) {
  console.log(`${SYMBOLS.info} ${message}`);
}
async function confirm(message, defaultYes = true) {
  const suffix = defaultYes ? " (Y/n) " : " (y/N) ";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${message}${suffix}`)).trim().toLowerCase();
    if (!answer)
      return defaultYes;
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
async function askToStarRepo(config) {
  if (!config.promptForStar || config.dryRun || !process.stdin.isTTY)
    return;
  console.log();
  const shouldStar = await confirm(`${SYMBOLS.star} Star the repo on GitHub?`, true);
  if (!shouldStar)
    return;
  try {
    const { execFileSync } = await import("node:child_process");
    execFileSync("gh", ["api", "--silent", "--method", "PUT", `/user/starred/${GITHUB_REPO}`], { stdio: "ignore", timeout: 1e4 });
    printSuccess("Thanks for starring! ★");
  } catch {
    printInfo(`Couldn't star automatically. You can star manually:
  ${BLUE}${GITHUB_URL}${RESET}`);
  }
}
async function checkOpenCodeInstalled() {
  const installed = await isOpenCodeInstalled();
  if (!installed) {
    printError("OpenCode is not installed on this system.");
    printInfo("Install it with:");
    console.log(`     ${BLUE}curl -fsSL https://opencode.ai/install | bash${RESET}`);
    console.log();
    printInfo("Or if already installed, add it to your PATH:");
    console.log(`     ${BLUE}export PATH="$HOME/.local/bin:$PATH"${RESET}`);
    console.log(`     ${BLUE}export PATH="$HOME/.opencode/bin:$PATH"${RESET}`);
    return { ok: false };
  }
  const version = await getOpenCodeVersion();
  const path = getOpenCodePath();
  const detectedVersion = version ?? "";
  const pathInfo = path ? ` (${DIM}${path}${RESET})` : "";
  printSuccess(`OpenCode ${detectedVersion} detected${pathInfo}`);
  return { ok: true, version: version ?? undefined, path: path ?? undefined };
}
function handleStepResult(result, successMsg) {
  if (!result.success) {
    printError(`Failed: ${result.error}`);
    return false;
  }
  printSuccess(`${successMsg} ${SYMBOLS.arrow} ${DIM}${result.configPath}${RESET}`);
  return true;
}
async function runInstall(config) {
  const detected = detectCurrentConfig();
  const isUpdate = detected.isInstalled;
  printHeader(isUpdate);
  const totalSteps = 6;
  let step = 1;
  printStep(step++, totalSteps, "Checking OpenCode installation...");
  if (config.dryRun) {
    printInfo("Dry run mode - skipping OpenCode check");
  } else {
    const { ok } = await checkOpenCodeInstalled();
    if (!ok)
      return 1;
  }
  printStep(step++, totalSteps, "Adding opencode-dux plugin...");
  if (config.dryRun) {
    printInfo("Dry run mode - skipping plugin installation");
  } else {
    const pluginResult = await addPluginToOpenCodeConfig();
    if (!handleStepResult(pluginResult, "Plugin added"))
      return 1;
  }
  printStep(step++, totalSteps, "Adding TUI version badge...");
  if (config.dryRun) {
    printInfo("Dry run mode - skipping TUI plugin installation");
  } else {
    const tuiResult = await addPluginToOpenCodeTuiConfig();
    if (!tuiResult.success) {
      printInfo(`Skipped TUI badge: ${tuiResult.error}`);
    } else {
      handleStepResult(tuiResult, "TUI badge added");
    }
  }
  printStep(step++, totalSteps, "Disabling OpenCode default agents...");
  if (config.dryRun) {
    printInfo("Dry run mode - skipping agent disabling");
  } else {
    const agentResult = disableDefaultAgents();
    if (!handleStepResult(agentResult, "Default agents disabled"))
      return 1;
  }
  printStep(step++, totalSteps, "Enabling OpenCode LSP integration...");
  if (config.dryRun) {
    printInfo("Dry run mode - skipping LSP configuration");
  } else {
    const lspResult = enableLspByDefault();
    if (!handleStepResult(lspResult, "LSP enabled"))
      return 1;
  }
  printStep(step++, totalSteps, "Writing opencode-dux configuration...");
  if (config.dryRun) {
    const liteConfig = generateLiteConfig(config);
    printInfo("Dry run mode - configuration that would be written:");
    console.log(`
${JSON.stringify(liteConfig, null, 2)}
`);
  } else {
    const configPath2 = getExistingLiteConfigPath();
    const configExists = existsSync3(configPath2);
    if (configExists && !config.reset) {
      printInfo(`Configuration already exists at ${configPath2}. Use --reset to overwrite.`);
    } else {
      const liteResult = writeLiteConfig(config, configExists ? configPath2 : undefined);
      if (!handleStepResult(liteResult, configExists ? "Config reset" : "Config written"))
        return 1;
    }
  }
  const statusMsg = isUpdate ? "Configuration updated!" : "Installation complete!";
  console.log(`${SYMBOLS.star} ${BOLD}${GREEN}${statusMsg}${RESET}`);
  console.log();
  console.log(`${BOLD}Next steps:${RESET}`);
  console.log();
  const configPath = getExistingLiteConfigPath();
  console.log("  1. Log in to the provider(s) you want to use:");
  console.log(`     ${BLUE}$ opencode auth login${RESET}`);
  console.log();
  console.log("  2. Refresh the models OpenCode can see:");
  console.log(`     ${BLUE}$ opencode models --refresh${RESET}`);
  console.log();
  console.log("  3. Review your generated config:");
  console.log(`     ${BLUE}${configPath}${RESET}`);
  console.log();
  console.log("  4. Start OpenCode:");
  console.log(`     ${BLUE}$ opencode${RESET}`);
  console.log();
  console.log("  5. Verify the agents are responding:");
  console.log(`     ${BLUE}> ping all agents${RESET}`);
  console.log();
  const modelsInfo = config.preset && config.preset !== "openai" ? `Generated OpenAI and OpenCode Go presets; ${config.preset} is active.` : "Generated OpenAI and OpenCode Go presets; OpenAI is active by default.";
  console.log(`${modelsInfo}`);
  const altProviders = "For the full configuration reference, see:";
  console.log(altProviders);
  const docsUrl = "https://github.com/bakhtiar-personal-work/opencode-dux/blob/master/docs/configuration.md";
  console.log(`  ${BLUE}${docsUrl}${RESET}`);
  console.log();
  await askToStarRepo(config);
  return 0;
}
async function install(args) {
  const config = {
    installSkills: false,
    installCustomSkills: false,
    preset: args.preset,
    promptForStar: args.tui,
    dryRun: args.dryRun,
    reset: args.reset ?? false
  };
  return runInstall(config);
}

// src/cli/providers.ts
var GENERATED_PRESETS2 = ["openai", "opencode-go"];
function isGeneratedPresetName2(value) {
  return GENERATED_PRESETS2.includes(value);
}
function getGeneratedPresetNames2() {
  return [...GENERATED_PRESETS2];
}

// src/cli/index.ts
function parseArgs(args) {
  const result = {
    tui: true,
    skills: "yes"
  };
  for (const arg of args) {
    if (arg === "--no-tui") {
      result.tui = false;
    } else if (arg.startsWith("--skills=")) {
      result.skills = arg.split("=")[1];
    } else if (arg.startsWith("--preset=")) {
      const preset = arg.split("=")[1];
      if (!isGeneratedPresetName2(preset)) {
        console.error(`Unsupported preset: ${preset}. Available presets: ${getGeneratedPresetNames2().join(", ")}`);
        process.exit(1);
      }
      result.preset = preset;
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    } else if (arg === "--reset") {
      result.reset = true;
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
  }
  return result;
}
function printHelp() {
  console.log(`
opencode-dux installer

Usage: bunx opencode-dux install [OPTIONS]

Options:
  --skills=yes|no        Install recommended and bundled skills (default: yes)
  --preset=<name>        Active generated config preset (default: openai)
  --no-tui               Non-interactive mode
  --dry-run              Simulate install without writing files
  --reset                Force overwrite of existing configuration
  -h, --help             Show this help message

Available presets: ${getGeneratedPresetNames2().join(", ")}

The installer generates OpenAI and OpenCode Go presets by default.
OpenAI is active unless --preset selects another generated preset.
For the full config reference, see docs/configuration.md.

Examples:
  bunx opencode-dux install
  bunx opencode-dux install --no-tui --skills=yes
  bunx opencode-dux install --preset=opencode-go
  bunx opencode-dux install --reset
`);
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "install") {
    const hasSubcommand = args[0] === "install";
    const installArgs = parseArgs(args.slice(hasSubcommand ? 1 : 0));
    const exitCode = await install(installArgs);
    process.exit(exitCode);
  } else if (args[0] === "-h" || args[0] === "--help") {
    printHelp();
    process.exit(0);
  } else {
    console.error(`Unknown command: ${args[0]}`);
    console.error("Run with --help for usage information");
    process.exit(1);
  }
}
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
