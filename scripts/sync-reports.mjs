import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(scriptDir, "..");
const vaultRoot =
  process.env.US_DAILY_VAULT ??
  path.resolve(siteRoot, "../00-美股投资知识库");

const sources = [
  {
    session: "pre",
    directory: path.join(
      vaultRoot,
      "03-输出与复盘层",
      "00-每日看板",
      "00-盘前",
    ),
  },
  {
    session: "post",
    directory: path.join(
      vaultRoot,
      "03-输出与复盘层",
      "00-每日看板",
      "01-盘中与收盘",
    ),
  },
];

const availableSourceDirectories = await Promise.all(
  sources.map(async ({ directory }) => {
    try {
      return (await stat(directory)).isDirectory();
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }),
);

if (!availableSourceDirectories.some(Boolean)) {
  throw new Error(
    [
      `No Obsidian report directories were found under ${vaultRoot}.`,
      "Set US_DAILY_VAULT to your vault before running sync:reports or refresh.",
      "The bundled public/data index was left unchanged.",
    ].join(" "),
  );
}

const outputRoot = path.join(siteRoot, "public", "data");
const reportOutputRoot = path.join(outputRoot, "reports");

function parseScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed;
}

function splitFrontmatter(input) {
  const normalized = input.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { metadata: {}, body: normalized.trim() };
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return { metadata: {}, body: normalized.trim() };
  }

  const metadata = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) metadata[match[1]] = parseScalar(match[2]);
  }
  return {
    metadata,
    body: normalized.slice(end + 5).trim(),
  };
}

function cleanInline(value) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSections(markdown) {
  const sections = [];
  let current = null;
  const preface = [];

  for (const line of markdown.split("\n")) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      if (current) {
        current.markdown = current.lines.join("\n").trim();
        delete current.lines;
        sections.push(current);
      }
      current = {
        id: `section-${sections.length + 1}`,
        title: cleanInline(heading[1]),
        lines: [],
      };
      continue;
    }
    if (current) current.lines.push(line);
    else preface.push(line);
  }

  if (current) {
    current.markdown = current.lines.join("\n").trim();
    delete current.lines;
    sections.push(current);
  }

  if (preface.some((line) => line.trim() && !line.startsWith("# "))) {
    sections.unshift({
      id: "section-0",
      title: "导读",
      markdown: preface.filter((line) => !line.startsWith("# ")).join("\n").trim(),
    });
  }
  return sections;
}

function findSummary(sections) {
  const section =
    sections.find((item) => /市场总结|盘前总结|今日总结/.test(item.title)) ??
    sections[0];
  if (!section) return "";
  const candidates = section.markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith("|") &&
        !line.startsWith("#") &&
        !/^[-*:]+$/.test(line),
    );
  return cleanInline(candidates[0] ?? "").slice(0, 220);
}

