import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const indexUrl = new URL("../public/data/index.json", import.meta.url);
const syncScriptUrl = new URL("../scripts/sync-reports.mjs", import.meta.url);

async function indexDigest() {
  return createHash("sha256")
    .update(await readFile(indexUrl))
    .digest("hex");
}

function runSyncWithoutVault() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(syncScriptUrl)], {
      env: {
        ...process.env,
        US_DAILY_VAULT: "/tmp/us-lens-vault-does-not-exist",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr }));
  });
}

test("sync rejects a missing vault without overwriting the public index", async () => {
  const before = await indexDigest();
  const result = await runSyncWithoutVault();
  const after = await indexDigest();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /left unchanged/);
  assert.equal(after, before);
});
