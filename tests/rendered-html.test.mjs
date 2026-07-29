import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function readIndex() {
  return JSON.parse(
    await readFile(new URL("../public/data/index.json", import.meta.url), "utf8"),
  );
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the US Lens report shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN"/i);
  assert.match(html, /US LENS/);
  assert.match(html, /美股盘前与盘后热点简报/);
  assert.match(html, /专业术语解释/);
  assert.doesNotMatch(html, /(?:og\.png|favicon\.svg)/);
  assert.doesNotMatch(html, /Your site is taking shape|SkeletonPreview/);

  const index = await readIndex();
  if (index.reportCount === 0) {
    assert.match(html, /等待第一份美股简报/);
    assert.match(html, /事实 \/ 已确认/);
    assert.match(html, /不构成投资建议/);
  } else {
    assert.match(html, /正在读取简报/);
  }
});

test("report UI retains its evidence taxonomy and empty-state copy", async () => {
  const source = await readFile(
    new URL("../app/components/BriefDashboard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /US LENS/);
  assert.match(source, /专业术语解释/);
  assert.match(source, /事实 \/ 已确认/);
  assert.match(source, /市场解读/);
  assert.match(source, /市场情绪 \/ 热度/);
  assert.match(source, /待核实 \/ 待验证/);
  assert.match(source, /风险提示/);
  assert.match(source, /section-jumpbar/);
  assert.match(source, /HotspotExplorer/);
  assert.match(source, /data-evidence-focus/);
  assert.doesNotMatch(source, /className="section-outline"/);
  assert.match(source, /等待第一份美股简报/);
  assert.match(source, /当前 Obsidian 目录还没有正式盘前或盘后报告/);
});

test("generated report index has a stable public schema", async () => {
  const index = await readIndex();
  assert.equal(index.version, 1);
  assert.equal(index.reportCount, index.reports.length);
  assert.ok(
    index.generatedAt === null || !Number.isNaN(Date.parse(index.generatedAt)),
  );

  const ids = index.reports.map((report) => report.id);
  assert.equal(new Set(ids).size, ids.length, "report IDs must be unique");

  const sortedIds = [...index.reports]
    .sort((left, right) => {
      const byDate = right.date.localeCompare(left.date);
      if (byDate !== 0) return byDate;
      return left.session === "post" ? -1 : 1;
    })
    .map((report) => report.id);
  assert.deepEqual(
    ids,
    sortedIds,
    "reports must stay in newest-first, post-before-pre order",
  );
});

test("every public report summary resolves to a matching detail document", async () => {
  const index = await readIndex();

  for (const summary of index.reports) {
    assert.equal(summary.dataUrl, `/data/reports/${summary.id}.json`);

    const detail = JSON.parse(
      await readFile(
        new URL(`../public/data/reports/${summary.id}.json`, import.meta.url),
        "utf8",
      ),
    );

    assert.equal(detail.id, summary.id);
    assert.equal(detail.date, summary.date);
    assert.equal(detail.session, summary.session);
    assert.ok(Array.isArray(detail.sections));
    assert.ok(detail.sections.length > 0);
    assert.ok(detail.sections.some((section) => section.markdown?.trim()));
    assert.equal(path.isAbsolute(detail.sourcePath), false);
    assert.equal(
      detail.sourcePath.split(/[\\/]/).includes(".."),
      false,
      "sourcePath must not escape the public content root",
    );
  }
});
