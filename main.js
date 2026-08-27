"use strict";

/**
 * DeepSeek Harness Desktop —— Electron main process.
 *
 * 职责：
 *  1. 启动时先检测本机 Node / npm / DeepSeek Harness 托管运行槽，再决定是直接启动还是安装；
 *  2. 等待服务器就绪后，用毛玻璃半透明窗体加载本地 GUI（界面与 web 版完全一致）；
 *  3. 自绘标题栏（拖拽区 + 最小化/最大化/关闭 + 一键更新按钮）；
 *  4. 通过软件托管的 npm 安装槽（npmmirror，可回退 npmjs）安装、启动和更新 dsh。
 */

const { app, BrowserWindow, dialog, ipcMain, shell, nativeTheme } = require("electron");
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const { pathToFileURL } = require("node:url");

const APP_NAME = "DeepSeek Harness";
const SERVER_READY_TIMEOUT_MS = 60_000;
const DSH_INSTALL_READY_TIMEOUT_MS = 15 * 60_000;
const POLL_INTERVAL_MS = 300;
/** 更新源：优先环境变量 DSH_UPDATE_REGISTRY（可指向内网镜像），否则官方镜像 + npmjs 回退 */
const DEFAULT_REGISTRIES = [
  process.env.DSH_UPDATE_REGISTRY,
  "https://registry.npmmirror.com",
  "https://registry.npmjs.org",
].filter(Boolean);
/** 首次运行联网安装用的 Node 版本与国内镜像（npmmirror，失败回退官方源）。 */
const NODE_VERSION = "v24.14.1";
const NODE_DOWNLOAD_URLS = [
  process.env.DSH_NODE_MIRROR,
  `https://npmmirror.com/mirrors/node/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`,
  `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`,
].filter(Boolean);
const NODE_MSI_DOWNLOAD_URLS = [
  process.env.DSH_NODE_INSTALLER_MIRROR,
  `https://npmmirror.com/mirrors/node/${NODE_VERSION}/node-${NODE_VERSION}-x64.msi`,
  `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-x64.msi`,
].filter(Boolean);
const DSH_INSTALL_VERSION = "0.1.0-rc.7";
const DSH_MIN_RUNTIME_NODE_MAJOR = 24;

// ---------- 路径 ----------
const isDev = !app.isPackaged;
/** 运行时根目录：首次运行时可由用户选择安装位置；默认装在软件安装目录下（dev 用项目 runtime/） */
let RUNTIME_DIR = isDev ? path.join(__dirname, "runtime") : null;
const INTERNAL_DIR = isDev
  ? path.join(__dirname, "internal")
  : path.join(process.resourcesPath, "internal");

