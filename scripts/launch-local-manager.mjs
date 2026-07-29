import { spawn } from "node:child_process";
import { closeSync, openSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(scriptDir, "..");
const managerScript = path.join(scriptDir, "local-server.mjs");
const [logFile, pidFile, npmExecutable] = process.argv.slice(2);

if (!logFile || !pidFile || !npmExecutable) {
  throw new Error("缺少本地服务启动参数。");
}

const logDescriptor = openSync(logFile, "a");
try {
  const child = spawn(process.execPath, [managerScript], {
    cwd: siteRoot,
    detached: true,
    env: {
      ...process.env,
      US_LENS_NPM: npmExecutable,
    },
    stdio: ["ignore", logDescriptor, logDescriptor],
  });

  child.once("error", (error) => {
    throw error;
  });
  child.unref();
  writeFileSync(pidFile, `${child.pid}\n`, "utf8");
} finally {
  closeSync(logDescriptor);
}
