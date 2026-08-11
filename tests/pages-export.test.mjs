import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const pagesBasePath = "/us-lens-daily";

test("GitHub Pages build exports a self-contained static demo", async () => {
  const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");

  assert.match(html, /US LENS/);
  assert.match(html, /美股盘前与盘后热点简报/);
  assert.match(html, new RegExp(`${pagesBasePath}/_next/`));
  assert.match(html, new RegExp(`${pagesBasePath}/og-us-lens\\.png`));
  assert.doesNotMatch(html, /(?:src|href)="\/_next\//);

  await access(new URL("../out/demo/index.json", import.meta.url));
  await access(
    new URL("../out/demo/reports/2026-08-11-post.json", import.meta.url),
  );
  assert.match(html, /2026-08-11 美股盘后热点追踪简报/);
});

test("client bundle prefixes report requests with the repository path", async () => {
  const staticRoot = new URL("../out/_next/static/", import.meta.url);
  const files = await readdir(staticRoot, { recursive: true });
  const javascript = (
    await Promise.all(
      files
        .filter((file) => file.endsWith(".js"))
        .map((file) =>
          readFile(new URL(file, staticRoot), "utf8"),
        ),
    )
  ).join("\n");

  assert.match(javascript, /\/us-lens-daily/);
});