let NODE_EXE = null;
let NPM_CLI = null;
let DSH_RUNTIME_DIR = null;
let runtimeMode = "bundled";
let nativeRuntime = null;
let dshLaunchVersion = DSH_INSTALL_VERSION;
function setRuntimeDir(dir) {
  RUNTIME_DIR = dir;
  NODE_EXE = path.join(dir, "node.exe");
  NPM_CLI = path.join(dir, "node_modules", "npm", "bin", "npm-cli.js");
}
function hasHealthyNpmRuntime() {
  return fs.existsSync(NPM_CLI)
    && fs.existsSync(path.join(RUNTIME_DIR, "node_modules", "npm", "package.json"));
}
function hasHealthyAppRuntime() {
  return fs.existsSync(NODE_EXE) && hasHealthyNpmRuntime();
}
function setRuntimeMode(mode) {
  runtimeMode = mode === "native" || mode === "local-node" || mode === "global" ? mode : "bundled";
}
/** 默认运行时安装位置：软件安装目录下的 runtime/（开发模式用项目 runtime/）。 */
function defaultRuntimeDir() {
  if (isDev) return path.join(__dirname, "runtime");
  try {
    // app.getAppPath() = <安装目录>/resources/app.asar
    const installDir = path.dirname(path.dirname(app.getAppPath()));
    return path.join(installDir, "runtime");
  } catch {
    return path.join(app.getPath("userData"), "runtime");
  }
}
function globalRuntimeDir() {
  return path.join(app.getPath("userData"), "global-node");
}
function managedNpmCacheDir() {
  return path.join(app.getPath("userData"), "npm-cache");
}
function defaultManagedDshRuntimeDir() {
  return path.join(app.getPath("userData"), "dsh-runtime");
}
function setDshRuntimeDir(dir) {
  DSH_RUNTIME_DIR = dir ? path.resolve(dir) : null;
}
function managedDshRuntimeDir() {
  return DSH_RUNTIME_DIR || defaultManagedDshRuntimeDir();
}
function managedDshPackageDir(baseDir = managedDshRuntimeDir()) {
  return path.join(baseDir, "node_modules", "@deepseek-ai", "dsh");
}
function managedDshPackageJson(baseDir = managedDshRuntimeDir()) {
  return path.join(managedDshPackageDir(baseDir), "package.json");
}
function managedDshBinPath(baseDir = managedDshRuntimeDir()) {
  return path.join(managedDshPackageDir(baseDir), "lib", "bin.js");
}
function systemNodeDirectories() {
  return [
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "nodejs") : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "nodejs") : null,
  ].filter(Boolean);
}
function refreshSystemNodePath() {
  const current = String(process.env.PATH || "").split(path.delimiter);
  const additions = systemNodeDirectories().filter((dir) => fs.existsSync(path.join(dir, "node.exe")));
  process.env.PATH = [...additions, ...current.filter((entry) => !additions.includes(entry))].join(path.delimiter);
}
function normalizeNodeVersion(text) {
  const value = String(text ?? "").trim();
  const match = value.match(/(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:[-+][^\s]+)?(?:\s|$)/);
  if (!match) return null;
  return {
    raw: `v${match[1]}.${match[2]}.${match[3]}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}
function execVersion(exe, args) {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, shell: /\.(cmd|bat)$/i.test(exe) }, (error, stdout, stderr) => {
      if (error) {
        resolve(null);
        return;
      }
      const text = String(stdout || stderr || "");
      resolve(text.trim());
    });
  });
}
function firstLine(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "") ?? null;
}
function preferredWherePath(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.find((line) => /\.(cmd|exe|bat)$/i.test(line)) ?? null;
}
function readPackageVersion(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof data.version === "string" && data.version.trim() !== "" ? data.version.trim() : null;
  } catch {
    return null;
  }
}

function probeManagedDshRuntime(baseDir = managedDshRuntimeDir()) {
  const root = path.resolve(baseDir);
  const packageJson = managedDshPackageJson(root);
  const binPath = managedDshBinPath(root);
  const version = readPackageVersion(packageJson);
  const ready = !!version && fs.existsSync(binPath);
  return {
    root,
    ready,
    version,
    packageJson,
    binPath,
  };
}

async function probeNodeToolchain() {
  refreshSystemNodePath();
  const [nodePathText, npmPathText] = await Promise.all([
    execVersion("where.exe", ["node"]),
    execVersion("where.exe", ["npm"]),
  ]);
  const nodePath = preferredWherePath(nodePathText)
    || systemNodeDirectories().map((dir) => path.join(dir, "node.exe")).find((file) => fs.existsSync(file))
    || null;
  const npmPath = (nodePath && fs.existsSync(path.join(path.dirname(nodePath), "npm.cmd")) ? path.join(path.dirname(nodePath), "npm.cmd") : null)
    || preferredWherePath(npmPathText);
  const npmCliPath = nodePath
    ? path.join(path.dirname(nodePath), "node_modules", "npm", "bin", "npm-cli.js")
    : null;
  const hasNpmCli = !!npmCliPath && fs.existsSync(npmCliPath);
  const [nodeVersionText, npmVersionText, npmPrefixText, npmRootText, npmCacheText] = await Promise.all([
    nodePath ? execVersion(nodePath, ["--version"]) : Promise.resolve(null),
    hasNpmCli ? execVersion(nodePath, [npmCliPath, "--version"]) : npmPath ? execVersion(npmPath, ["--version"]) : Promise.resolve(null),
    hasNpmCli ? execVersion(nodePath, [npmCliPath, "prefix", "-g"]) : npmPath ? execVersion(npmPath, ["prefix", "-g"]) : Promise.resolve(null),
    hasNpmCli ? execVersion(nodePath, [npmCliPath, "root", "-g"]) : npmPath ? execVersion(npmPath, ["root", "-g"]) : Promise.resolve(null),
    hasNpmCli ? execVersion(nodePath, [npmCliPath, "config", "get", "cache"]) : npmPath ? execVersion(npmPath, ["config", "get", "cache"]) : Promise.resolve(null),
  ]);
  const node = normalizeNodeVersion(nodeVersionText);
  const npm = normalizeNodeVersion(npmVersionText);
  const npmPrefix = firstLine(npmPrefixText);
  const npmRoot = firstLine(npmRootText);
  const npmCache = firstLine(npmCacheText);
  const nodeOk = node !== null;
  const nodeCompatible = node !== null && node.major >= DSH_MIN_RUNTIME_NODE_MAJOR;
  const npmOk = npm !== null;
  return {
    node: node ? { ...node, ok: nodeOk, compatible: nodeCompatible } : null,
    nodePath,
    npm: npm ? { ...npm, ok: npmOk } : null,
    npmPath,
    npmCliPath: hasNpmCli ? npmCliPath : null,
    npmPrefix,
    npmRoot,
    npmCache,
    nodeCompatible,
    localNodeReady: nodeOk && nodeCompatible && npmOk,
  };
}

async function probePortableNodeToolchain() {
  const nodePath = NODE_EXE && fs.existsSync(NODE_EXE) ? NODE_EXE : null;
  const npmCliPath = NPM_CLI && fs.existsSync(NPM_CLI) ? NPM_CLI : null;
  const [nodeVersionText, npmVersionText] = await Promise.all([
    nodePath ? execVersion(nodePath, ["--version"]) : Promise.resolve(null),
    nodePath && npmCliPath ? execVersion(nodePath, [npmCliPath, "--version"]) : Promise.resolve(null),
  ]);
  const node = normalizeNodeVersion(nodeVersionText);
  const npm = normalizeNodeVersion(npmVersionText);
  const nodeOk = node !== null;
  const nodeCompatible = node !== null && node.major >= DSH_MIN_RUNTIME_NODE_MAJOR;
  const npmOk = npm !== null;
  return {
    node: node ? { ...node, ok: nodeOk, compatible: nodeCompatible } : null,
    nodePath,
    npm: npm ? { ...npm, ok: npmOk } : null,
    npmPath: null,
    npmCliPath,
    npmPrefix: RUNTIME_DIR,
    npmRoot: RUNTIME_DIR ? path.join(RUNTIME_DIR, "node_modules") : null,
    npmCache: managedNpmCacheDir(),
    nodeCompatible,
    localNodeReady: nodeOk && nodeCompatible && npmOk,
    portable: true,
  };
}

async function probeStartupNodeToolchain() {
  if (runtimeMode !== "global" && runtimeMode !== "native" && hasHealthyAppRuntime()) {
    const portableProbe = await probePortableNodeToolchain();
    if (portableProbe.localNodeReady) return portableProbe;
  }
  const systemProbe = await probeNodeToolchain();
  if (systemProbe.localNodeReady) return systemProbe;
  if (runtimeMode === "global" || runtimeMode === "native") return systemProbe;
  if (hasHealthyAppRuntime()) {
    const portableProbe = await probePortableNodeToolchain();
    if (portableProbe.localNodeReady) return portableProbe;
  }
  return systemProbe;
}

async function detectNativeRuntime() {
  const nodeProbe = await probeStartupNodeToolchain();
  return {
    ...nodeProbe,
    installed: nodeProbe.localNodeReady,
  };
}

async function probeNetworkSource() {
  let lastError = null;
  for (const registry of DEFAULT_REGISTRIES) {
    try {
      await fetchJson(`${registry}/@deepseek-ai/dsh/latest`, 4500);
      return { ok: true, registry };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    ok: false,
    registry: null,
    detail: lastError && lastError.message ? lastError.message : "无法连接下载源",
  };
}
/** Desktop-bundled damage monitor layer; mounted automatically for every web boot. */
const DAMAGE_PULSE_PATCH = path.join(INTERNAL_DIR, "damage-pulse", "cordis.patch.yml");
const DAMAGE_PULSE_MODULE = path.join(INTERNAL_DIR, "damage-pulse");

// ---------- 启动画面主题（跟随应用主题，持久化；首次运行跟随系统深浅色） ----------
const THEME_FILE = () => path.join(app.getPath("userData"), "theme.json");
const BOOT_FILE = () => path.join(app.getPath("userData"), "boot.json");
let splashTheme = "dark";
function loadSplashTheme() {
  try {
    const parsed = JSON.parse(fs.readFileSync(THEME_FILE(), "utf8"));
    if (parsed && (parsed.theme === "light" || parsed.theme === "dark")) {
      splashTheme = parsed.theme;
      return;
    }
  } catch { /* 首次运行 */ }
  splashTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
}
function saveSplashTheme(theme) {
  try {
    fs.mkdirSync(path.dirname(THEME_FILE()), { recursive: true });
    fs.writeFileSync(THEME_FILE(), `${JSON.stringify({ theme }, null, 2)}\n`);
  } catch { /* ignore */ }
}
function loadBootChoice() {
  try {
    const parsed = JSON.parse(fs.readFileSync(BOOT_FILE(), "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.mode !== "native" && parsed.mode !== "local-node" && parsed.mode !== "bundled" && parsed.mode !== "global") return null;
    return {
      mode: parsed.mode,
      runtimeDir: typeof parsed.runtimeDir === "string" && parsed.runtimeDir.trim() !== "" ? parsed.runtimeDir.trim() : null,
      dshRuntimeDir: typeof parsed.dshRuntimeDir === "string" && parsed.dshRuntimeDir.trim() !== "" ? parsed.dshRuntimeDir.trim() : null,
      dshVersion: typeof parsed.dshVersion === "string" && parsed.dshVersion.trim() !== "" ? parsed.dshVersion.trim() : null,
    };
  } catch {
    return null;
  }
}
function saveBootChoice(choice) {
  try {
    fs.mkdirSync(path.dirname(BOOT_FILE()), { recursive: true });
    fs.writeFileSync(BOOT_FILE(), `${JSON.stringify(choice, null, 2)}\n`);
  } catch { /* ignore */ }
}
function currentBootChoice(version = dshLaunchVersion) {
  const mode = runtimeMode;
  return {
    mode,
    runtimeDir: mode === "global" || mode === "native" ? null : RUNTIME_DIR,
    dshRuntimeDir: DSH_RUNTIME_DIR ? managedDshRuntimeDir() : null,
    dshVersion: version,
  };
}

function logsDir() {
  const dir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const SERVER_LOG = () => path.join(logsDir(), "server.log");

function log(line) {
  try {
    fs.appendFileSync(SERVER_LOG(), `${new Date().toISOString()} ${line}\n`);
  } catch { /* ignore */ }
}

// ---------- 桌面设置（settings.json：余额插件 / 小票 / 更新频道 / 已提示版本 / llama 启动器） ----------
const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json");
/** llama.cpp 启动器默认配置（llama-server.exe 本地模型服务，OpenAI 兼容接口）。 */
const DEFAULT_LLAMA_SETTINGS = {
  dir: "E:\\AI_llama\\llama-b10649-bin-win-cuda-13.3-x64", // llama.cpp 目录（需含 llama-server.exe）
  modelPath: "",     // 选中的 GGUF 主模型（绝对路径，空=未选择）
  mmprojPath: "",    // 视觉模型 mmproj（GGUF，空=不启用视觉能力）
  autoStart: false,  // 跟随软件启动（软件启动时自动拉起 llama-server）
  host: "127.0.0.1", // 监听地址
  port: 8080,        // 监听端口
  ctxSize: 4096,     // 上下文长度 -c
  gpuLayers: 999,    // GPU 卸载层数 -ngl（999=全部层，0=纯 CPU 不传该参数）
  threads: 0,        // 生成线程数 -t（0=自动，不传该参数）
  parallel: 1,       // 并行会话槽 -np
  apiKey: "",        // API Key（留空=不校验）
  extraArgs: "",     // 附加命令行参数（空格分隔，支持双引号包裹）
};
const DEFAULT_SETTINGS = {
  balancePlugin: true,    // 余额插件开关（默认打开）
  receiptEnabled: true,   // 小票功能开关（默认打开）
  updateChannel: "latest",// 版本列表频道：latest / next（默认 Latest）
  notifiedVersion: null,  // 已提示过的新版本号（每次新版本只提示一次）
  llama: { ...DEFAULT_LLAMA_SETTINGS }, // llama.cpp 启动器
};
/** 清洗/规范化 llama 配置（来自 settings.json 或渲染层补丁）。 */
function sanitizeLlamaSettings(raw) {
  const out = { ...DEFAULT_LLAMA_SETTINGS };
  if (!raw || typeof raw !== "object") return out;
  if (typeof raw.dir === "string") out.dir = raw.dir.trim();
  if (typeof raw.modelPath === "string") out.modelPath = raw.modelPath.trim();
  if (typeof raw.mmprojPath === "string") out.mmprojPath = raw.mmprojPath.trim();
  if (typeof raw.host === "string" && raw.host.trim() !== "") out.host = raw.host.trim();
  const clampInt = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(n)));
  };
  out.port = clampInt(raw.port, 1, 65535, DEFAULT_LLAMA_SETTINGS.port);
  out.ctxSize = clampInt(raw.ctxSize, 0, 10_000_000, DEFAULT_LLAMA_SETTINGS.ctxSize);
  out.gpuLayers = clampInt(raw.gpuLayers, 0, 999, DEFAULT_LLAMA_SETTINGS.gpuLayers);
  out.threads = clampInt(raw.threads, 0, 256, 0);
  out.parallel = clampInt(raw.parallel, 1, 256, 1);
  if (typeof raw.apiKey === "string") out.apiKey = raw.apiKey;
  if (typeof raw.extraArgs === "string") out.extraArgs = raw.extraArgs;
  if (typeof raw.autoStart === "boolean") out.autoStart = raw.autoStart;
  return out;
}
let appSettings = { ...DEFAULT_SETTINGS };
function loadAppSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8"));
    if (parsed && typeof parsed === "object") {
      appSettings = {
        ...DEFAULT_SETTINGS,
        ...(typeof parsed.balancePlugin === "boolean" ? { balancePlugin: parsed.balancePlugin } : {}),
        ...(typeof parsed.receiptEnabled === "boolean" ? { receiptEnabled: parsed.receiptEnabled } : {}),
        ...(parsed.updateChannel === "latest" || parsed.updateChannel === "next" ? { updateChannel: parsed.updateChannel } : {}),
        ...(typeof parsed.notifiedVersion === "string" && parsed.notifiedVersion.trim() !== "" ? { notifiedVersion: parsed.notifiedVersion } : {}),
        ...(parsed.llama !== undefined ? { llama: sanitizeLlamaSettings(parsed.llama) } : {}),
      };
    }
  } catch { /* 首次运行 */ }
}
function saveAppSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), `${JSON.stringify(appSettings, null, 2)}\n`);
  } catch { /* ignore */ }
}
function broadcastSettings() {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      if (!w.isDestroyed()) w.webContents.send("dsh:settings-changed", appSettings);
    } catch { /* ignore */ }
  }
}

// ---------- llama.cpp 启动器（llama-server.exe：本地模型 OpenAI 兼容服务） ----------
const LLAMA_LOG = () => path.join(logsDir(), "llama.log");
/** llama-server 运行状态：stopped / starting / running / error。 */
let llamaChild = null;
let llamaStatus = {
  state: "stopped",
  pid: null,
  port: null,
  endpoint: null,
  model: null,
  startedAt: null,
  error: null,
  lastLog: null,
};

function llamaLog(line) {
  try {
    fs.mkdirSync(logsDir(), { recursive: true });
    fs.appendFileSync(LLAMA_LOG(), `${new Date().toISOString()} ${line}\n`);
  } catch { /* ignore */ }
}

/** llama-server.exe 路径（目录未配置时返回 null）。 */
function llamaServerExePath() {
  const cfg = appSettings.llama;
  if (!cfg || typeof cfg.dir !== "string" || cfg.dir.trim() === "") return null;
  return path.join(cfg.dir.trim(), "llama-server.exe");
}

/** 扫描 llama.cpp 目录（models/ 子目录与根目录）下的 GGUF 模型。 */
function listLlamaModels() {
  const cfg = appSettings.llama;
  const out = [];
  const seen = new Set();
  if (!cfg || typeof cfg.dir !== "string" || cfg.dir.trim() === "") return out;
  for (const root of [path.join(cfg.dir, "models"), cfg.dir]) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.gguf$/i.test(entry.name)) continue;
      const full = path.join(root, entry.name);
      const key = path.resolve(full).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      let sizeMB = 0;
      let mtime = null;
      try {
        const stat = fs.statSync(full);
        sizeMB = Math.round((stat.size / 1048576) * 10) / 10;
        mtime = stat.mtimeMs;
      } catch { /* ignore */ }
      out.push({ name: entry.name, path: full, sizeMB, mtime });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function llamaPublicStatus() {
  return { ...llamaStatus };
}

function broadcastLlamaStatus() {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      if (!w.isDestroyed()) w.webContents.send("dsh:llama-status-changed", llamaPublicStatus());
    } catch { /* ignore */ }
  }
}

/** 依据配置构造 llama-server 命令行参数。 */
function llamaBuildArgs(cfg) {
  const args = ["-m", cfg.modelPath, "--host", cfg.host, "--port", String(cfg.port)];
  if (typeof cfg.mmprojPath === "string" && cfg.mmprojPath.trim() !== "") {
    args.push("--mmproj", cfg.mmprojPath.trim());
  }
  if (cfg.ctxSize > 0) args.push("-c", String(cfg.ctxSize));
  if (cfg.gpuLayers > 0) args.push("-ngl", String(cfg.gpuLayers));
  if (cfg.threads > 0) args.push("-t", String(cfg.threads));
  if (cfg.parallel > 1) args.push("-np", String(cfg.parallel));
  if (typeof cfg.apiKey === "string" && cfg.apiKey.trim() !== "") args.push("--api-key", cfg.apiKey.trim());
  if (typeof cfg.extraArgs === "string" && cfg.extraArgs.trim() !== "") {
    // 附加参数按空格拆分，双引号包裹的整体作为一个参数
    for (const piece of cfg.extraArgs.match(/"([^"]*)"|\S+/g) || []) {
      const clean = piece.replace(/^"|"$/g, "");
      if (clean !== "") args.push(clean);
    }
  }
  return args;
}

/** 启动 llama-server：spawn 子进程 + 轮询 /health 直到就绪（大模型加载可能耗时数分钟）。
 * onProgress(percent, stage)：可选进度回调，把真实阶段写入启动页进度条。 */
async function startLlamaServer(onProgress = null) {
  const cfg = appSettings.llama;
  if (llamaStatus.state === "running") return { ok: false, error: "llama-server 已在运行" };
  if (llamaStatus.state === "starting") return { ok: false, error: "llama-server 正在启动，请稍候" };
  if (!cfg) return { ok: false, error: "llama 配置未初始化" };

  const fail = (error) => {
    llamaStatus = { ...llamaStatus, state: "error", error };
    llamaLog(`start failed: ${error}`);
    broadcastLlamaStatus();
    return { ok: false, error };
  };

  const exe = llamaServerExePath();
  if (!exe || !fs.existsSync(exe)) {
    return fail(`未找到 llama-server.exe，请检查 llama.cpp 目录（当前：${cfg.dir || "未设置"}）`);
  }
  if (!cfg.modelPath || !fs.existsSync(cfg.modelPath)) {
    return fail("请先选择 GGUF 模型文件");
  }
  if (!(await isPortFree(cfg.port))) {
    return fail(`端口 ${cfg.port} 已被占用（可能 llama-server 已在运行）`);
  }

  const args = llamaBuildArgs(cfg);
  llamaLog(`start: "${exe}" ${args.join(" ")}`);
  if (onProgress) onProgress(10, "正在启动 llama 本地模型服务…");
  const child = spawn(exe, args, {
    cwd: cfg.dir,
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  llamaChild = child;
  llamaStatus = {
    state: "starting",
    pid: child.pid ?? null,
    port: cfg.port,
    endpoint: `http://${cfg.host}:${cfg.port}`,
    model: cfg.modelPath,
    startedAt: Date.now(),
    error: null,
    lastLog: null,
  };
  broadcastLlamaStatus();

  const receive = (chunk) => {
    for (const rawLine of chunk.toString().split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line === "") continue;
      llamaLog(line);
      llamaStatus.lastLog = line.slice(0, 300);
    }
  };
  child.stdout.on("data", receive);
  child.stderr.on("data", receive);
  child.on("exit", (code, signal) => {
    llamaLog(`llama-server exited code=${code} signal=${signal}`);
    if (llamaChild !== child) return; // 已被 stopLlamaServer 接管
    llamaChild = null;
    const abnormal = code !== 0 && code !== null;
    llamaStatus = {
      state: abnormal ? "error" : "stopped",
      pid: null,
      port: null,
      endpoint: null,
      model: null,
      startedAt: null,
      error: abnormal
        ? `llama-server 已退出（代码 ${code ?? signal ?? "unknown"}）${llamaStatus.lastLog ? `：${llamaStatus.lastLog}` : ""}`
        : llamaStatus.error,
      lastLog: llamaStatus.lastLog,
    };
    broadcastLlamaStatus();
  });

  // 轮询就绪：/health 返回 200（加载中为 503）；个别构建无 /health 时回退探测 /。
  // 大模型（如 27B IQ3_S，约 11GB）加载可能耗时数分钟，超时上限 15 分钟。
  // 进度按已等待时间缓慢推进（封顶 70%），就绪后 75%，随后交由 harness 启动流程接管进度条。
  const loadStart = Date.now();
  const deadline = loadStart + 15 * 60_000;
  while (Date.now() < deadline && llamaChild === child && child.exitCode === null) {
    if (await probeHttp(cfg.port, "/health") || await probeHttp(cfg.port, "/")) {
      llamaStatus = { ...llamaStatus, state: "running" };
      llamaLog(`llama-server ready at ${llamaStatus.endpoint}`);
      if (onProgress) onProgress(75, "llama 模型服务已就绪");
      broadcastLlamaStatus();
      return { ok: true };
    }
    if (onProgress) {
      const elapsedSec = Math.floor((Date.now() - loadStart) / 1000);
      const percent = Math.min(70, 15 + Math.floor(elapsedSec / 3));
      onProgress(percent, `正在加载本地模型…（${elapsedSec}s）`);
    }
    await delay(POLL_INTERVAL_MS * 2);
  }

  if (llamaChild === child && child.exitCode === null) {
    // 启动超时：结束进程树并报错
    stopLlamaServer();
    llamaStatus = { ...llamaStatus, state: "error", error: "llama-server 启动超时（15 分钟），请检查日志" };
    broadcastLlamaStatus();
    return { ok: false, error: llamaStatus.error };
  }
  // 进程在等待期间退出，exit 回调已更新状态
  return { ok: false, error: llamaStatus.error || "llama-server 启动失败" };
}

