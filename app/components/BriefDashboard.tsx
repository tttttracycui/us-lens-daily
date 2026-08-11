"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import {
  ArrowSquareOut,
  BookOpenText,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Clock,
  ClockCounterClockwise,
  FileText,
  List,
  MagnifyingGlass,
  Moon,
  ShieldWarning,
  Sun,
  Warning,
  X,
} from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ReportDetail,
  ReportIndex,
  ReportSection,
  ReportSession,
  ReportSummary,
} from "@/app/lib/report-types";

const SESSION_LABEL: Record<ReportSession, string> = {
  pre: "盘前",
  post: "盘后",
};

const SESSION_LONG_LABEL: Record<ReportSession, string> = {
  pre: "盘前观察",
  post: "盘后复盘",
};

const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

function publicUrl(pathname: string) {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${PUBLIC_BASE_PATH}${normalizedPath}`;
}

type SectionKind =
  | "summary"
  | "hotspots"
  | "terms"
  | "watch"
  | "risk"
  | "tomorrow"
  | "default";

interface SectionView extends ReportSection {
  kind: SectionKind;
  anchor: string;
}

type EvidenceKind = "fact" | "view" | "sentiment" | "pending" | "risk";

interface HotspotItem {
  title: string;
  markdown: string;
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatDate(date: string, withYear = true) {
  if (!date) return "日期待同步";
  const value = new Date(date + "T12:00:00");
  return new Intl.DateTimeFormat("zh-CN", {
    ...(withYear ? { year: "numeric" } : {}),
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(value);
}

function formatSyncTime(value: string | null) {
  if (!value) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Hong_Kong",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function getQuerySelection(index: ReportIndex) {
  if (typeof window === "undefined") return index.reports[0]?.id ?? null;
  const id = new URLSearchParams(window.location.search).get("report");
  return index.reports.some((report) => report.id === id)
    ? id
    : (index.reports[0]?.id ?? null);
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return year + " 年 " + Number(month) + " 月";
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function sectionKind(title: string): SectionKind {
  if (/专业术语|专业词汇|小白必懂|术语解释/i.test(title)) return "terms";
  if (/核心热点|热点\s*Top/i.test(title)) return "hotspots";
  if (/继续关注|观察方向|观察池/i.test(title)) return "watch";
  if (/情绪与风险|风险提醒|情绪判断/i.test(title)) return "risk";
  if (/明天继续追踪|明日清单|继续追踪清单|盘中验证清单|验证清单/i.test(title)) {
    return "tomorrow";
  }
  if (/市场总结|盘前总结|今日总结|市场环境/i.test(title)) return "summary";
  return "default";
}

function buildSectionViews(sections: ReportSection[]): SectionView[] {
  const anchors: Record<Exclude<SectionKind, "default">, string> = {
    summary: "market-summary",
    hotspots: "core-hotspots",
    terms: "professional-terms",
    watch: "watch-directions",
    risk: "risk-reminder",
    tomorrow: "tomorrow-list",
  };
  return sections.map((section, index) => {
    const kind = sectionKind(section.title);
    return {
      ...section,
      kind,
      anchor:
        kind === "default"
          ? section.id
          : anchors[kind] + "-" + String(index + 1),
    };
  });
}

function parseHotspots(markdown: string): HotspotItem[] {
  const items: HotspotItem[] = [];
  let title = "";
  let body: string[] = [];

  const flush = () => {
    if (!title) return;
    items.push({ title, markdown: body.join("\n").trim() });
  };

  for (const line of markdown.split("\n")) {
    const heading = line.match(/^###\s+(.+)$/);
    if (heading) {
      flush();
      title = heading[1].trim();
      body = [];
      continue;
    }
    if (title) body.push(line);
  }
  flush();
  return items;
}

function textFromNode(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement(child)) {
        return textFromNode((child.props as { children?: ReactNode }).children);
      }
      return "";
    })
    .join("")
    .trim();
}

function semanticClass(node: ReactNode) {
  const text = textFromNode(node)
    .replace(/^[\-*•\s]+/, "")
    .replace(/^【([^】]+)】/, "$1：");
  if (/^(事实|已确认)(?:$|\s|[:：]|\/)/.test(text)) return "semantic-fact";
  if (/^(市场解读|市场观点|市场理解)(?:$|\s|[:：]|\/)/.test(text)) {
    return "semantic-view";
  }
  if (/^(市场情绪|资金情绪|市场热度|社交热度|情绪信号)(?:$|\s|[:：]|\/)/.test(text)) {
    return "semantic-sentiment";
  }
  if (/^(待核实|待验证|待验证假设)(?:$|\s|[:：]|\/)/.test(text)) {
    return "semantic-pending";
  }
  if (/^(风险提示|风险)(?:$|\s|[:：]|\/)/.test(text)) return "semantic-risk";
  return undefined;
}

function evidenceKindFromMarker(label: string): EvidenceKind {
  if (label === "事实" || label === "已确认") return "fact";
  if (label === "市场解读" || label === "市场观点" || label === "市场理解") {
    return "view";
  }
  if (
    label === "市场情绪" ||
    label === "资金情绪" ||
    label === "市场热度" ||
    label === "社交热度" ||
    label === "情绪信号"
  ) {
    return "sentiment";
  }
  if (label === "待核实" || label === "待验证" || label === "待验证假设") {
    return "pending";
  }
  return "risk";
}

function decorateEvidenceMarkers(node: ReactNode): ReactNode {
  return Children.map(node, (child) => {
    if (typeof child === "string") {
      const matches = Array.from(
        child.matchAll(
          /【(事实|已确认|市场解读|市场观点|市场理解|市场情绪|资金情绪|市场热度|社交热度|情绪信号|待核实|待验证假设|待验证|风险提示|风险)】|^(事实|已确认|市场解读|市场观点|市场理解|市场情绪|资金情绪|市场热度|社交热度|情绪信号|待核实|待验证假设|待验证|风险提示|风险)(?=$|\s|[:：/])/g,
        ),
      );
      if (!matches.length) return child;

      const parts: ReactNode[] = [];
      let cursor = 0;
      for (const match of matches) {
        const start = match.index ?? 0;
        if (start > cursor) parts.push(child.slice(cursor, start));
        const kind = evidenceKindFromMarker(match[1] ?? match[2]);
        parts.push(
          <span
            className={cx("evidence-badge", `is-${kind}`)}
            key={`${start}-${kind}`}
          >
            {match[0]}
          </span>,
        );
        cursor = start + match[0].length;
      }
      if (cursor < child.length) parts.push(child.slice(cursor));
      return parts;
    }

    if (
      isValidElement<{ children?: ReactNode; className?: string }>(child) &&
      child.props.children !== undefined &&
      !child.props.className?.includes("evidence-badge")
    ) {
      return cloneElement(
        child,
        undefined,
        decorateEvidenceMarkers(child.props.children),
      );
    }

    return child;
  });
}

function EvidenceLegend({
  compact = false,
  selected,
  onSelect,
}: {
  compact?: boolean;
  selected?: EvidenceKind | null;
  onSelect?: (value: EvidenceKind | null) => void;
}) {
  const items = [
    {
      className: "fact" as const,
      label: "事实 / 已确认",
      detail: "可追溯的一手或权威来源",
    },
    {
      className: "view" as const,
      label: "市场解读",
      detail: "基于公开信息的合理解释",
    },
    {
      className: "sentiment" as const,
      label: "市场情绪 / 热度",
      detail: "资金拥挤、社交讨论与短线温度",
    },
    {
      className: "pending" as const,
      label: "待核实 / 待验证",
      detail: "仍需公告、订单或财报确认",
    },
    {
      className: "risk" as const,
      label: "风险提示",
      detail: "可能削弱或推翻当前判断",
    },
  ];

  return (
    <section
      className={cx("evidence-legend", compact && "is-compact")}
      aria-label="信息状态说明"
    >
      {items.map((item) => {
        const content = (
          <>
            <span className="legend-line" aria-hidden="true" />
            <span>
              <strong>{item.label}</strong>
              {!compact && <small>{item.detail}</small>}
            </span>
          </>
        );
        return onSelect ? (
          <button
            type="button"
            className={cx(
              "legend-item",
              item.className,
              selected === item.className && "is-selected",
            )}
            key={item.label}
            aria-pressed={selected === item.className}
            onClick={() => onSelect(selected === item.className ? null : item.className)}
          >
            {content}
          </button>
        ) : (
          <div className={cx("legend-item", item.className)} key={item.label}>
            {content}
          </div>
        );
      })}
    </section>
  );
}

interface HistoryProps {
  reports: ReportSummary[];
  selectedId: string | null;
  query: string;
  filter: "all" | ReportSession;
  open: boolean;
  onQuery: (value: string) => void;
  onFilter: (value: "all" | ReportSession) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function HistoryDrawer({
  reports,
  selectedId,
  query,
  filter,
  open,
  onQuery,
  onFilter,
  onSelect,
  onClose,
}: HistoryProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const grouped = useMemo(() => {
    const groups = new Map<string, ReportSummary[]>();
    for (const report of reports) {
      const key = monthKey(report.date);
      groups.set(key, [...(groups.get(key) ?? []), report]);
    }
    return [...groups.entries()];
  }, [reports]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const background = document.querySelectorAll<HTMLElement>(
      ".site-header, .page-main, .mobile-dock",
    );
    background.forEach((element) => element.setAttribute("inert", ""));

    const frame = window.requestAnimationFrame(() => {
      drawerRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      )];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trapFocus);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", trapFocus);
      background.forEach((element) => element.removeAttribute("inert"));
      returnFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="drawer-scrim is-open"
        aria-label="关闭历史记录"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        className="history-drawer is-open"
        id="history-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="历史简报"
      >
        <div className="drawer-header">
          <div>
            <span>US LENS</span>
            <h2>简报历史</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={20} weight="bold" />
          </button>
        </div>

        <label className="search-box">
          <span className="sr-only">搜索简报</span>
          <MagnifyingGlass size={18} />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="搜索热点、公司或 Ticker"
            type="search"
          />
          <kbd>/</kbd>
        </label>

        <div className="session-filter" role="group" aria-label="按报告类型筛选">
          {([
            ["all", "全部"],
            ["pre", "盘前"],
            ["post", "盘后"],
          ] as const).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={filter === value ? "is-active" : ""}
              aria-pressed={filter === value}
              onClick={() => onFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="history-list">
          {grouped.length ? (
            grouped.map(([month, monthReports]) => (
              <section key={month} className="history-month">
                <h3>{monthLabel(month)}</h3>
                <div className="history-items">
                  {monthReports.map((item) => (
                    <button
                      type="button"
                      className={cx("history-item", selectedId === item.id && "is-selected")}
                      key={item.id}
                      onClick={() => onSelect(item.id)}
                      aria-current={selectedId === item.id ? "page" : undefined}
                    >
                      <span className={cx("timeline-node", item.session)} />
                      <span className="history-date">
                        <strong>{formatDate(item.date, false)}</strong>
                        <small>{item.summary || "简报已归档"}</small>
                      </span>
                      <span className={cx("session-mini", item.session)}>
                        {SESSION_LABEL[item.session]}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="no-results">
              <MagnifyingGlass size={24} />
              <strong>没有匹配的简报</strong>
              <small>试试清除搜索或切换报告类型。</small>
            </div>
          )}
        </div>
        <div className="history-footer">
          <span className="sync-dot" />
          报告由 Obsidian 自动同步
        </div>
      </aside>
    </>
  );
}

function ReportOverview({
  report,
  counterpart,
  onSelect,
}: {
  report: ReportDetail;
  counterpart?: ReportSummary;
  onSelect: (id: string) => void;
}) {
  return (
    <header className="report-overview">
      <div className="overview-copy">
        <div className="overview-meta">
          <span className={cx("session-label", report.session)}>
            {SESSION_LONG_LABEL[report.session]}
          </span>
          <span className="meta-divider" />
          <span>{formatDate(report.date)}</span>
        </div>
        <h1>{report.title.replace(/^\d{4}-\d{2}-\d{2}\s*/, "")}</h1>
        {report.summary && (
          <div className="market-thesis">
            <span>今日主线</span>
            <p>{report.summary.replace(/^一句大白话[:：]\s*/, "")}</p>
          </div>
        )}
      </div>
      <aside className="overview-side">
        <div className="overview-side-topline">
          <span className="report-state">
            {report.status === "limited" ? "部分来源受限" : "报告已归档"}
          </span>
          <span>{SESSION_LONG_LABEL[report.session]}</span>
        </div>
        <span className="overview-eyebrow">对应交易时段</span>
        <h2>{formatDate(report.sessionDate, false)}</h2>
        <p className="overview-context">
          {report.session === "pre"
            ? "盘前信息用于建立今日观察框架，开盘后仍需逐项验证。"
            : "盘后信息用于复盘已经发生的变化，并为下一交易日保留验证清单。"}
        </p>
        <div className="overview-actions">
          <span>
            <Clock size={16} />
            信息截止 {report.asOf}
          </span>
          {counterpart ? (
            <button type="button" onClick={() => onSelect(counterpart.id)}>
              查看同日{SESSION_LABEL[counterpart.session]}
              <CaretRight size={15} weight="bold" />
            </button>
          ) : (
            <small>同日另一份简报尚未生成</small>
          )}
        </div>
      </aside>
    </header>
  );
}

function ReportStatusStrip({ report }: { report: ReportDetail }) {
  const items = [
    {
      label: "核心热点",
      value: report.hotspotCount ? String(report.hotspotCount).padStart(2, "0") : "—",
      note: "按证据强弱排序",
    },
    {
      label: "来源线索",
      value: String(report.sourceCount).padStart(2, "0"),
      note: "一手来源 " + report.primarySourceCount,
    },
    {
      label: "待核实",
      value: String(report.unverifiedCount).padStart(2, "0"),
      note: report.unverifiedCount ? "保留判断余地" : "当前未标出",
      className: report.unverifiedCount ? "pending" : undefined,
    },
    {
      label: "覆盖公司",
      value: String(report.tickers.length).padStart(2, "0"),
      note: "仅作产业链定位",
    },
  ];

  return (
    <section className="report-status-strip" aria-label="本期简报状态">
      {items.map((item) => (
        <div className={item.className} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.note}</small>
        </div>
      ))}
    </section>
  );
}

function SafeLink({
  href,
  children,
  ...props
}: ComponentPropsWithoutRef<"a">) {
  return (
    <a {...props} href={href} target="_blank" rel="noreferrer">
      {children}
      <ArrowSquareOut size={13} weight="bold" aria-hidden="true" />
    </a>
  );
}

function HotspotExplorer({
  section,
  selectedIndex,
  onSelect,
}: {
  section: SectionView;
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const items = useMemo(() => parseHotspots(section.markdown), [section.markdown]);
  const [showAll, setShowAll] = useState(false);
  const safeIndex = Math.min(Math.max(selectedIndex, 0), Math.max(items.length - 1, 0));
  const selected = items[safeIndex];

  if (!items.length) return <ReportSectionCard section={section} />;

  const move = (offset: number) => {
    onSelect((safeIndex + offset + items.length) % items.length);
  };

  const focusTab = (index: number) => {
    onSelect(index);
    window.requestAnimationFrame(() => {
      document.getElementById(`${section.anchor}-hotspot-tab-${index}`)?.focus();
    });
  };

  const handleTabKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % items.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + items.length) % items.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = items.length - 1;
    }
    if (next === null) return;
    event.preventDefault();
    focusTab(next);
  };

  return (
    <section className="hotspot-explorer" id={section.anchor}>
      <header className="hotspot-explorer-heading">
        <div>
          <span className="section-kicker">MARKET RADAR</span>
          <h2>今日核心热点 <strong>Top {items.length}</strong></h2>
          <p>点击左侧热点切换深读，事实、影响、验证点与风险保持在同一视线内。</p>
        </div>
        <button
          type="button"
          className="view-mode-button"
          onClick={() => setShowAll((value) => !value)}
          aria-pressed={showAll}
        >
          {showAll ? "回到逐条阅读" : "展开全部热点"}
        </button>
      </header>

      {showAll ? (
        <div className="hotspot-all">
          {items.map((item, index) => (
            <article className="hotspot-full-item" key={item.title}>
              <div className="hotspot-full-title">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{item.title}</h3>
              </div>
              <div className="markdown-body hotspot-markdown">
                <MarkdownContent markdown={item.markdown} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="hotspot-workspace">
          <nav className="hotspot-tabs" aria-label="核心热点" role="tablist">
            {items.map((item, index) => (
              <button
                type="button"
                role="tab"
                key={item.title}
                id={`${section.anchor}-hotspot-tab-${index}`}
                aria-controls={`${section.anchor}-hotspot-panel`}
                aria-selected={safeIndex === index}
                tabIndex={safeIndex === index ? 0 : -1}
                className={safeIndex === index ? "is-active" : ""}
                onClick={() => onSelect(index)}
                onKeyDown={(event) => handleTabKey(event, index)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.title.replace(/^\d+[）).、]\s*/, "")}</strong>
                <CaretRight size={16} weight="bold" aria-hidden="true" />
              </button>
            ))}
          </nav>

          <article
            className="hotspot-stage"
            role="tabpanel"
            id={`${section.anchor}-hotspot-panel`}
            aria-labelledby={`${section.anchor}-hotspot-tab-${safeIndex}`}
            aria-live="polite"
          >
            <div className="hotspot-stage-topline">
              <span>热点 {String(safeIndex + 1).padStart(2, "0")} / {items.length}</span>
              <div className="hotspot-pager">
                <button type="button" onClick={() => move(-1)} aria-label="上一条热点">
                  <CaretLeft size={18} weight="bold" />
                </button>
                <button type="button" onClick={() => move(1)} aria-label="下一条热点">
                  <CaretRight size={18} weight="bold" />
                </button>
              </div>
            </div>
            <h3>{selected.title.replace(/^\d+[）).、]\s*/, "")}</h3>
            <div className="markdown-body hotspot-markdown">
              <MarkdownContent markdown={selected.markdown} />
            </div>
          </article>
        </div>
      )}
    </section>
  );
}

function MarkdownContent({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: SafeLink,
        h2: ({ children }) => (
          <h3 className={semanticClass(children)}>{decorateEvidenceMarkers(children)}</h3>
        ),
        h3: ({ children }) => (
          <h3 className={semanticClass(children)}>{decorateEvidenceMarkers(children)}</h3>
        ),
        h4: ({ children }) => (
          <h4 className={semanticClass(children)}>{decorateEvidenceMarkers(children)}</h4>
        ),
        p: ({ children }) => (
          <p className={semanticClass(children)}>{decorateEvidenceMarkers(children)}</p>
        ),
        li: ({ children }) => (
          <li className={semanticClass(children)}>{decorateEvidenceMarkers(children)}</li>
        ),
        blockquote: ({ children }) => (
          <blockquote className={semanticClass(children)}>
            {decorateEvidenceMarkers(children)}
          </blockquote>
        ),
        tr: ({ children }) => (
          <tr className={semanticClass(children)}>{decorateEvidenceMarkers(children)}</tr>
        ),
        th: ({ children }) => (
          <th className={semanticClass(children)}>{decorateEvidenceMarkers(children)}</th>
        ),
        td: ({ children }) => (
          <td className={semanticClass(children)}>{decorateEvidenceMarkers(children)}</td>
        ),
        table: ({ children }) => (
          <div className="table-scroll">
            <table>{children}</table>
          </div>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}

function ReportSectionCard({ section }: { section: SectionView }) {
  const visibleTitle = section.kind === "terms" ? "专业术语解释" : section.title;
  return (
    <section
      className={cx("report-section", "section-" + section.kind)}
      id={section.anchor}
    >
      <div className="section-heading">
        <h2>{visibleTitle}</h2>
      </div>
      <div className="markdown-body">
        <MarkdownContent markdown={section.markdown} />
      </div>
    </section>
  );
}

function ReportContent({
  sections,
  onJump,
  activeSection,
  selectedHotspot,
  onSelectHotspot,
}: {
  sections: SectionView[];
  onJump: (id: string) => void;
  activeSection: string;
  selectedHotspot: number;
  onSelectHotspot: (index: number) => void;
}) {
  const closing = sections.filter(
    (section) => section.kind === "risk" || section.kind === "tomorrow",
  );
  const primary = sections.filter(
    (section) => section.kind !== "risk" && section.kind !== "tomorrow",
  );
  const active = sections.find((section) => section.anchor === activeSection) ?? sections[0];

  return (
    <>
      <div className="report-reading-shell">
        <nav className="section-jumpbar" aria-label="本期章节">
          <div className="jumpbar-current" aria-live="polite">
            <List size={18} weight="bold" aria-hidden="true" />
            <span>当前章节</span>
            <strong>{active?.kind === "terms" ? "专业术语解释" : active?.title}</strong>
          </div>
          <ol>
            {sections.map((section, index) => (
              <li key={section.anchor}>
                <button
                  type="button"
                  className={activeSection === section.anchor ? "is-active" : ""}
                  aria-current={activeSection === section.anchor ? "location" : undefined}
                  onClick={() => onJump(section.anchor)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {section.kind === "terms" ? "专业术语解释" : section.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <article className="report-flow">
          {primary.map((section) =>
            section.kind === "hotspots" ? (
              <HotspotExplorer
                section={section}
                selectedIndex={selectedHotspot}
                onSelect={onSelectHotspot}
                key={`${section.anchor}-${section.markdown.length}`}
              />
            ) : (
              <ReportSectionCard section={section} key={section.anchor} />
            ),
          )}
        </article>
      </div>
      {!!closing.length && (
        <div className={cx("closing-grid", closing.length === 1 && "is-single")}>
          {closing.map((section) => (
            <ReportSectionCard section={section} key={section.anchor} />
          ))}
        </div>
      )}
    </>
  );
}

function EmptyReport() {
  return (
    <main className="page-main empty-page" id="main-content">
      <section className="empty-overview">
        <div>
          <span className="session-label pre">自动同步已就绪</span>
          <h1>等待第一份美股简报</h1>
          <p>
            当前 Obsidian 目录还没有正式盘前或盘后报告。定时任务完成后，
            今日摘要、核心热点、证据分层和历史记录会自动出现在这里。
          </p>
        </div>
        <FileText size={54} weight="thin" aria-hidden="true" />
      </section>

      <section className="empty-schedule" aria-label="简报更新时间">
        <div>
          <CalendarBlank size={22} />
          <span>
            <small>每日 20:30 HKT</small>
            <strong>盘前观察</strong>
            <p>开盘前的产业线索、政策事件和待验证信号。</p>
          </span>
        </div>
        <div>
          <ClockCounterClockwise size={22} />
          <span>
            <small>每日 08:00 HKT</small>
            <strong>盘后复盘</strong>
            <p>最近交易日的事实、市场解读和风险变化。</p>
          </span>
        </div>
      </section>

      <EvidenceLegend />

      <section className="empty-flow" aria-label="自动同步流程">
        <span><BookOpenText size={18} />Obsidian Markdown</span>
        <CaretRight size={16} />
        <span><List size={18} />历史索引</span>
        <CaretRight size={16} />
        <span><CheckCircle size={18} />同一网页自动更新</span>
      </section>
      <p className="empty-boundary">相关公司仅作产业链信息参考，不构成投资建议。</p>
    </main>
  );
}

function LoadingReport() {
  return (
    <main className="page-main" id="main-content" aria-busy="true">
      <div className="loading-shell" role="status">
        <span className="sr-only">正在读取简报</span>
        <div className="loading-hero" />
        <div className="loading-row" />
        <div className="loading-panel" />
      </div>
    </main>
  );
}

export function BriefDashboard({ index }: { index: ReportIndex }) {
  const [selectedId, setSelectedId] = useState<string | null>(
    index.reports[0]?.id ?? null,
  );
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(index.reports.length));
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | ReportSession>("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceKind | null>(null);
  const [selectedHotspot, setSelectedHotspot] = useState(0);
  const [activeSection, setActiveSection] = useState("");
  const [readingProgress, setReadingProgress] = useState(0);

  const filteredReports = useMemo(() => {
    const needle = normalizeText(query);
    return index.reports.filter((item) => {
      if (filter !== "all" && item.session !== filter) return false;
      if (!needle) return true;
      return normalizeText(
        [
          item.title,
          item.summary,
          item.date,
          ...item.topics,
          ...item.tickers,
          ...item.tags,
        ].join(" "),
      ).includes(needle);
    });
  }, [filter, index.reports, query]);

  const selectedSummary = useMemo(
    () => index.reports.find((item) => item.id === selectedId),
    [index.reports, selectedId],
  );

  const counterpart = useMemo(
    () => {
      if (!report) return undefined;
      return (
        index.reports.find(
          (item) =>
            item.sessionDate === report.sessionDate && item.session !== report.session,
        ) ??
        index.reports.find(
          (item) => item.date === report.date && item.session !== report.session,
        )
      );
    },
    [index.reports, report],
  );

  const sectionViews = useMemo(
    () => (report ? buildSectionViews(report.sections) : []),
    [report],
  );

  const selectReport = useCallback((id: string) => {
    setLoading(true);
    setError(null);
    setSelectedHotspot(0);
    setSelectedEvidence(null);
    setSelectedId(id);
    setDrawerOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set("report", id);
    window.history.pushState({}, "", url);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setSelectedId(getQuerySelection(index));
      const stored = window.localStorage.getItem("us-lens-theme");
      const preferred =
        stored === "dark" ||
        (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches)
          ? "dark"
          : "light";
      setTheme(preferred);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [index]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("us-lens-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!selectedSummary) return;
    const controller = new AbortController();
    const reportUrl = new URL(
      publicUrl(selectedSummary.dataUrl),
      window.location.origin,
    );
    if (index.generatedAt) {
      reportUrl.searchParams.set("v", index.generatedAt);
    }
    fetch(reportUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json() as Promise<ReportDetail>;
      })
      .then((value) => {
        setReport(value);
        setLoading(false);
      })
      .catch((reason: Error) => {
        if (reason.name === "AbortError") return;
        setError("本期正文暂时读取失败，上一版线上内容不会被覆盖。");
        setLoading(false);
      });
    return () => controller.abort();
  }, [index.generatedAt, reloadToken, selectedSummary]);

  useEffect(() => {
    const onPopState = () => setSelectedId(getQuerySelection(index));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [index]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drawerOpen) {
        event.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (
        event.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        event.preventDefault();
        setDrawerOpen(true);
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>(".search-box input")?.focus();
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  useEffect(() => {
    if (!sectionViews.length) return;
    let frame = 0;
    const updateReadingState = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const marker = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--header-height"),
        ) + 96;
        let current = sectionViews[0].anchor;
        for (const section of sectionViews) {
          const element = document.getElementById(section.anchor);
          if (element && element.getBoundingClientRect().top <= marker) current = section.anchor;
        }
        setActiveSection(current);
        const available = document.documentElement.scrollHeight - window.innerHeight;
        setReadingProgress(available > 0 ? Math.min(100, (window.scrollY / available) * 100) : 0);
      });
    };
    updateReadingState();
    window.addEventListener("scroll", updateReadingState, { passive: true });
    window.addEventListener("resize", updateReadingState);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateReadingState);
      window.removeEventListener("resize", updateReadingState);
    };
  }, [sectionViews]);

  const jumpTo = (id: string) => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  };

  const navKinds: Array<{ kind: SectionKind; label: string }> = [
    { kind: "summary", label: "市场环境" },
    { kind: "hotspots", label: "核心热点" },
    { kind: "terms", label: "专业术语解释" },
    { kind: "watch", label: "观察方向" },
    { kind: "tomorrow", label: "验证清单" },
  ];

  return (
    <div
      className="app-shell"
      data-evidence-focus={selectedEvidence ?? undefined}
    >
      <a href="#main-content" className="skip-link">跳到正文</a>
      <header className="site-header">
        <div className="site-nav">
          <button className="wordmark" type="button" onClick={() => window.scrollTo({ top: 0 })}>
            US LENS
          </button>
          <nav className="primary-nav" aria-label="报告章节">
            {navKinds.map((item) => {
              const target = sectionViews.find((section) => section.kind === item.kind);
              return (
                <button
                  type="button"
                  key={item.kind}
                  disabled={!target}
                  className={target?.anchor === activeSection ? "is-active" : ""}
                  aria-current={target?.anchor === activeSection ? "location" : undefined}
                  onClick={() => target && jumpTo(target.anchor)}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="nav-actions">
            <div className="session-switch" aria-label="盘前盘后切换">
              {(["pre", "post"] as const).map((session) => {
                const target =
                  report?.session === session
                    ? report
                    : counterpart?.session === session
                      ? counterpart
                      : undefined;
                return (
                  <button
                    type="button"
                    key={session}
                    disabled={!target}
                    className={report?.session === session ? "is-active" : ""}
                    onClick={() => target && selectReport(target.id)}
                  >
                    {SESSION_LABEL[session]}
                  </button>
                );
              })}
            </div>
            <button
              className="nav-icon-button history-button"
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="查看历史简报"
              aria-expanded={drawerOpen}
              aria-controls="history-drawer"
            >
              <ClockCounterClockwise size={19} />
              <span>历史</span>
            </button>
            <button
              className="nav-icon-button"
              type="button"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              aria-label={theme === "light" ? "切换到深色模式" : "切换到浅色模式"}
            >
              {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
            </button>
          </div>
        </div>
        <progress
          className="reading-progress"
          max={100}
          value={readingProgress}
          aria-label="报告阅读进度"
        />
      </header>

      <HistoryDrawer
        reports={filteredReports}
        selectedId={selectedId}
        query={query}
        filter={filter}
        open={drawerOpen}
        onQuery={setQuery}
        onFilter={setFilter}
        onSelect={selectReport}
        onClose={() => setDrawerOpen(false)}
      />

      {!index.reports.length ? (
        <EmptyReport />
      ) : loading ? (
        <LoadingReport />
      ) : error ? (
        <main className="page-main error-page" id="main-content">
          <section className="error-state">
            <Warning size={28} />
            <h1>正文暂时没有加载出来</h1>
            <p>{error}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setError(null);
                setReloadToken((value) => value + 1);
              }}
            >
              重新读取
            </button>
          </section>
        </main>
      ) : report ? (
        <main className="page-main" id="main-content">
          <ReportOverview report={report} counterpart={counterpart} onSelect={selectReport} />
          <ReportStatusStrip report={report} />
          <div className="evidence-control">
            <div>
              <span>证据图例</span>
              <p>点击任一状态，可在全文中突出显示对应内容。</p>
            </div>
            <EvidenceLegend selected={selectedEvidence} onSelect={setSelectedEvidence} />
          </div>
          <ReportContent
            sections={sectionViews}
            onJump={jumpTo}
            activeSection={activeSection}
            selectedHotspot={selectedHotspot}
            onSelectHotspot={setSelectedHotspot}
          />
          <footer className="site-disclaimer">
            <ShieldWarning size={22} />
            <p>
              <strong>研究边界</strong>
              本简报只做信息整理、专业术语解释与风险提示。相关公司仅作产业链信息参考，
              不构成投资建议，也不代表收益承诺。
            </p>
            <span>最近同步 {formatSyncTime(index.generatedAt)} HKT</span>
          </footer>
        </main>
      ) : (
        <EmptyReport />
      )}

      <div className="mobile-dock" aria-label="移动端快捷操作">
        <button
          type="button"
          onClick={() => {
            const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            document.querySelector<HTMLElement>(".section-jumpbar")?.scrollIntoView({
              behavior: reduceMotion ? "auto" : "smooth",
              block: "start",
            });
          }}
        >
          <List size={18} />章节
        </button>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
          aria-controls="history-drawer"
        >
          <ClockCounterClockwise size={18} />历史
        </button>
        <button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
          {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}主题
        </button>
      </div>
    </div>
  );
}
