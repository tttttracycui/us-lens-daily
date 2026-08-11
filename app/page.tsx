import type { Metadata } from "next";
import reportIndex from "@/public/data/index.json";
import demoReportIndex from "@/public/demo/index.json";
import { BriefDashboard } from "./components/BriefDashboard";
import type { ReportIndex } from "./lib/report-types";

export const metadata: Metadata = {
  title: { absolute: "US LENS｜美股盘前与盘后热点简报" },
  description:
    "从 Obsidian 自动同步的中文美股盘前、盘后热点简报与历史追踪中心。",
};

export default function Home() {
  const index =
    process.env.PUBLIC_DEMO === "true" ? demoReportIndex : reportIndex;

  return <BriefDashboard index={index as ReportIndex} />;
}