/** 停止 llama-server（连同子进程树）。 */
function stopLlamaServer() {
  const child = llamaChild;
  llamaChild = null;
  if (child) {
    const pid = child.pid;
    try { child.kill(); } catch { /* ignore */ }
    try {
      if (pid) execFile("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true }, () => {});
    } catch { /* ignore */ }
    llamaLog(`llama-server stopped (pid=${pid})`);
  }
  llamaStatus = {
    state: "stopped",
    pid: null,
    port: null,
    endpoint: null,
    model: null,
    startedAt: null,
    error: null,
    lastLog: llamaStatus.lastLog,
  };
  broadcastLlamaStatus();
  return { ok: true };
}

/** llama 跟随软件启动：在拉起 harness 服务之前先启动 llama-server，真实进度写入启动页进度条。
 *  失败不阻塞 harness 启动（仅记录日志）。 */
async function maybeStartLlamaBeforeHarness(win) {
  const cfg = appSettings.llama;
  if (!cfg || !cfg.autoStart || !cfg.modelPath) return;
  if (llamaStatus.state === "running" || llamaStatus.state === "starting") return;
  const exe = llamaServerExePath();
  if (!exe || !fs.existsSync(exe)) {
    log("llama auto-start skipped: llama-server.exe not found");
    return;
  }
  log("llama auto-start before harness boot");
  const onProgress = (percent, stage) => {
    try {
      if (win && !win.isDestroyed()) sendBoot(win, { page: "booting", stage, percent });
    } catch { /* ignore */ }
  };
  try {
    const result = await startLlamaServer(onProgress);
    if (!result.ok) log(`llama auto-start failed: ${result.error}`);
  } catch (err) {
    log(`llama auto-start error: ${err && err.message ? err.message : String(err)}`);
  }
}

// ---------- dsh 命令行（dsh.cmd + 用户 PATH） ----------
/** dsh 命令启动器目录：%APPDATA%\DeepSeek Harness\bin（与安装目录无关，稳定）。 */
function cliShimDir() {
  return path.join(app.getPath("userData"), "bin");
}
function cliShimPath() {
  return path.join(cliShimDir(), "dsh.cmd");
}
/** 与 buildDshWebLaunch 一致：优先本机 Node，其次捆绑 Node，最后交给 PATH。 */
function dshCliNodeExe() {
  const useNativeNode = (runtimeMode === "native" || runtimeMode === "global")
    && nativeRuntime && nativeRuntime.localNodeReady
    && nativeRuntime.nodePath && fs.existsSync(nativeRuntime.nodePath);
  if (useNativeNode) return nativeRuntime.nodePath;
  if (NODE_EXE && fs.existsSync(NODE_EXE)) return NODE_EXE;
  return "node";
}
/** 写入 dsh.cmd 启动器（调用捆绑/本机 node 执行 dsh 的 lib/bin.js）。 */
function writeDshCliShim() {
  try {
    const probe = probeManagedDshRuntime();
    if (!probe.ready || !probe.binPath) return false;
    const dir = cliShimDir();
    fs.mkdirSync(dir, { recursive: true });
    const nodeExe = dshCliNodeExe();
    const content = `@echo off\r\n"${nodeExe}" "${probe.binPath}" %*\r\n`;
    fs.writeFileSync(cliShimPath(), content, "utf8");
    log(`dsh cli shim written: ${cliShimPath()} (node=${nodeExe})`);
    return true;
  } catch (error) {
    log(`write dsh cli shim failed: ${error.message}`);
    return false;
  }
}
/**
 * 安装完成后把 dsh 加入用户 PATH（HKCU\Environment），并广播环境变更。
 * 幂等：已存在则跳过；失败不影响主流程。
 */
function ensureDshCliOnPath() {
  return new Promise((resolve) => {
    try {
      if (!writeDshCliShim()) {
        resolve(false);
        return;
      }
    } catch (error) {
      log(`dsh cli shim error: ${error.message}`);
      resolve(false);
      return;
    }
    const binDir = cliShimDir();
    const psFile = path.join(app.getPath("temp"), `dsh-cli-path-${Date.now()}.ps1`);
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$binDir = '${binDir.replace(/'/g, "''")}'`,
      "$key = 'HKCU:\\Environment'",
      "$p = (Get-ItemProperty -Path $key -Name Path -ErrorAction SilentlyContinue).Path",
      "if (-not $p) { $p = '' }",
      "$parts = @($p -split ';' | Where-Object { $_ -ne '' })",
      "$exists = $false",
      "foreach ($part in $parts) { if ($part.Trim() -ieq $binDir) { $exists = $true; break } }",
      "if (-not $exists) {",
      "  $parts += $binDir",
      "  Set-ItemProperty -Path $key -Name Path -Value ($parts -join ';') -Type ExpandString",
      "}",
      "try {",
      "  Add-Type -Namespace Win32 -Name NativeEnv -MemberDefinition '[DllImport(\"user32.dll\", SetLastError = true, CharSet = CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'",
      "  [Win32.NativeEnv]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, 'Environment', 0x0002, 5000, [ref]([UIntPtr]::Zero)) | Out-Null",
      "} catch { }",
      "Write-Output 'OK'",
    ].join("\r\n");
    try {
      fs.writeFileSync(psFile, script, "utf8");
    } catch (error) {
      log(`write dsh cli ps failed: ${error.message}`);
      resolve(false);
      return;
    }
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", psFile], { windowsHide: true }, (error) => {
      try { fs.rmSync(psFile, { force: true }); } catch { /* ignore */ }
      if (error) {
        log(`ensure dsh cli path failed: ${error.message}`);
        resolve(false);
        return;
      }
      log(`dsh cli path ensured: ${binDir}`);
      resolve(true);
    });
  });
}

// ---------- 版本 ----------
function bundledDshVersion() {
  const managed = probeManagedDshRuntime();
  return managed.version || dshLaunchVersion;
}

// ---------- 单一实例 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// ---------- 服务器子进程 ----------
let serverChild = null;
let pendingBootUrl = null;
let quitting = false;
/** 是否为主动停止（更新等场景），此时子进程退出不算事故 */
let serverStopping = false;
/** 本次启动期间服务器 stderr 的累计文本（用于诊断/自愈判断） */
let startupStderr = "";
const bootPayloadCache = new WeakMap();

// ---------- 版本安装（设置弹窗 → 启动页安装视图） ----------
/** 当前正在安装的版本（供启动页安装视图显示与取消）。 */
let pendingInstallVersion = null;
/** 用户是否请求取消本次安装。 */
let cancelInstallRequested = false;
/** 当前活跃的 npm 安装子进程（取消时结束其进程树）。 */
let activeInstallChild = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 结束当前正在进行的 npm 安装子进程（含子进程树）。 */
function killActiveInstall() {
  cancelInstallRequested = true;
  if (activeInstallChild) {
    const pid = activeInstallChild.pid;
    try { activeInstallChild.kill(); } catch { /* ignore */ }
    try {
      execFile("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true }, () => {});
    } catch { /* ignore */ }
  }
}

function killServerTree() {
  if (!serverChild) return;
  serverStopping = true;
  const pid = serverChild.pid;
  try { serverChild.kill(); } catch { /* ignore */ }
  serverChild = null;
  // Windows 下连带结束子进程树，避免残留 node 进程
  try {
    execFile("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true }, () => {});
  } catch { /* ignore */ }
}

/** 挑选端口：优先 3080，被占用则交给系统随机分配（--port 0）。 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, "127.0.0.1");
  });
}

// ---------- 启动画面（Boot Splash） ----------

/** 向窗口推送启动状态：{ installing?, stage, percent }。 */
function sendBoot(win, payload) {
  try {
    if (!win || win.isDestroyed()) return;
    bootPayloadCache.set(win, payload);
    win.webContents.send("dsh:boot-progress", payload);
  } catch { /* ignore */ }
}

/** 向窗口追加一条安装日志。 */
function sendBootLog(win, line) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send("dsh:boot-log", { line: String(line) });
  } catch { /* ignore */ }
}

function detectStep(label, state, detail = "") {
  return {
    label,
    state,
    detail,
  };
}

function nodeStepDetail(nodeProbe) {
  if (!nodeProbe || !nodeProbe.node) return "未检测到 Node";
  const pieces = [nodeProbe.node.raw];
  if (nodeProbe.npm) pieces.push(`npm ${nodeProbe.npm.raw}`);
  else pieces.push("未检测到 npm");
  if (!nodeProbe.nodeCompatible) pieces.push(`需要 Node.js ${DSH_MIN_RUNTIME_NODE_MAJOR}+`);
  return pieces.join(" · ");
}

function networkStepDetail(networkProbe) {
  if (!networkProbe) return "正在检查下载源";
  if (networkProbe.ok) {
    return `可连接 ${networkProbe.registry.replace(/^https?:\/\//i, "")}`;
  }
  return networkProbe.detail || "无法连接下载源";
}

function cacheStepDetail(cacheProbe) {
  if (!cacheProbe) return "正在检查 DeepSeek Harness 环境";
  if (cacheProbe.ready) {
    return cacheProbe.version ? `环境已就绪 · ${cacheProbe.version}` : "环境已就绪";
  }
  return "未检测到 DeepSeek Harness 环境";
}

function startupBranch(nativeRuntime) {
  return "global";
}

function installBranch(nativeRuntime) {
  return "global";
}

function installBranchTitle(mode) {
  if (mode === "local-node") return "将使用本机 Node 安装 DeepSeek Harness";
  return "将先下载 Node，再安装 DeepSeek Harness";
}

function readyStageText(mode) {
  if (mode === "native") return "本机环境已就绪，点击开始使用";
  if (mode === "global") return "运行环境已就绪，点击开始使用";
  if (mode === "local-node") return "安装完成，可以开始使用";
  return "安装完成，可以开始使用";
}

function nextPageAfterDetection(nativeRuntime) {
  return "install";
}

async function runStartupWizard(win) {
  if (!win || win.isDestroyed()) return;
  sendBoot(win, {
    page: "detect",
    stage: "正在检测环境…",
    detectComplete: false,
    native: null,
    network: null,
    defaultDir: RUNTIME_DIR,
    installMode: "bundled",
    steps: [
      detectStep("检测 Node.js 环境", "loading", "正在检查 Node.js、npm"),
      detectStep("检测 DeepSeek Harness 环境", "idle", "等待上一步完成"),
      detectStep("检测当前网络状态", "idle", "等待上一步完成"),
    ],
  });

  const nodeProbe = await probeNodeToolchain();
  if (!win || win.isDestroyed()) return;
  sendBoot(win, {
    page: "detect",
    stage: "正在检测 DeepSeek Harness 环境…",
    detectComplete: false,
    native: {
      ...nodeProbe,
      installed: false,
    },
    network: null,
    defaultDir: RUNTIME_DIR,
    installMode: startupBranch({ ...nodeProbe, dshCache: null, installed: false }),
    steps: [
      detectStep("检测 Node.js 环境", nodeProbe.localNodeReady ? "success" : "fail", nodeStepDetail(nodeProbe)),
      detectStep("检测 DeepSeek Harness 环境", "loading", "正在检查 DeepSeek Harness 环境"),
      detectStep("检测当前网络状态", "idle", "等待上一步完成"),
    ],
  });

  const dshProbe = probeManagedDshRuntime();
  if (!win || win.isDestroyed()) return;
  sendBoot(win, {
    page: "detect",
    stage: "正在检测当前网络状态…",
    detectComplete: false,
    native: {
      ...nodeProbe,
      dshCache: dshProbe,
      installed: false,
    },
    network: null,
    defaultDir: RUNTIME_DIR,
    installMode: startupBranch({ ...nodeProbe, dshCache: dshProbe, installed: false }),
    steps: [
      detectStep("检测 Node.js 环境", nodeProbe.localNodeReady ? "success" : "fail", nodeStepDetail(nodeProbe)),
      detectStep("检测 DeepSeek Harness 环境", dshProbe.ready ? "success" : "fail", cacheStepDetail(dshProbe)),
      detectStep("检测当前网络状态", "loading", "正在检查下载源"),
    ],
  });

  const networkProbe = await probeNetworkSource();
  if (!win || win.isDestroyed()) return;
  const nativeProbe = {
    ...nodeProbe,
    installed: nodeProbe.localNodeReady,
    dshCache: dshProbe,
  };
  const branch = startupBranch(nativeProbe);
  const readyToStart = nativeProbe.localNodeReady && dshProbe.ready;
  sendBoot(win, {
    page: "detect",
    stage: "检测完成",
    detectComplete: true,
    native: nativeProbe,
    network: networkProbe,
    defaultDir: RUNTIME_DIR,
    installMode: branch,
    nextPage: readyToStart ? "start" : "install",
    steps: [
      detectStep("检测 Node.js 环境", nativeProbe.localNodeReady ? "success" : "fail", nodeStepDetail(nativeProbe)),
      detectStep("检测 DeepSeek Harness 环境", dshProbe.ready ? "success" : "fail", cacheStepDetail(dshProbe)),
      detectStep("检测当前网络状态", networkProbe.ok ? "success" : "fail", networkStepDetail(networkProbe)),
    ],
  });
  return { nodeProbe, cacheProbe: dshProbe, dshProbe, networkProbe, nativeProbe };
}

/** 带进度与重定向跟随的 HTTP(S) 下载。 */
function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadFile(res.headers.location, dest, onProgress).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers["content-length"]) || 0;
      let received = 0;
      const file = fs.createWriteStream(dest);
      res.on("data", (chunk) => {
        received += chunk.length;
        file.write(chunk);
        if (total > 0) onProgress(received / total, received, total);
      });
      res.on("end", () => file.end());
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("下载超时")));
  });
}