function extractTitle(body, fallbackDate, session) {
  const heading = body.match(/^#\s+(.+)$/m);
  if (heading) return cleanInline(heading[1]);
  return `${fallbackDate} 美股${session === "pre" ? "盘前" : "盘后"}热点追踪简报`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractTopics(sections) {
  const hotspot = sections.find((section) => /核心热点|热点\s*Top/i.test(section.title));
  if (!hotspot) return [];
  return unique(
    [...hotspot.markdown.matchAll(/^###\s+(?:\d+[.、)）-]?\s*)?(.+)$/gm)].map(
      (match) => cleanInline(match[1]).replace(/^热点\s*\d+[:：]?\s{0,}/i, ""),
    ),
  ).slice(0, 10);
}

function extractTickers(body) {
  const blocked = new Set([
    "AI", "API", "CEO", "CFO", "CPI", "ETF", "ET", "FED", "FOMC",
    "GDP", "HKT", "IR", "SEC", "USD", "VIX", "WSJ",
  ]);
  return unique(
    [...body.matchAll(/\b[A-Z]{1,5}\b/g)]
      .map((match) => match[0])
      .filter((value) => !blocked.has(value)),
  ).slice(0, 18);
}

function countMatches(input, pattern) {
  return [...input.matchAll(pattern)].length;
}

function countSources(body) {
  const markdownLinks = [...body.matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g)].map(
    (match) => match[1],
  );
  const bareLinks = [...body.matchAll(/(?<!\()https?:\/\/[^\s)>]+/g)].map(
    (match) => match[0],
  );
  return unique([...markdownLinks, ...bareLinks]).length;
}

function countPrimarySources(body) {
  const lines = body
    .split("\n")
    .filter((line) =>
      /SEC|EDGAR|Investor Relations|公司\s*IR|Federal Reserve|NYSE|Nasdaq|财报原文|官方公告/i.test(
        line,
      ),
    );
  return unique(lines).length;
}

function safeDate(value, fallback) {
  const match = String(value ?? "").match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? fallback;
}

async function listMarkdownFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => path.join(directory, entry.name));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function parseReport(filePath, session) {
  const [input, fileStat] = await Promise.all([
    readFile(filePath, "utf8"),
    stat(filePath),
  ]);
  const { metadata, body } = splitFrontmatter(input);
  const fileName = path.basename(filePath);
  const fileDate = safeDate(fileName, fileStat.mtime.toISOString().slice(0, 10));
  const date = safeDate(metadata.report_date, fileDate);
  const sessionDate = safeDate(
    metadata.upcoming_session_date ?? metadata.market_session_date,
    date,
  );
  const sections = splitSections(body);
  const topics = extractTopics(sections);
  const id = `${date}-${session}`;
  const modifiedAt = fileStat.mtime.toISOString();

  const summary = {
    id,
    title: extractTitle(body, date, session),
    date,
    sessionDate,
    session,
    asOf: String(metadata.as_of ?? modifiedAt),
    status: String(metadata.status ?? "complete"),
    summary: findSummary(sections),
    topics,
    tickers: extractTickers(body),
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    sourceCount: countSources(body),
    primarySourceCount: countPrimarySources(body),
    unverifiedCount: countMatches(body, /待核实|待验证假设/g),
    hotspotCount:
      topics.length ||
      countMatches(
        sections.find((section) => /核心热点/.test(section.title))?.markdown ?? "",
        /^###\s+/gm,
      ),
    modifiedAt,
    dataUrl: `/data/reports/${id}.json`,
  };

  return {
    summary,
    detail: {
      ...summary,
      fileName,
      sourcePath: path.relative(vaultRoot, filePath),
      sections,
      markdown: body,
    },
  };
}

await mkdir(reportOutputRoot, { recursive: true });

const discovered = (
  await Promise.all(
    sources.map(async ({ session, directory }) => {
      const files = await listMarkdownFiles(directory);
      return Promise.all(files.map((file) => parseReport(file, session)));
    }),
  )
).flat();

const newestById = new Map();
for (const report of discovered) {
  const existing = newestById.get(report.summary.id);
  if (
    !existing ||
    new Date(report.summary.modifiedAt) > new Date(existing.summary.modifiedAt)
  ) {
    newestById.set(report.summary.id, report);
  }
}

const reports = [...newestById.values()].sort((a, b) => {
  const byDate = b.summary.date.localeCompare(a.summary.date);
  if (byDate !== 0) return byDate;
  return a.summary.session === "post" ? -1 : 1;
});

await Promise.all(
  reports.map(({ summary, detail }) =>
    writeFile(
      path.join(reportOutputRoot, `${summary.id}.json`),
      `${JSON.stringify(detail, null, 2)}\n`,
      "utf8",
    ),
  ),
);

const index = {
  version: 1,
  generatedAt: new Date().toISOString(),
  reportCount: reports.length,
  reports: reports.map(({ summary }) => summary),
};

await writeFile(
  path.join(outputRoot, "index.json"),
  `${JSON.stringify(index, null, 2)}\n`,
  "utf8",
);

console.log(
  `Synced ${reports.length} report(s) from ${vaultRoot} to ${outputRoot}`,
);
