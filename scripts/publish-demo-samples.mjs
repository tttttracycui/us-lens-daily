import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const privateDataRoot = path.join(projectRoot, "public", "data");
const demoRoot = path.join(projectRoot, "public", "demo");
const demoReportsRoot = path.join(demoRoot, "reports");

const selectedReportIds = [
  "2026-08-11-post",
  "2026-08-10-pre",
  "2026-08-09-post",
  "2026-08-09-pre",
  "2026-08-07-post",
  "2026-08-07-pre",
];

function sanitizeReport(report) {
  const id = report.id;
  return {
    ...report,
    fileName: `${id}.md`,
    sourcePath: `public-demo/${id}.md`,
    tags: [...new Set([...(report.tags ?? []), "公开案例样本"])],
    dataUrl: `/demo/reports/${id}.json`,
  };
}

const privateIndex = JSON.parse(
  await readFile(path.join(privateDataRoot, "index.json"), "utf8"),
);
const summariesById = new Map(
  privateIndex.reports.map((report) => [report.id, report]),
);

await rm(demoReportsRoot, { recursive: true, force: true });
await mkdir(demoReportsRoot, { recursive: true });

const summaries = [];
for (const id of selectedReportIds) {
  const summary = summariesById.get(id);
  if (!summary) {
    throw new Error(`Selected Demo report is missing from the private index: ${id}`);
  }

  const detail = JSON.parse(
    await readFile(path.join(privateDataRoot, "reports", `${id}.json`), "utf8"),
  );
  const publicDetail = sanitizeReport(detail);
  const publicSummary = sanitizeReport(summary);

  summaries.push(publicSummary);
  await writeFile(
    path.join(demoReportsRoot, `${id}.json`),
    `${JSON.stringify(publicDetail, null, 2)}\n`,
    "utf8",
  );
}

const demoIndex = {
  version: 1,
  generatedAt: privateIndex.generatedAt,
  reportCount: summaries.length,
  reports: summaries,
};

await writeFile(
  path.join(demoRoot, "index.json"),
  `${JSON.stringify(demoIndex, null, 2)}\n`,
  "utf8",
);

console.log(`Published ${summaries.length} sanitized reports to ${demoRoot}`);