/** 用系统 tar（Windows 自带 bsdtar）解压 zip。 */
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    execFile("tar", ["-xf", zipPath, "-C", destDir], { windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function runLoggedCommand(command, args, { cwd, shell = false, elevated = false, env = null, onLine, onChild } = {}) {
  return new Promise((resolve) => {
    const launch = elevated
      ? {
          command: "powershell.exe",
          args: [
            "-NoProfile",
            "-Command",
            `$process = Start-Process -FilePath '${String(command).replace(/'/g, "''")}' -ArgumentList @(${args.map((arg) => `'${String(arg).replace(/'/g, "''")}'`).join(",")}) -Verb RunAs -Wait -PassThru; exit $process.ExitCode`,
          ],
          shell: false,
        }
      : { command, args, shell };
    const child = spawn(launch.command, launch.args, {
      cwd: cwd || app.getPath("userData"),
      env: env ? { ...process.env, ...env } : process.env,
      windowsHide: true,
      shell: launch.shell,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (onChild) onChild(child);
    let tail = "";
    const receive = (chunk) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-6000);
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/\r/g, "").trim();
        if (line && onLine) onLine(line);
      }
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    child.on("error", () => resolve({ code: 1, tail }));
    child.on("close", (code) => resolve({ code: code ?? 1, tail }));
  });
}

function needsSystemElevation(prefix) {
  if (!prefix) return false;
  const normalized = path.resolve(prefix).toLowerCase();
  return systemNodeDirectories().some((dir) => normalized.startsWith(path.resolve(dir).toLowerCase()));
}

function nativeNodeEnv(nodeProbe = nativeRuntime) {
  const env = {
    DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED || "",
    npm_config_update_notifier: "false",
    npm_config_cache: managedNpmCacheDir(),
  };
  const pathParts = [];
  if (nodeProbe && nodeProbe.nodePath) pathParts.push(path.dirname(nodeProbe.nodePath));
  if (nodeProbe && nodeProbe.npmPrefix) pathParts.push(nodeProbe.npmPrefix);
  if (process.env.PATH) pathParts.push(process.env.PATH);
  env.PATH = pathParts.filter(Boolean).join(path.delimiter);
  if (nodeProbe && nodeProbe.npmPrefix) env.npm_config_prefix = nodeProbe.npmPrefix;
  return env;
}

async function installSystemNode(win) {
  const installerPath = path.join(app.getPath("temp"), `node-${NODE_VERSION}-x64.msi`);
  let lastError = null;
  sendBoot(win, { page: "installing", installing: true, stage: "正在下载 Node.js…", percent: 2 });
  for (const mirror of NODE_MSI_DOWNLOAD_URLS) {
    try {
      sendBootLog(win, `下载 Node.js：${mirror}`);
      await downloadFile(mirror, installerPath, (fraction) => {
        sendBoot(win, { page: "installing", installing: true, stage: "正在下载 Node.js…", percent: 2 + Math.round(fraction * 35) });
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      sendBootLog(win, `下载失败：${error.message}，尝试其他下载源`);
    }
  }
  if (lastError) return false;
  sendBoot(win, { page: "installing", installing: true, stage: "正在安装 Node.js…", percent: 40 });
  sendBootLog(win, "正在请求 Windows 授权安装 Node.js");
  const result = await runLoggedCommand("msiexec.exe", ["/i", installerPath, "/passive", "/norestart"], {
    elevated: true,
    onLine: (line) => sendBootLog(win, line),
  });
  try { fs.rmSync(installerPath, { force: true }); } catch { /* ignore */ }
  if (result.code !== 0 && result.code !== 3010) {
    sendBootLog(win, `Node.js 安装失败（退出码 ${result.code}）${result.tail ? `：${result.tail.slice(-500)}` : ""}`);
    return false;
  }
  refreshSystemNodePath();
  sendBootLog(win, "Node.js 安装完成");
  return true;
}

function npmInstallCommand(nodeProbe = nativeRuntime) {
  if (nodeProbe && nodeProbe.localNodeReady && nodeProbe.nodePath) {
    if (nodeProbe.npmCliPath && fs.existsSync(nodeProbe.npmCliPath)) {
      return {
        command: nodeProbe.nodePath,
        argsPrefix: [nodeProbe.npmCliPath],
        env: nativeNodeEnv(nodeProbe),
      };
    }
    if (nodeProbe.npmPath) {
      return {
        command: nodeProbe.npmPath,
        argsPrefix: [],
        env: nativeNodeEnv(nodeProbe),
        shell: /\.(cmd|bat)$/i.test(nodeProbe.npmPath),
      };
    }
  }
  if (hasHealthyAppRuntime()) {
    return {
      command: NODE_EXE,
      argsPrefix: [NPM_CLI],
      env: {
        ...process.env,
        PATH: [RUNTIME_DIR, process.env.PATH].filter(Boolean).join(path.delimiter),
        npm_config_update_notifier: "false",
        npm_config_cache: managedNpmCacheDir(),
      },
    };
  }
  return null;
}

function assertSafeManagedPath(target) {
  const resolved = path.resolve(target);
  const userData = path.resolve(app.getPath("userData"));
  const runtime = RUNTIME_DIR ? path.resolve(RUNTIME_DIR) : null;
  const allowed = resolved.toLowerCase().startsWith(userData.toLowerCase() + path.sep)
    || (runtime && resolved.toLowerCase().startsWith(runtime.toLowerCase() + path.sep));
  if (!allowed) throw new Error(`拒绝操作非托管目录：${resolved}`);
  return resolved;
}

async function installManagedDsh(
  win,
  {
    version = null,
    registry = null,
    baseDir = managedDshRuntimeDir(),
    keepBackup = false,
  } = {}
) {
  const npm = npmInstallCommand(nativeRuntime);
  if (!npm) {
    sendBootLog(win, "未检测到可用 npm，无法安装 DeepSeek Harness");
    return false;
  }

  // 未显式指定版本 → 安装官方最新版本（dist-tags 中 semver 最高者，如 0.1.0-rc.8），
  // 而不是固定在 0.1.0-rc.7；解析失败才回退到 latest 标签。
  if (!version) {
    const newest = await latestDshVersion();
    if (newest && newest.version) {
      version = newest.version;
      if (newest.registry) registry = newest.registry;
    } else {
      version = "latest";
    }
    sendBootLog(win, `将安装 DeepSeek Harness 最新版本：${version}`);
  }

  const target = assertSafeManagedPath(baseDir);
  const staging = assertSafeManagedPath(`${target}-staging`);
  const backup = assertSafeManagedPath(`${target}-backup-${Date.now()}`);
  const spec = `@deepseek-ai/dsh@${version || "latest"}`;
  let progress = 0;
  let stalled = false;
  let lastActivityAt = Date.now();
  let tail = "";
  let backupCreated = false;
  let creep = null;
  let stallTimer = null;

  const setStage = (stage, percent = progress) => {
    sendBoot(win, {
      page: "installing",
      installing: true,
      stage,
      percent,
      installMode: "global",
      detectComplete: true,
    });
  };

  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    setStage("正在安装 DeepSeek Harness…", 0);

    // 候选源：显式指定的 registry 优先，随后按 DEFAULT_REGISTRIES 顺序回退
    // （npmmirror 镜像对 rc 版本可能存在同步滞后，装不上时自动尝试 npmjs）
    const candidateRegistries = [...new Set(
      [registry || null, ...DEFAULT_REGISTRIES].filter(Boolean)
    )];

    creep = setInterval(() => {
      progress = Math.min(92, progress + 1);
      setStage(stalled ? "正在解析安装包，请耐心等待…" : "正在安装 DeepSeek Harness…", progress);
    }, 900);
    stallTimer = setInterval(() => {
      if (Date.now() - lastActivityAt >= 15_000 && !stalled) {
        stalled = true;
        setStage("正在解析安装包，请耐心等待…", progress);
      }
    }, 1000);

    let result = null;
    let installErrorTail = "";
    for (const reg of candidateRegistries) {
      if (cancelInstallRequested) break;
      sendBootLog(win, `npm install --prefix "${staging}" ${spec} --registry=${reg} --package-lock=false --prefer-offline`);
      const attemptArgs = [
        ...npm.argsPrefix,
        "install",
        "--prefix", staging,
        `--registry=${reg}`,
        "--loglevel=verbose",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        "--prefer-offline",
        spec,
      ];
      result = await runLoggedCommand(npm.command, attemptArgs, {
        cwd: app.getPath("userData"),
        shell: !!npm.shell,
        env: npm.env,
        onChild: (child) => { activeInstallChild = child; },
        onLine: (line) => {
          lastActivityAt = Date.now();
          if (stalled) {
            stalled = false;
            setStage("正在安装 DeepSeek Harness…", progress);
          }
          tail = (tail + line + "\n").slice(-6000);
          sendBootLog(win, line);
        },
      });
      activeInstallChild = null;
      if (cancelInstallRequested) break;
      if (result.code === 0) break;
      installErrorTail = result.tail || "";
      if (candidateRegistries.length > 1) {
        sendBootLog(win, `从 ${reg} 安装失败（退出码 ${result.code}），正在尝试其他下载源…`);
      }
    }

    clearInterval(creep);
    clearInterval(stallTimer);
    creep = null;
    stallTimer = null;

    if (cancelInstallRequested) {
      sendBootLog(win, "安装已取消");
      fs.rmSync(staging, { recursive: true, force: true });
      return false;
    }

    if (!result || result.code !== 0) {
      sendBootLog(win, `DeepSeek Harness 安装失败（退出码 ${result ? result.code : "unknown"}）${installErrorTail ? `：${installErrorTail.slice(-700)}` : ""}`);
      fs.rmSync(staging, { recursive: true, force: true });
      return false;
    }

    const probe = probeManagedDshRuntime(staging);
    if (!probe.ready) {
      sendBootLog(win, `DeepSeek Harness 安装校验失败：未找到 ${managedDshBinPath(staging)}`);
      fs.rmSync(staging, { recursive: true, force: true });
      return false;
    }

    if (cancelInstallRequested) {
      sendBootLog(win, "安装已取消");
      fs.rmSync(staging, { recursive: true, force: true });
      return false;
    }

    setStage("正在切换 DeepSeek Harness…", 96);
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup);
      backupCreated = true;
    }
    fs.renameSync(staging, target);
    if (backupCreated && !keepBackup) {
      try { fs.rmSync(backup, { recursive: true, force: true }); } catch (cleanupError) { log(`cleanup old managed dsh failed: ${cleanupError.message}`); }
    }

    const installed = probeManagedDshRuntime(target);
    dshLaunchVersion = installed.version || version || dshLaunchVersion;
    sendBootLog(win, `DeepSeek Harness 安装完成：${dshLaunchVersion}`);
    setStage("DeepSeek Harness 已就绪…", 100);
    return {
      ok: true,
      version: dshLaunchVersion,
      target,
      backup: backupCreated ? backup : null,
    };
  } catch (error) {
    if (creep) clearInterval(creep);
    if (stallTimer) clearInterval(stallTimer);
    const message = error instanceof Error ? error.message : String(error);
    sendBootLog(win, `DeepSeek Harness 安装异常：${message}${tail ? `\n${tail.slice(-700)}` : ""}`);
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* ignore */ }
    if (backupCreated && !fs.existsSync(target) && fs.existsSync(backup)) {
      try { fs.renameSync(backup, target); } catch (restoreError) { log(`restore managed dsh failed: ${restoreError.message}`); }
    }
    return false;
  }
}

function cleanupManagedDshBackup(installResult) {
  if (!installResult || !installResult.backup) return;
  try {
    const backup = assertSafeManagedPath(installResult.backup);
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    log(`cleanup managed dsh backup failed: ${error.message}`);
  }
}

function restoreManagedDshBackup(installResult) {
  if (!installResult || !installResult.backup || !installResult.target) return false;
  try {
    const target = assertSafeManagedPath(installResult.target);
    const backup = assertSafeManagedPath(installResult.backup);
    if (!fs.existsSync(backup)) return false;
    const failed = assertSafeManagedPath(`${target}-failed-${Date.now()}`);
    if (fs.existsSync(target)) fs.renameSync(target, failed);
    fs.renameSync(backup, target);
    try { fs.rmSync(failed, { recursive: true, force: true }); } catch (cleanupError) { log(`cleanup failed managed dsh failed: ${cleanupError.message}`); }
    return true;
  } catch (error) {
    log(`restore managed dsh backup failed: ${error.message}`);
    return false;
  }
}

