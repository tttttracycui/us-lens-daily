export type ReportSession = "pre" | "post";

export type ReportStatus = "complete" | "limited" | "draft" | string;

export interface ReportSummary {
  id: string;
  title: string;
  date: string;
  sessionDate: string;
  session: ReportSession;
  asOf: string;
  status: ReportStatus;
  summary: string;
  topics: string[];
  tickers: string[];
  tags: string[];
  sourceCount: number;
  primarySourceCount: number;
  unverifiedCount: number;
  hotspotCount: number;
  modifiedAt: string;
  dataUrl: string;
}

export interface ReportIndex {
  version: number;
  generatedAt: string | null;
  reportCount: number;
  reports: ReportSummary[];
}

export interface ReportSection {
  id: string;
  title: string;
  markdown: string;
}

export interface ReportDetail extends ReportSummary {
  fileName: string;
  sourcePath: string;
  sections: ReportSection[];
  markdown: string;
}
