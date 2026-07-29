import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { access } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(scriptDir, "..");
const vaultRoot =
  process.env.US_DAILY_VAULT ??
  path.resolve(siteRoot, "../00-美股投资知识库");
const host = "127.0.0.1";
const port = 3001;
const npmExecutable =
  process.env.US_LENS_NPM ??
  (process.platform === "darwin"
    ? path.join(path.dirname(process.execPath), "npm")
    : "npm");
const sourceDirectories = [
  path.join(
    vaultRoot,
    "03-输出与复盘层",
    "00-每日看板",
    "00-盘前",
  ),
  path.join(
    vaultRoot,
    "03-输出与复盘层",
    "00-每日看板",
    "01-盘中与收盘",
  ),
];

process.title = "us-lens-local-manager";

let serverProcess = null;
let activeCommand = null;
let refreshTimer = null;
let refreshing = false;
let refreshQueued = false;
let shuttingDown = false;
let expectedServerExit = false;
const watchers = [];

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function assertReadable(target, label) {
  try {
    await access(target);
  } catch {
    throw new Error(`${label}不存在或不可读取：${target}`);
  }
}

function assertNodeVersion() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(
      `Node.js 版本过低：${process.versions.node}，需要 22.13.0 或更高版本。`,
    );
  }
}

function isPortListening() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function terminateProcessGroup(child, signal = "SIGTERM") {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function runNpm(scriptName) {
  return new Promise((resolve, reject) => {
    const child = spawn(npmExecutable, ["run", scriptName], {
      cwd: siteRoot,
      detached: true,
      env: process.env,
      stdio: "inherit",
    });
    activeCommand = child;
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (activeCommand === child) activeCommand = null;
      if (signal) log(`${scriptName} 被信号 ${signal} 终止。`);
      resolve(code ?? 1);
    });
  });
}

async function stopServer() {
  const child = serverProcess;
  if (!child) return;

  expectedServerExit = true;
  await new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(forceTimer);
      if (serverProcess === child) serverProcess = null;
      resolve();
    };
    const forceTimer = setTimeout(() => {
      terminateProcessGroup(child, "SIGKILL");
      finish();
    }, 5000);
    child.once("exit", finish);
    terminateProcessGroup(child);
  });
  expectedServerExit = false;
}

async function waitForServer() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await isPortListening()) return;
    if (!serverProcess || serverProcess.exitCode !== null) break;
    await sleep(250);
  }
  throw new Error(`本地网页未能在 http://${host}:${port} 启动。`);
}

async function startServer() {
  if (shuttingDown) return;
  log(`启动本地网页：http://${host}:${port}`);
  const child = spawn(npmExecutable, ["run", "local:serve"], {
    cwd: siteRoot,
    detached: true,
    env: process.env,
    stdio: "inherit",
  });
  serverProcess = child;
  child.once("error", (error) => {
    console.error(error);
  });
  child.once("exit", (code, signal) => {
    if (serverProcess === child) serverProcess = null;
    if (!shuttingDown && !expectedServerExit) {
      console.error(
        `本地网页意外停止（退出码 ${code ?? "未知"}，信号 ${signal ?? "无"}）。`,
      );
      void shutdown(code || 1);
    }
  });
  await waitForServer();
  log("本地网页已就绪。");
}

async function refreshAndRestart(reason) {
  if (shuttingDown) return;
  if (refreshing) {
    refreshQueued = true;
    return;
  }

  refreshing = true;
  try {
    do {
      refreshQueued = false;
      log(`刷新本地报告：${reason}`);
      const exitCode = await runNpm("refresh");
      if (exitCode !== 0) {
        throw new Error(`本地报告刷新失败，退出码 ${exitCode}。`);
      }
      await stopServer();
      await startServer();
    } while (refreshQueued && !shuttingDown);
  } finally {
    refreshing = false;
  }
}

function scheduleRefresh(eventType, fileName) {
  if (shuttingDown) return;
  if (fileName && !fileName.toLowerCase().endsWith(".md")) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshAndRestart(
      `${eventType}${fileName ? `：${fileName}` : ""}`,
    ).catch((error) => {
      console.error(
        `[${new Date().toISOString()}] ${error.stack ?? error.message}`,
      );
    });
  }, 1600);
}

function startWatchers() {
  for (const directory of sourceDirectories) {
    const watcher = watch(directory, (eventType, fileName) => {
      scheduleRefresh(eventType, fileName?.toString());
    });
    watcher.on("error", (error) => {
      console.error(`监听目录失败：${directory}`, error);
    });
    watchers.push(watcher);
  }
  log("正在监听盘前与盘后 Markdown 更新。");
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(refreshTimer);
  for (const watcher of watchers) watcher.close();
  terminateProcessGroup(activeCommand);
  await stopServer();
  log("US LENS 本地服务已停止。");
  process.exit(exitCode);
}

async function main() {
  assertNodeVersion();
  await assertReadable(npmExecutable, "npm");
  await Promise.all(
    sourceDirectories.map((directory, index) =>
      assertReadable(directory, index === 0 ? "盘前目录" : "盘后目录"),
    ),
  );
  if (await isPortListening()) {
    throw new Error(`端口 ${port} 已被其他程序占用。`);
  }

  log("首次同步并构建本地报告。");
  const exitCode = await runNpm("refresh");
  if (exitCode !== 0) {
    throw new Error(`首次构建失败，退出码 ${exitCode}。`);
  }
  await startServer();
  startWatchers();
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
process.on("SIGHUP", () => {
  log("收到终端挂断信号；本地服务继续在后台运行。");
});

main().catch((error) => {
  console.error(`[${new Date().toISOString()}] ${error.stack ?? error.message}`);
  void shutdown(1);
});