async function ensurePortableRuntime(win) {
  if (hasHealthyAppRuntime()) return installManagedDsh(win);
  sendBoot(win, {
    page: "installing",
    installing: true,
    stage: "正在下载独立运行时…",
    percent: 1,
  });
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  try {
    // Node 自带 npm 已满足本应用需求。若 npm 文件不完整，重新解压整套 Node，
    // 不能让损坏的 npm 进程再覆盖自身，否则会永久卡在安装阶段。
    if (!fs.existsSync(NODE_EXE) || !hasHealthyNpmRuntime()) {
      if (fs.existsSync(NODE_EXE)) {
        sendBootLog(win, "检测到 npm 运行时不完整，正在重建 Node.js 环境");
      }
      const zipPath = path.join(RUNTIME_DIR, `node-${NODE_VERSION}-win-x64.zip`);
      let lastError = null;
      for (const mirror of NODE_DOWNLOAD_URLS) {
        try {
          sendBoot(win, { page: "installing", installing: true, stage: `正在下载 Node.js ${NODE_VERSION}…`, percent: 2 });
          const started = Date.now();
          let lastLogPct = -1;
          await downloadFile(mirror, zipPath, (fraction, received) => {
            const wholePct = Math.round(fraction * 100);
            sendBoot(win, { page: "installing", installing: true, stage: `正在下载 Node.js（${wholePct}%）…`, percent: 2 + Math.round(fraction * 36) });
            if (wholePct !== lastLogPct) {
              lastLogPct = wholePct;
              sendBootLog(win, `正在下载 Node.js ${NODE_VERSION} … ${Math.max(0, Math.round(received / 1e6))} MB（${wholePct}%）`);
            }
          });
          sendBootLog(win, `Node.js ${NODE_VERSION} 下载完成（${Math.round((Date.now() - started) / 1000)}s）`);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          sendBootLog(win, `下载源 ${mirror} 失败：${error.message}，尝试下一个…`);
        }
      }
      if (lastError !== null) throw lastError;
      sendBoot(win, { page: "installing", installing: true, stage: "正在解压 Node 运行时…", percent: 42 });
      await extractZip(zipPath, RUNTIME_DIR);
      const extractedDir = path.join(RUNTIME_DIR, `node-${NODE_VERSION}-win-x64`);
      if (fs.existsSync(extractedDir)) {
        for (const entry of fs.readdirSync(extractedDir)) {
          const from = path.join(extractedDir, entry);
          const to = path.join(RUNTIME_DIR, entry);
          if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
          fs.renameSync(from, to);
        }
        fs.rmdirSync(extractedDir);
      }
      fs.rmSync(zipPath, { force: true });
      sendBootLog(win, `Node.js 已就绪：${NODE_EXE}`);
    }
    if (!hasHealthyNpmRuntime()) throw new Error("Node.js 自带 npm 未能正确恢复");
    if (!(await installManagedDsh(win))) return false;
    sendBootLog(win, "运行时安装完成");
    return true;
  } catch (error) {
    sendBootLog(win, `运行时安装失败：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function ensureLocalNodeRuntime(win) {
  return ensurePortableRuntime(win);
}

async function ensureGlobalRuntime(win) {
  nativeRuntime = await detectNativeRuntime();
  setRuntimeMode("global");
  if (!nativeRuntime.localNodeReady) {
    const installed = await installSystemNode(win);
    if (!installed) return false;
    nativeRuntime = await detectNativeRuntime();
  }
  if (!nativeRuntime.localNodeReady) {
    sendBootLog(win, "Node.js 或 npm 未能正确安装");
    return false;
  }
  sendBoot(win, { page: "installing", installing: true, stage: "Node.js 环境已就绪…", percent: 0 });
  sendBootLog(win, "Node.js、npm 已就绪");
  return installManagedDsh(win);
}

async function ensureRuntime(win) {
  if (runtimeMode === "native") return true;
  if (runtimeMode === "global") return ensureGlobalRuntime(win);
  if (runtimeMode === "local-node") return ensureLocalNodeRuntime(win);
  return ensurePortableRuntime(win);
}

async function installAndBoot(win, mode) {
  setRuntimeMode(mode);
  const ok = await ensureRuntime(win);
  if (!ok) return false;
  // 首次安装流程：跳过 llama 跟随启动阶段（安装页处于 installing 视图，避免页面切换冲突）
  await bootServer(win, { skipLlama: true });
  return true;
}

function probeHttp(port, pathname = "/") {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname, timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

/**
 * DSH resolves profile loaders from its managed fallback directory. Keep the
 * desktop-owned bundle there so the user never has to install a plugin.
 */
function syncBundledDamagePulse() {
  const dshHome = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ""
    ? path.resolve(process.env.DSH_HOME)
    : path.join(os.homedir(), ".dsh");
  const target = path.join(dshHome, "profiles", "node_modules", "dsh-damage-pulse");
  if (!fs.existsSync(DAMAGE_PULSE_MODULE)) {
    throw new Error(`内置 damage-pulse bundle 缺失：${DAMAGE_PULSE_MODULE}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(DAMAGE_PULSE_MODULE, target, { recursive: true, force: true });
  log(`bundled damage-pulse synced to ${target}`);
}

function buildDshWebLaunch() {
  const useNativeNode = (runtimeMode === "native" || runtimeMode === "global")
    && nativeRuntime
    && nativeRuntime.localNodeReady
    && nativeRuntime.nodePath
    && fs.existsSync(nativeRuntime.nodePath);
  const command = useNativeNode ? nativeRuntime.nodePath : NODE_EXE;
  const cwd = app.getPath("userData");
  const dshProbe = probeManagedDshRuntime();
  if (!dshProbe.ready) {
    throw new Error("DeepSeek Harness 托管运行槽未就绪，请先安装");
  }
  const env = {
    ...process.env,
    DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED || "",
    npm_config_update_notifier: "false",
  };
  if (useNativeNode) {
    const pathParts = [];
    const nodeDir = path.dirname(nativeRuntime.nodePath);
    if (nodeDir) pathParts.push(nodeDir);
    if (nativeRuntime.npmPrefix) pathParts.push(nativeRuntime.npmPrefix);
    if (process.env.PATH) pathParts.push(process.env.PATH);
    env.PATH = pathParts.filter(Boolean).join(path.delimiter);
    if (nativeRuntime.npmPrefix) env.npm_config_prefix = nativeRuntime.npmPrefix;
  }
  return {
    command,
    args: [
      dshProbe.binPath,
      "web",
      "--patch", DAMAGE_PULSE_PATCH,
      "--port", "0",
      // 桌面版自带界面，不需要 dsh web 再拉起系统默认浏览器
      "--no-open",
    ],
    cwd,
    env,
  };
}

/** 启动 dsh web 服务器；返回其监听端口。 */
async function startServer(win, options = {}) {
  const { verbose = false, readyBeforeLoad = false } = options;
  sendBoot(win, {
    page: verbose ? "installing" : "booting",
    installing: verbose,
    stage: verbose
      ? "正在全局安装 DeepSeek Harness…"
      : (runtimeMode === "native"
        ? "正在启动本机环境中的 DeepSeek Harness 服务…"
        : runtimeMode === "local-node"
          ? "正在启动本机 Node 环境中的 DeepSeek Harness 服务…"
          : "正在启动 DeepSeek Harness 服务…"),
    percent: verbose ? 0 : 93,
  });
  syncBundledDamagePulse();
  const logPath = SERVER_LOG();
  let launch;
  try {
    launch = buildDshWebLaunch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendBootLog(win, message);
    sendBoot(win, {
      page: "location",
      installing: false,
      stage: "请先安装 DeepSeek Harness",
      percent: 0,
      native: nativeRuntime,
      detectComplete: true,
      installMode: "global",
    });
    return null;
  }
  const statusPage = verbose ? "installing" : "booting";
  const uiFlow = verbose || readyBeforeLoad;
  log(`starting server: ${launch.command} ${launch.args.join(" ")}`);
  if (verbose) sendBootLog(win, `node "${launch.args[0]}" web`);
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  serverChild = child;
  serverStopping = false;
  startupStderr = "";

  let port = null;
  const urlLine = /(?:dsh web: )?https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/i;
  let stalled = false;
  let verboseProgress = 0;
  const startedAt = Date.now();
  const launchStage = verbose
    ? "正在全局安装 DeepSeek Harness…"
    : (runtimeMode === "native"
      ? "正在启动本机环境中的 DeepSeek Harness 服务…"
      : runtimeMode === "local-node"
        ? "正在启动本机 Node 环境中的 DeepSeek Harness 服务…"
        : "正在启动 DeepSeek Harness 服务…");
  let currentStage = launchStage;
  let lastActivityAt = Date.now();
  const verboseProgressTimer = verbose ? setInterval(() => {
    verboseProgress = Math.min(92, verboseProgress + 1);
    sendBoot(win, { page: "installing", installing: true, stage: currentStage, percent: verboseProgress });
  }, 900) : null;
  const markActive = () => {
    lastActivityAt = Date.now();
    if (stalled && !verbose) {
      stalled = false;
      currentStage = launchStage;
      sendBoot(win, { page: statusPage, installing: verbose, stage: currentStage, percent: verbose ? verboseProgress : 93 });
    }
  };
  const stallTimer = setInterval(() => {
    if (port !== null || child.exitCode !== null) return;
    const stalledMs = verbose ? Date.now() - startedAt : Date.now() - lastActivityAt;
    if (stalledMs >= 15_000 && !stalled) {
      stalled = true;
      currentStage = verbose ? "正在解析安装包，请耐心等待…" : "正在解析安装包，请耐心等待…";
      sendBoot(win, { page: statusPage, installing: verbose, stage: currentStage, percent: verbose ? verboseProgress : 93 });
    }
  }, 1000);
  const stopStallTimer = () => {
    try { clearInterval(stallTimer); } catch { /* ignore */ }
    try { if (verboseProgressTimer) clearInterval(verboseProgressTimer); } catch { /* ignore */ }
  };
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    markActive();
    log(`[server] ${text.trim()}`);
    if (verbose) {
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/\r/g, "").trim();
        if (line) sendBootLog(win, line);
      }
    }
    const m = text.match(urlLine);
    if (m && port === null) port = Number(m[1]);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    markActive();
    startupStderr = (startupStderr + text).slice(-8000);
    log(`[server:err] ${text.trim()}`);
    if (verbose) {
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/\r/g, "").trim();
        if (line) sendBootLog(win, line);
      }
    }
  });
  child.on("exit", (code, signal) => {
    stopStallTimer();
    log(`server exited code=${code} signal=${signal} quitting=${quitting} stopping=${serverStopping}`);
    if (!quitting && !serverStopping) {
      if (uiFlow) {
        sendBootLog(win, `DeepSeek Harness 启动失败（退出码 ${code ?? "unknown"}）`);
        sendBoot(win, {
          page: "installing",
          installing: false,
          installError: true,
          stage: "启动失败，请检查日志后重试",
          percent: verboseProgress,
          installMode: "global",
        });
        return;
      }
      dialog.showErrorBox(
        APP_NAME,
        `DeepSeek Harness 服务器意外退出（代码 ${code}）。\n日志：${logPath}`
      );
      app.quit();
    }
  });

  // 等待就绪：优先解析 stdout 端口，再轮询 HTTP 200
  const deadline = Date.now() + (verbose ? DSH_INSTALL_READY_TIMEOUT_MS : SERVER_READY_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (port !== null) {
      const ok = await probeHttp(port);
      if (ok) {
        stopStallTimer();
        sendBoot(win, { page: statusPage, installing: verbose, stage: verbose ? "全局安装完成，正在加载界面…" : "服务已就绪，正在加载界面…", percent: 100 });
        return port;
      }
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  // 启动失败：先清理子进程
  stopStallTimer();
  if (uiFlow) {
    serverStopping = true;
    killServerTree();
    const reason =
      port === null
        ? `${verbose ? "安装" : "启动"}超时，未能获得监听端口。`
        : `服务就绪超时（http://127.0.0.1:${port} 无响应）。`;
    sendBootLog(win, reason);
    sendBoot(win, {
      page: "installing",
      installing: false,
      installError: true,
      stage: "启动失败，请检查日志后重试",
      percent: verboseProgress,
      installMode: "global",
    });
    return null;
  }
  quitting = true;
  killServerTree();

  // 常见可自愈错误：DSH 安装回退目录被外部工具改成真实目录
  // （官方 CLI 遇到同样错误会提示手动删除；这里提供一键自动修复）
  const symlinkErr = startupStderr.match(/dsh: (.+?) exists and is not a symlink/);
  if (symlinkErr) {
    const badPath = symlinkErr[1];
    const choice = dialog.showMessageBoxSync({
      type: "question",
      title: APP_NAME,
      message: "检测到 DSH 配置目录异常，可一键修复",
      detail:
        `DSH 的安装回退目录（$DSH_HOME/profiles/node_modules）中：\n${badPath}\n` +
        `被外部工具修改成了普通文件夹，导致服务器无法启动。\n` +
        `点击"自动修复"将删除该异常条目并重启服务器（该目录由 DSH 自动维护，可安全重建）。`,
      buttons: ["自动修复", "取消"],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0 && repairFallbackEntry(badPath)) {
      log("fallback repaired, restarting server");
      quitting = false;
      const repairedPort = await startServer(win);
      if (repairedPort !== null) return repairedPort;
      quitting = true;
      killServerTree();
    }
  }

  const reason =
    port === null
      ? "服务器启动超时，未能获得监听端口。"
      : `服务器就绪超时（http://127.0.0.1:${port} 无响应）。`;
  dialog.showErrorBox(APP_NAME, `${reason}\n日志：${logPath}`);
  app.exit(1);
  return null;
}

/** 自动修复 DSH 安装回退目录中被改成普通文件夹的条目（仅限 $DSH_HOME/profiles/node_modules 之内）。 */
function repairFallbackEntry(badPath) {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ""
    ? path.resolve(process.env.DSH_HOME)
    : path.join(os.homedir(), ".dsh");
  const modulesRoot = path.resolve(path.join(home, "profiles", "node_modules"));
  const target = path.resolve(badPath);
  const prefix = modulesRoot.toLowerCase() + path.sep;
  if (!target.toLowerCase().startsWith(prefix)) {
    log(`repair refused: ${target} outside ${modulesRoot}`);
    return false;
  }
  try {
    fs.rmSync(target, { recursive: true, force: true });
    log(`repair: removed ${target}`);
    return true;
  } catch (err) {
    log(`repair failed: ${err.message}`);
    return false;
  }
}

// ---------- 更新 ----------
let updating = false;

function compareVersions(a, b) {
  // 尝试使用运行时自带的 semver；失败则退回简易比较
  try {
    const semver = require(path.join(RUNTIME_DIR, "node_modules", "semver"));
    return semver.compare(a, b);
  } catch {
    const parse = (v) => {
      const m = String(v).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
      if (!m) return [0, 0, 0, ""];
      return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] || ""];
    };
    const [ma, pa, ra, prea] = parse(a);
    const [mb, pb, rb, preb] = parse(b);
    for (const [x, y] of [[ma, mb], [pa, pb], [ra, rb]]) {
      if (x !== y) return x > y ? 1 : -1;
    }
    if (prea === preb) return 0;
    if (prea === "") return 1;
    if (preb === "") return -1;
    return prea < preb ? -1 : 1;
  }
}

async function fetchJson(url, timeoutMs = 10_000, accept = "application/json") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 查询官方最新版本（按 registry 顺序回退）。
 * 不能只看 `latest` dist-tag：官方把 rc 版本发布在 `next` 标签下
 * （如 latest=0.1.0-rc.7 而 next=0.1.0-rc.8），因此取全部 dist-tags
 * 与已发布版本中 semver 最高的那个作为"最新版本"。
 */
async function latestDshVersion() {
  for (const registry of DEFAULT_REGISTRIES) {
    try {
      const data = await fetchJson(
        `${registry}/@deepseek-ai/dsh`,
        8000,
        "application/vnd.npm.install-v1+json"
      );
      if (data && typeof data === "object") {
        const candidates = new Set();
        if (data["dist-tags"] && typeof data["dist-tags"] === "object") {
          for (const tag of Object.values(data["dist-tags"])) {
            if (typeof tag === "string" && tag.trim() !== "") candidates.add(tag.trim());
          }
        }
        if (data.versions && typeof data.versions === "object") {
          for (const version of Object.keys(data.versions)) {
            if (version.trim() !== "") candidates.add(version.trim());
          }
        }
        let best = null;
        for (const candidate of candidates) {
          if (!best || compareVersions(candidate, best) > 0) best = candidate;
        }
        if (best) return { version: best, registry };
      }
    } catch (err) {
      log(`registry ${registry} packument failed: ${err.message}`);
    }
    try {
      const latest = await fetchJson(`${registry}/@deepseek-ai/dsh/latest`, 4500);
      if (latest && typeof latest.version === "string") return { version: latest.version, registry };
    } catch (err) {
      log(`registry ${registry} latest failed: ${err.message}`);
    }
  }
  return null;
}

/** 向窗口安全发送状态（窗口可能已销毁）。 */
function sendStatus(win, payload) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send("dsh:update-status", payload);
  } catch { /* ignore */ }
}

/** 向窗口发送更新弹窗事件（自绘弹窗，非原生）。 */
function sendEvent(win, payload) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send("dsh:update-event", payload);
  } catch { /* ignore */ }
}

/** 等待用户在更新弹窗中的操作；窗口关闭时返回 "cancel"。 */
function waitForUpdateAction(win) {
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      ipcMain.removeListener("dsh:update-action", onAction);
      if (!win.isDestroyed()) win.removeListener("closed", onClosed);
    };
    const done = (action) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(action);
    };
    const onAction = (event, action) => {
      if (BrowserWindow.fromWebContents(event.sender) !== win) return;
      done(typeof action === "string" ? action : "cancel");
    };
    const onClosed = () => done("cancel");
    ipcMain.on("dsh:update-action", onAction);
    if (!win.isDestroyed()) win.once("closed", onClosed);
  });
}

/** 等待页面（重新）加载后 preload 上报就绪，避免事件比监听器先到。 */
function waitForRendererReady(win) {
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      ipcMain.removeListener("dsh:renderer-ready", onReady);
      if (!win.isDestroyed()) win.removeListener("closed", onClosed);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onReady = (event) => {
      if (BrowserWindow.fromWebContents(event.sender) !== win) return;
      done();
    };
    const onClosed = () => done();
    ipcMain.on("dsh:renderer-ready", onReady);
    if (!win.isDestroyed()) win.once("closed", onClosed);
  });
}

/** 尽力拉取更新说明：优先 GitHub Releases 更新日志，其次 npm 包 README 简介片段（拿不到返回 null）。 */
async function fetchChangelog() {
  // 1) GitHub Releases 更新日志
  try {
    const data = await fetchJson(
      "https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/latest",
      8000
    );
    if (data && typeof data.tag_name === "string" && typeof data.body === "string" && data.body.trim() !== "") {
      return { source: "GitHub Releases", tag: data.tag_name, body: data.body.slice(0, 1600) };
    }
  } catch (err) {
    log(`changelog(github) failed: ${err.message}`);
  }
  // 2) npm 包 README 简介（截取正文片段）
  for (const registry of DEFAULT_REGISTRIES) {
    try {
      const data = await fetchJson(`${registry}/@deepseek-ai/dsh`, 8000);
      if (data && typeof data.readme === "string" && data.readme.trim() !== "") {
        const text = data.readme
          .replace(/```[a-z]*/gi, "")
          .replace(/[#>*_`-]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (text.length > 0) return { source: "npm 包简介", tag: `v${data["dist-tags"]?.latest ?? ""}`.trim(), body: text.slice(0, 700) };
      }
    } catch (err) {
      log(`changelog(npm) failed: ${err.message}`);
    }
  }
  return null;
}

/** 拉取 dsh 在 npm 上的全部已发布版本（按 semver 降序）与 dist-tags。 */
async function listDshVersions() {
  for (const registry of DEFAULT_REGISTRIES) {
    try {
      const data = await fetchJson(
        `${registry}/@deepseek-ai/dsh`,
        10_000,
        "application/vnd.npm.install-v1+json"
      );
      if (data && typeof data === "object" && data.versions && typeof data.versions === "object") {
        const versions = Object.keys(data.versions)
          .filter((v) => v && v.trim() !== "")
          .sort((a, b) => compareVersions(b, a));
        return {
          registry,
          distTags: data["dist-tags"] && typeof data["dist-tags"] === "object" ? data["dist-tags"] : {},
          versions,
        };
      }
    } catch (err) {
      log(`list versions registry ${registry} failed: ${err.message}`);
    }
    try {
      const data = await fetchJson(`${registry}/@deepseek-ai/dsh`, 10_000);
      if (data && typeof data === "object" && data.versions && typeof data.versions === "object") {
        const versions = Object.keys(data.versions)
          .filter((v) => v && v.trim() !== "")
          .sort((a, b) => compareVersions(b, a));
        return {
          registry,
          distTags: data["dist-tags"] && typeof data["dist-tags"] === "object" ? data["dist-tags"] : {},
          versions,
        };
      }
    } catch (err) {
      log(`list versions registry ${registry} failed: ${err.message}`);
    }
  }
  return null;
}

/** 探测能提供指定版本 dsh 的 registry（镜像对 rc 版本可能存在同步滞后，装不上时按序回退）。 */
async function resolveRegistryForVersion(version) {
  for (const registry of DEFAULT_REGISTRIES) {
    try {
      const data = await fetchJson(
        `${registry}/@deepseek-ai/dsh`,
        8000,
        "application/vnd.npm.install-v1+json"
      );
      if (data && data.versions && typeof data.versions === "object" && data.versions[version]) {
        log(`resolve registry for ${version}: ${registry}`);
        return registry;
      }
    } catch (err) {
      log(`resolve registry ${registry} for ${version} failed: ${err.message}`);
    }
  }
  return DEFAULT_REGISTRIES[0] || null;
}

/**
 * 静默检查更新（监控 Next 频道：取全部 dist-tags 与版本中 semver 最高者）。
 * 发现新版本时通过设置弹窗内的更新提示通知一次（notifiedVersion 持久化，每个版本只提示一次）。
 */
async function autoCheckUpdates(win) {
  const current = bundledDshVersion();
  sendStatus(win, { state: "checking", current });
  const latest = await latestDshVersion();
  log(`auto update check: current=${current} latest=${latest ? latest.version : "N/A"}`);
  if (!latest) {
    sendStatus(win, { state: "idle", current });
    sendEvent(win, {
      type: "no-update",
      current,
      detail: "无法连接到更新源（registry.npmmirror.com / registry.npmjs.org），请检查网络。",
    });
    return;
  }
  if (compareVersions(latest.version, current) > 0) {
    sendStatus(win, { state: "available", current, latest: latest.version });
    if (appSettings.notifiedVersion !== latest.version) {
      appSettings.notifiedVersion = latest.version;
      saveAppSettings();
      sendEvent(win, { type: "notice", current, latest: latest.version });
    }
  } else {
    sendStatus(win, { state: "idle", current });
    sendEvent(win, { type: "no-update", current, latest: latest.version });
  }
}

/**
 * 按用户选择的具体版本号安装（设置弹窗驱动）。
 * 成功：切换到新版本并告知渲染层重载页面；失败：回滚旧版本并告知失败。
 */
/**
 * 安装指定版本：先切换到本地启动页的"安装视图"（真实进度条 + 日志 + 取消按钮），
 * 在安装视图内完成下载/安装/替换，完成后自动返回软件主界面；取消/失败则恢复旧版本并返回。
 */
async function installVersionWithSplash(win, version) {
  if (updating || !win || win.isDestroyed()) return;
  updating = true;
  cancelInstallRequested = false;
  activeInstallChild = null;
  try {
    const current = bundledDshVersion();
    pendingInstallVersion = version;

    // 1) 先切到本地启动页安装视图（不依赖服务器），再开始安装
    const splashUrl = pathToFileURL(path.join(__dirname, "assets", "splash.html")).href;
    bootPayloadCache.delete(win);
    win.loadURL(splashUrl);
    await delay(400);
    if (win.isDestroyed()) return;
    sendBoot(win, {
      page: "installing",
      installing: true,
      stage: `正在安装 DeepSeek Harness v${version}…`,
      percent: 0,
      installMode: "global",
      detectComplete: true,
    });
    sendBootLog(win, `开始安装 DeepSeek Harness v${version}`);

    // 2) 停服 → npm 安装（真实进度经 sendBoot/sendBootLog 驱动安装视图）
    killServerTree();
    const previousMode = runtimeMode;
    setRuntimeMode("global");
    nativeRuntime = await probeNodeToolchain();
    // 先探测哪个源有这个版本（npmmirror 可能滞后），安装失败时 installManagedDsh 还会继续回退其他源
    const installRegistry = await resolveRegistryForVersion(version);
    const installResult = await installManagedDsh(win, { version, registry: installRegistry, keepBackup: true });
    setRuntimeMode(previousMode);
    activeInstallChild = null;

    // 3) 成功：重启服务并自动返回主界面
    if (installResult && !cancelInstallRequested) {
      const newPort = await startServer(win, { readyBeforeLoad: true });
      if (newPort !== null) {
        dshLaunchVersion = version;
        saveBootChoice(currentBootChoice(dshLaunchVersion));
        pendingBootUrl = `http://127.0.0.1:${newPort}`;
        cleanupManagedDshBackup(installResult);
        // 版本切换后刷新 dsh 命令行（启动器指向当前 dsh 版本）
        ensureDshCliOnPath().catch((err) => log(`ensure dsh cli after update failed: ${err.message}`));
        sendBoot(win, { page: "installing", installing: true, stage: "安装完成，正在返回软件…", percent: 100 });
        await delay(600);
        if (!win.isDestroyed()) {
          const target = pendingBootUrl;
          pendingBootUrl = null;
          win.loadURL(target);
        }
        return;
      }
      // 服务启动失败：尝试恢复旧版本
      const restoredFiles = restoreManagedDshBackup(installResult);
      if (restoredFiles) {
        dshLaunchVersion = current;
        sendBootLog(win, "已恢复更新前的 DeepSeek Harness 版本");
      }
    }

    // 4) 取消 / 安装失败：恢复旧版本并重启旧服务，然后返回主界面
    if (!cancelInstallRequested) sendBootLog(win, "DeepSeek Harness 安装失败，正在恢复旧版本…");
    const restoredFiles = restoreManagedDshBackup(installResult);
    if (restoredFiles) {
      dshLaunchVersion = current;
      sendBootLog(win, "已恢复更新前的 DeepSeek Harness 版本");
    }
    let restoredPort = null;
    try {
      setRuntimeMode(previousMode);
      restoredPort = await startServer(win, { readyBeforeLoad: true });
    } catch { /* ignore */ }
    if (restoredPort !== null) {
      pendingBootUrl = `http://127.0.0.1:${restoredPort}`;
      sendBootLog(win, cancelInstallRequested ? "已取消安装，返回软件" : "旧版本服务已恢复，返回软件");
      await delay(500);
      if (!win.isDestroyed()) {
        const target = pendingBootUrl;
        pendingBootUrl = null;
        win.loadURL(target);
      }
      return;
    }
    // 服务未能恢复：停留在安装视图并提示（提供返回按钮由渲染层触发 dsh:return-to-app）
    sendBoot(win, {
      page: "installing",
      installing: false,
      installError: true,
      stage: cancelInstallRequested
        ? "安装已取消，但服务未能恢复，请重启软件"
        : "安装失败，旧版本服务未能恢复，请重启软件",
      percent: 0,
      installMode: "global",
    });
  } finally {
    updating = false;
    pendingInstallVersion = null;
  }
}

/**
 * 检查/执行更新（自绘弹窗驱动，主进程只等用户操作）。
 * @param win 窗口
 * @param opts.silent true=静默（只更新按钮状态，不弹窗；用于启动时自动检查）
 */
async function performUpdate(win, { silent = false } = {}) {
  if (updating) return;
  updating = true;
  try {
    const current = bundledDshVersion();

    // ---- 检查阶段（失败可重试） ----
    let latest = null;
    while (true) {
      if (silent) sendStatus(win, { state: "checking", current });
      else sendEvent(win, { type: "checking", current });
      latest = await latestDshVersion();
      log(`update check: current=${current} latest=${latest ? latest.version : "N/A"} silent=${silent}`);
      if (latest !== null) break;
      sendStatus(win, { state: "idle", current });
      if (silent) return;
      sendEvent(win, {
        type: "check-failed",
        current,
        detail: "无法连接到更新源（registry.npmmirror.com / registry.npmjs.org），请检查网络后重试。",
      });
      const action = await waitForUpdateAction(win);
      if (action !== "retry-check") {
        sendEvent(win, { type: "close" });
        return;
      }
    }

    if (compareVersions(latest.version, current) <= 0) {
      sendStatus(win, { state: "idle", current });
      if (silent) return;
      sendEvent(win, { type: "up-to-date", current, latest: latest.version });
      await waitForUpdateAction(win);
      sendEvent(win, { type: "close" });
      return;
    }

    // 有更新：先通知按钮切换为绿色箭头；静默模式到此为止
    sendStatus(win, { state: "available", current, latest: latest.version });
    if (silent) return;

    // 打开确认弹窗；更新说明异步拉取后填充
    sendEvent(win, { type: "available", current, latest: latest.version, changelog: null });
    fetchChangelog()
      .then((cl) => { if (cl) sendEvent(win, { type: "available-changelog", changelog: cl }); })
      .catch((err) => log(`changelog failed: ${err.message}`));

    const firstAction = await waitForUpdateAction(win);
    if (firstAction !== "confirm") {
      sendEvent(win, { type: "close" });
      return;
    }

    // ---- 安装阶段（失败可重试） ----
    while (true) {
      sendStatus(win, { state: "updating", current, latest: latest.version });
      sendEvent(win, { type: "updating", current, latest: latest.version });
      // 更新期间先停止服务器：Windows 下正在运行的原生模块文件会被锁定，
      // 不停服直接替换 node_modules 会导致 npm 安装失败。
      killServerTree();
      const previousMode = runtimeMode;
      setRuntimeMode("global");
      nativeRuntime = await probeNodeToolchain();
      const installResult = await installManagedDsh(win, { version: latest.version, registry: latest.registry, keepBackup: true });
      setRuntimeMode(previousMode);
      const newPort = installResult ? await startServer(win, { readyBeforeLoad: true }) : null;
      if (newPort !== null) {
        dshLaunchVersion = latest.version;
        saveBootChoice(currentBootChoice(dshLaunchVersion));
        pendingBootUrl = `http://127.0.0.1:${newPort}`;
        cleanupManagedDshBackup(installResult);
        break;
      }
      const restoredFiles = restoreManagedDshBackup(installResult);
      if (restoredFiles) {
        dshLaunchVersion = current;
        sendBootLog(win, "已恢复更新前的 DeepSeek Harness 版本");
      }
      // 失败：用旧版本重启服务器，恢复可用状态；弹窗提示（不刷新页面，避免丢失弹窗）
      let restoredPort = null;
      try {
        setRuntimeMode(previousMode);
        restoredPort = await startServer(win, { readyBeforeLoad: true });
      } catch { /* ignore */ }
      const recovered = restoredPort !== null;
      if (recovered) {
        pendingBootUrl = `http://127.0.0.1:${restoredPort}`;
        sendBootLog(win, "旧版本服务已重新启动");
      }
      sendStatus(win, { state: "idle", current });
      sendEvent(win, {
        type: "update-failed",
        current,
        latest: latest.version,
        restored: recovered,
        detail: recovered
          ? "通过 npm 安装 DeepSeek Harness 失败，已恢复旧版本运行。"
          : "通过 npm 安装 DeepSeek Harness 失败，旧版本服务未能重新启动，请检查日志。",
      });
      const action = await waitForUpdateAction(win);
      if (action !== "retry") {
        sendEvent(win, { type: "close" });
        // 关闭后刷新页面，重新连接已恢复的服务器
        if (!win.isDestroyed()) {
          const target = pendingBootUrl || win.webContents.getURL();
          pendingBootUrl = null;
          win.loadURL(target);
        }
        return;
      }
      pendingBootUrl = null;
    }

    // ---- 成功：新版已安装并拉起服务，无需重启整个应用 ----
    sendStatus(win, { state: "idle", current: latest.version });
    // 先挂等就绪监听，再刷新页面连接新服务器，等 preload 就绪后弹成功窗
    const ready = waitForRendererReady(win);
    if (!win.isDestroyed()) {
      const target = pendingBootUrl || win.webContents.getURL();
      pendingBootUrl = null;
      win.loadURL(target);
    }
    await ready;
    sendEvent(win, { type: "success", current, latest: latest.version });
    await waitForUpdateAction(win);
    sendEvent(win, { type: "close" });
  } finally {
    updating = false;
  }
}

// ---------- 窗口 ----------
function createWindow(url, savedBoot = null) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    // 先加载本地启动页，再显示窗口，避免先露出 Electron 空白边框或黑屏。
    show: false,
    title: APP_NAME,
    // 启动画面阶段用主题底色实底秒开（不启用毛玻璃，避免先出模糊窗）；进主界面前再开 acrylic
    backgroundColor: "#000000",
    // 窗体标头：隐藏系统标题栏，使用毛玻璃半透明（Windows 11 acrylic；Win10 由页面内 backdrop-filter 兜底）
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // 主题经启动参数同步注入启动页；已安装过 → 启动页直接进入“正在启动”视图
      additionalArguments: [
        `--dsh-splash-theme=${splashTheme}`,
        ...(savedBoot ? ["--dsh-boot-resume=1"] : []),
      ],
    },
  });

  let splashShown = false;
  const showSplash = () => {
    if (splashShown || win.isDestroyed()) return;
    splashShown = true;
    try { win.show(); } catch { /* ignore */ }
  };
  // 启动页渲染完成信号（preload 在注入 splash DOM 后立即上报）：
  // 不等 did-finish-load（其会等待页面内 harness-web iframe 等慢子资源，导致先黑屏数秒），
  // 启动页一渲染好就展示窗口，随后再并行拉起 dsh 服务。
  const onSplashReady = (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== win) return;
    ipcMain.removeListener("dsh:splash-ready", onSplashReady);
    showSplash();
  };
  ipcMain.on("dsh:splash-ready", onSplashReady);
  // 兜底 1：即使 preload 信号丢失，文档一加载完也立刻显示（不等 iframe）；
  // 兜底 2：2.5s 硬超时，保证窗口一定出现。
  win.webContents.once("did-finish-load", () => setTimeout(showSplash, 150));
  setTimeout(showSplash, 2500);
  // 主进程检测可能早于 preload 初始化，页面加载完成后重放最近一次启动状态。
  win.webContents.once("did-finish-load", () => {
    const cached = bootPayloadCache.get(win);
    if (cached) sendBoot(win, cached);
  });
  win.on("maximize", () => win.webContents.send("dsh:win-maximized", true));
  win.on("unmaximize", () => win.webContents.send("dsh:win-maximized", false));
  win.on("closed", () => {
    if (!quitting) {
      quitting = true;
      killServerTree();
      app.quit();
    }
  });

  win.webContents.setWindowOpenHandler(({ url: target }) => {
    // dsh Web UI 偶尔会以 window.open 打开自身 URL；桌面端始终留在当前窗口，
    // 不能把本地服务交给系统默认浏览器。
    if (/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(target)) {
      if (!win.isDestroyed()) win.loadURL(target);
      return { action: "deny" };
    }
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    const current = win.webContents.getURL();
    // 启动页（file://）→ 主界面：首次导航放行
    if (current === "about:blank" || current === "" || current.startsWith("file:")) return;
    // 只允许站内导航（本地服务器），外部链接一律交给系统浏览器
    const allowed = new URL(target);
    if (allowed.origin !== new URL(current).origin) {
      event.preventDefault();
      if (/^https?:/i.test(target)) shell.openExternal(target);
    }
  });

  win.loadURL(url);
  return win;
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.on("dsh:win-min", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on("dsh:win-max-toggle", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on("dsh:win-close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.handle("dsh:win-is-maximized", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });
  ipcMain.on("dsh:check-update", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) autoCheckUpdates(win).catch((err) => log(`check-update failed: ${err.message}`));
  });
  ipcMain.handle("dsh:get-settings", () => appSettings);
  ipcMain.on("dsh:save-settings", (event, patch) => {
    if (!patch || typeof patch !== "object") return;
    const next = { ...appSettings };
    for (const key of ["balancePlugin", "receiptEnabled"]) {
      if (typeof patch[key] === "boolean") next[key] = patch[key];
    }
    if (patch.updateChannel === "latest" || patch.updateChannel === "next") next.updateChannel = patch.updateChannel;
    if (typeof patch.notifiedVersion === "string") next.notifiedVersion = patch.notifiedVersion;
    if (patch.llama && typeof patch.llama === "object") next.llama = sanitizeLlamaSettings(patch.llama);
    appSettings = next;
    saveAppSettings();
    broadcastSettings();
  });
  // llama.cpp 启动器：读取配置/模型列表/状态
  ipcMain.handle("dsh:llama-get", () => {
    const exe = llamaServerExePath();
    return {
      config: appSettings.llama,
      status: llamaPublicStatus(),
      models: listLlamaModels(),
      serverExe: !!exe && fs.existsSync(exe),
    };
  });
  // llama.cpp 启动器：保存配置补丁（目录/模型/参数/跟随启动）
  ipcMain.on("dsh:llama-save", (event, patch) => {
    if (!patch || typeof patch !== "object") return;
    appSettings.llama = sanitizeLlamaSettings({ ...appSettings.llama, ...patch });
    saveAppSettings();
    broadcastSettings();
  });
  ipcMain.handle("dsh:llama-browse-dir", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: "选择 llama.cpp 目录（需包含 llama-server.exe）",
      buttonLabel: "选择此文件夹",
      defaultPath: (appSettings.llama && appSettings.llama.dir) || undefined,
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle("dsh:llama-browse-model", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const cfg = appSettings.llama || {};
    const defaultPath = cfg.modelPath
      || (cfg.dir ? path.join(cfg.dir, "models") : undefined);
    const result = await dialog.showOpenDialog(win, {
      title: "选择 GGUF 模型文件",
      buttonLabel: "选择此文件",
      defaultPath,
      filters: [{ name: "GGUF 模型", extensions: ["gguf"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.on("dsh:llama-start", () => {
    startLlamaServer().catch((err) => {
      const message = err && err.message ? err.message : String(err);
      log(`llama start failed: ${message}`);
      llamaStatus = { ...llamaStatus, state: "error", error: message };
      broadcastLlamaStatus();
    });
  });
  ipcMain.on("dsh:llama-stop", () => {
    stopLlamaServer();
  });
  ipcMain.handle("dsh:list-versions", () => listDshVersions());
  ipcMain.on("dsh:install-version", (event, version) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || typeof version !== "string" || version.trim() === "") return;
    installVersionWithSplash(win, version.trim()).catch((err) => log(`install-version failed: ${err.message}`));
  });
  ipcMain.on("dsh:cancel-install", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    log("user requested cancel install");
    killActiveInstall();
    // 通知启动页安装视图立即切换为"正在取消"
    sendBootLog(win, "正在取消安装…");
  });
  ipcMain.handle("dsh:get-pending-install", () => pendingInstallVersion);
  ipcMain.handle("dsh:return-to-app", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false };
    if (pendingBootUrl) {
      const target = pendingBootUrl;
      pendingBootUrl = null;
      win.loadURL(target);
      return { ok: true };
    }
    // 无可用服务：回到启动页默认状态（由渲染层展示提示）
    return { ok: false };
  });
  ipcMain.handle("dsh:reload-after-update", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !pendingBootUrl) return { ok: false };
    const target = pendingBootUrl;
    pendingBootUrl = null;
    const ready = waitForRendererReady(win);
    win.loadURL(target);
    await ready;
    return { ok: true };
  });
  ipcMain.handle("dsh:get-version", () => ({
    dsh: bundledDshVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    runtime: RUNTIME_DIR,
    dshRuntime: managedDshRuntimeDir(),
    mode: runtimeMode,
    native: nativeRuntime ? {
      installed: nativeRuntime.localNodeReady,
      node: nativeRuntime.node ? nativeRuntime.node.raw : null,
      npm: nativeRuntime.npm ? nativeRuntime.npm.raw : null,
      dsh: probeManagedDshRuntime().version || null,
    } : null,
  }));
  // 启动画面主题：主界面报告主题 → 持久化（供下次启动页跟随）并恢复毛玻璃透明底
  ipcMain.on("dsh:theme", (event, theme) => {
    if (theme === "light" || theme === "dark") {
      splashTheme = theme;
      saveSplashTheme(theme);
    }
    // 主界面已渲染出主题底色：此时再切透明+毛玻璃，不会出现白闪
    if (process.platform === "win32") {
      const win = BrowserWindow.fromWebContents(event.sender);
      try {
        if (win && !win.isDestroyed()) {
          win.setBackgroundMaterial("acrylic");
          win.setBackgroundColor("#00000000");
        }
      } catch { /* ignore */ }
    }
  });
  // 首次运行：让用户选择运行时安装位置（默认软件安装目录/runtime）
  ipcMain.handle("dsh:choose-runtime-dir", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: "选择运行时安装位置",
      buttonLabel: "选择此文件夹",
      defaultPath: RUNTIME_DIR,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return path.join(result.filePaths[0], "runtime");
  });
  ipcMain.on("dsh:runtime-install", async (event, dir) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const request = dir && typeof dir === "object" ? dir : { mode: "custom", dir };
    const requestedMode = request.mode === "global" ? "global" : "custom";
    // 安装版始终使用软件托管的 npm 安装槽；本机 Node 只作为 npm/node 执行器。
    const mode = requestedMode === "global" ? "global" : "bundled";
    if (requestedMode === "global") {
      try {
        setRuntimeMode("global");
        setDshRuntimeDir(null);
        if (!nativeRuntime || !nativeRuntime.localNodeReady) {
          const installed = await installSystemNode(win);
          if (!installed) throw new Error("Node.js 环境准备失败");
          nativeRuntime = await probeNodeToolchain();
        }
        if (!nativeRuntime || !nativeRuntime.localNodeReady) throw new Error("Node.js 环境准备失败");
        const ok = await ensureGlobalRuntime(win);
        if (!ok) throw new Error("DeepSeek Harness 安装失败");
        saveBootChoice(currentBootChoice(dshLaunchVersion));
        // 安装完成即把 dsh 加入命令行 PATH（可 cmd/终端直接使用 dsh）
        ensureDshCliOnPath().catch((err) => log(`ensure dsh cli after install failed: ${err.message}`));
        // 安装完成即止：不在此拉起服务，等用户点击"开始使用"后再启动
        sendBoot(win, {
          page: "ready",
          stage: "安装完成，点击开始使用",
          percent: 100,
          primaryAction: "start",
          installMode: runtimeMode,
          detectComplete: true,
        });
      } catch (error) {
        sendBootLog(win, `全局安装失败：${error instanceof Error ? error.message : String(error)}`);
        sendBoot(win, { page: "installing", installing: false, installError: true, stage: "安装失败，请检查网络后重试", percent: 0, native: nativeRuntime, detectComplete: true, installMode: "global" });
      }
      return;
    }
    if (typeof request.dir !== "string" || request.dir.trim() === "") return;
    const target = path.resolve(request.dir.trim());
    setRuntimeMode(mode);
    try {
      fs.mkdirSync(target, { recursive: true });
    } catch (error) {
      sendBootLog(win, `无法创建目录：${error.message}`);
      sendBoot(win, { page: "location", installing: false, stage: "请选择程序的安装目录", percent: 0, defaultDir: RUNTIME_DIR, native: nativeRuntime, detectComplete: true });
      return;
    }
    setRuntimeDir(target);
    setDshRuntimeDir(path.join(target, "dsh-runtime"));
    log(`runtime install target: ${target}`);
    try {
      const ok = await ensureRuntime(win);
      if (!ok) {
        sendBootLog(win, "安装失败，请更换安装位置或检查网络后重试");
        sendBoot(win, { page: "installing", installing: false, installError: true, stage: "安装失败，请检查网络后重试", percent: 0, defaultDir: RUNTIME_DIR, native: nativeRuntime, detectComplete: true, installMode: mode });
        return;
      }
      saveBootChoice(currentBootChoice(dshLaunchVersion));
      // 安装完成即把 dsh 加入命令行 PATH（可 cmd/终端直接使用 dsh）
      ensureDshCliOnPath().catch((err) => log(`ensure dsh cli after custom install failed: ${err.message}`));
      // 安装完成即止：不在此拉起服务，等用户点击"开始使用"后再启动
      sendBoot(win, {
        page: "ready",
        stage: "安装完成，点击开始使用",
        percent: 100,
        primaryAction: "start",
        installMode: runtimeMode,
        detectComplete: true,
      });
    } catch (error) {
      log(`runtime install flow error: ${error && error.message ? error.message : String(error)}`);
      sendBootLog(win, `安装异常：${error && error.message ? error.message : String(error)}`);
      sendBoot(win, { page: "installing", installing: false, installError: true, stage: "安装失败，请检查网络后重试", percent: 0, defaultDir: RUNTIME_DIR, native: nativeRuntime, detectComplete: true, installMode: mode });
    }
  });
  ipcMain.on("dsh:boot-choice", async (event, choice) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || typeof choice !== "string") return;
    if (choice === "native") {
      if (!nativeRuntime || !nativeRuntime.localNodeReady) {
        sendBootLog(win, "本机 Node.js/npm 环境不可用，请先安装 Node");
        sendBoot(win, { page: "detect", installing: false, stage: "未检测到可用本机环境", percent: 0, defaultDir: RUNTIME_DIR, native: nativeRuntime, detectComplete: true });
        return;
      }
      setRuntimeMode("native");
      saveBootChoice(currentBootChoice(dshLaunchVersion));
      sendBoot(win, {
        page: "ready",
        stage: readyStageText("native"),
        percent: 100,
        primaryAction: "start",
        installMode: "native",
      });
      return;
    }
    if (choice === "install") {
      try {
        setRuntimeMode("global");
        setDshRuntimeDir(null);
        if (!nativeRuntime || !nativeRuntime.localNodeReady) {
          const installed = await installSystemNode(win);
          if (!installed) throw new Error("Node.js 环境准备失败");
          nativeRuntime = await probeNodeToolchain();
        }
        const ok = await ensureGlobalRuntime(win);
        if (!ok) throw new Error("DeepSeek Harness 安装失败");
        saveBootChoice(currentBootChoice(dshLaunchVersion));
        // 安装完成即把 dsh 加入命令行 PATH（可 cmd/终端直接使用 dsh）
        ensureDshCliOnPath().catch((err) => log(`ensure dsh cli after install failed: ${err.message}`));
        // 安装完成即止：不在此拉起服务，等用户点击"开始使用"后再启动
        sendBoot(win, {
          page: "ready",
          stage: "安装完成，点击开始使用",
          percent: 100,
          primaryAction: "start",
          installMode: runtimeMode,
          detectComplete: true,
        });
      } catch (error) {
        sendBootLog(win, `全局安装失败：${error instanceof Error ? error.message : String(error)}`);
        sendBoot(win, { page: "installing", installing: false, installError: true, stage: "安装失败，请检查网络后重试", percent: 0, native: nativeRuntime, detectComplete: true, installMode: "global" });
      }
      return;
    }
    if (choice === "start") {
      try {
        if (pendingBootUrl) {
          const target = pendingBootUrl;
          pendingBootUrl = null;
          win.loadURL(target);
          return;
        }
        if ((runtimeMode === "native" || runtimeMode === "global") && (!nativeRuntime || !nativeRuntime.localNodeReady)) {
          sendBootLog(win, "本机 Node.js/npm 环境不可用，请先安装 Node");
          sendBoot(win, { page: "detect", installing: false, stage: "未检测到可用本机环境", percent: 0, defaultDir: RUNTIME_DIR, native: nativeRuntime, detectComplete: true });
          return;
        }
        const dshProbe = probeManagedDshRuntime();
        if (!dshProbe.ready) {
          sendBootLog(win, "未检测到 DeepSeek Harness 环境，请先安装");
          sendBoot(win, { page: "location", installing: false, stage: "请先安装 DeepSeek Harness", percent: 0, defaultDir: RUNTIME_DIR, native: nativeRuntime, detectComplete: true, installMode: "global" });
          return;
        }
        dshLaunchVersion = dshProbe.version || dshLaunchVersion;
        await bootServer(win);
      } catch (error) {
        log(`native boot failed: ${error && error.message ? error.message : String(error)}`);
        sendBootLog(win, `本机启动失败：${error && error.message ? error.message : String(error)}`);
        setRuntimeMode("bundled");
        sendBoot(win, { page: "detect", installing: false, stage: "正在检查本机环境…", percent: 0, defaultDir: RUNTIME_DIR, native: nativeRuntime, detectComplete: true });
      }
    }
  });
}

// ---------- 生命周期 ----------
app.setAppUserModelId("com.deepseekai.harness.desktop");
// Windows 下禁用原生窗口遮挡检测：该检测会延迟窗口首帧显示（黑屏/慢出），禁用可加快启动
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

if (app.isPackaged) {
  // 打包版去掉默认应用菜单：避免误触 Ctrl+R / Ctrl+W 等快捷键，界面更干净
  try {
    const { Menu } = require("electron");
    Menu.setApplicationMenu(null);
  } catch { /* ignore */ }
}

app.whenReady().then(async () => {
  registerIpc();
  log(`========== ${APP_NAME} start ==========`);
  log(`dev=${isDev}`);
  loadSplashTheme();
  loadAppSettings();

  const savedBoot = loadBootChoice();
  if (savedBoot && savedBoot.dshVersion) dshLaunchVersion = savedBoot.dshVersion;
  setRuntimeDir(savedBoot && savedBoot.runtimeDir ? savedBoot.runtimeDir : defaultRuntimeDir());
  setDshRuntimeDir(savedBoot && savedBoot.dshRuntimeDir ? savedBoot.dshRuntimeDir : null);
  setRuntimeMode(savedBoot && savedBoot.mode ? savedBoot.mode : "global");
  log(`runtime dir: ${RUNTIME_DIR}`);
  log(`dsh runtime dir: ${managedDshRuntimeDir()}`);

  // 双击后立即开窗：启动页（logo/状态/进度条）马上渲染，检测等其余工作在后台并行
  const splashUrl = pathToFileURL(path.join(__dirname, "assets", "splash.html")).href;
  const win = createWindow(splashUrl, savedBoot);

  nativeRuntime = await probeStartupNodeToolchain();
  log(`native runtime: node=${nativeRuntime && nativeRuntime.node ? nativeRuntime.node.raw : "missing"}, npm=${nativeRuntime && nativeRuntime.npm ? nativeRuntime.npm.raw : "missing"}, dsh=${probeManagedDshRuntime().version || "missing"}`);

  const dshProbe = probeManagedDshRuntime();

  // 已安装过（boot.json 存在且托管 dsh 就绪）：跳过环境检测向导，
  // 启动页直接进入"正在启动"视图并拉起服务；只有首次运行（或环境异常需要重装）才走检测向导。
  if (savedBoot && dshProbe.ready) {
    const nativeOk = !!(nativeRuntime && nativeRuntime.localNodeReady);
    const portableOk = hasHealthyAppRuntime();
    const bootable = (runtimeMode === "global" || runtimeMode === "native") ? (nativeOk || portableOk) : portableOk;
    if (bootable) {
      log("saved boot choice found, skipping detection wizard");
      // 已安装环境：刷新 dsh 命令行（兼容升级/移动安装目录后启动器指向失效的情况）
      ensureDshCliOnPath().catch((err) => log(`ensure dsh cli at startup failed: ${err.message}`));
      sendBoot(win, {
        page: "booting",
        stage: "正在准备启动…",
        percent: 8,
      });
      // 说明：若开启 llama 跟随启动，进度条后续由 bootServer 内的 llama 阶段（10–75）
      // 与 harness 阶段（78–100）接管，避免出现进度倒退。
      await bootServer(win);
      return;
    }
    // 运行槽存在但 node/npm 缺失（目录被移动/删除等）：回落到检测向导，引导修复/重装
    log("saved boot choice found but runtime missing, falling back to detection wizard");
  }

  const startup = await runStartupWizard(win);
  if (!startup || win.isDestroyed()) return;

  nativeRuntime = startup.nodeProbe;
  const rememberedMode = savedBoot && savedBoot.mode ? savedBoot.mode : runtimeMode;

  const launchVersion = startup.dshProbe && startup.dshProbe.version ? startup.dshProbe.version : dshLaunchVersion;
  dshLaunchVersion = launchVersion;
  saveBootChoice({
    mode: rememberedMode,
    runtimeDir: savedBoot && savedBoot.runtimeDir ? savedBoot.runtimeDir : null,
    dshRuntimeDir: savedBoot && savedBoot.dshRuntimeDir ? savedBoot.dshRuntimeDir : null,
    dshVersion: launchVersion,
  });
});

/** 起服务并把窗口导航到主界面（含更新静默检查）。
 *  options.skipLlama：首次安装等场景跳过 llama 跟随启动阶段（避免干扰安装视图）。 */
async function bootServer(win, options = {}) {
  log(`dsh version: ${bundledDshVersion()}`);
  // llama 跟随软件启动：先于 harness 服务拉起 llama-server，真实进度写入启动页进度条
  if (!options.skipLlama) await maybeStartLlamaBeforeHarness(win);
  const port = await startServer(win, options);
  if (port === null) return;
  if (options.readyBeforeLoad) {
    pendingBootUrl = `http://127.0.0.1:${port}`;
    sendBoot(win, {
      page: "ready",
      stage: readyStageText(runtimeMode),
      percent: 100,
      primaryAction: "start",
      installMode: runtimeMode,
      detectComplete: true,
    });
    return;
  }
  const url = `http://127.0.0.1:${port}`;
  log(`GUI ready at ${url}`);
  // 启动画面 → 主界面：导航时保持主题实色底，避免页面首帧白闪；
  // 页面渲染出主题底色后（dsh:theme 上报）再由主进程恢复毛玻璃透明底。
  win.loadURL(url);

  // 启动后静默检查一次更新（监控 Next 频道，发现新版本只通过设置弹窗提示一次）：
  // 等页面 preload 上报就绪后再触发，避免页面还在加载、状态事件丢失。
  const autoCheck = () => {
    autoCheckUpdates(win).catch((err) => log(`auto-check failed: ${err.message}`));
  };
  const onReadyForCheck = (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== win) return;
    ipcMain.removeListener("dsh:renderer-ready", onReadyForCheck);
    // 页面就绪后再稍等片刻，让界面稳定
    setTimeout(autoCheck, 1200);
  };
  ipcMain.on("dsh:renderer-ready", onReadyForCheck);
}

app.on("window-all-closed", () => {
  quitting = true;
  killServerTree();
  stopLlamaServer();
  app.quit();
});

app.on("before-quit", () => {
  quitting = true;
  killServerTree();
  stopLlamaServer();
});

process.on("uncaughtException", (err) => {
  log(`uncaughtException: ${err && err.stack ? err.stack : String(err)}`);
});
