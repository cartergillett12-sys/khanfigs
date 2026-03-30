"use client";

import React from "react";
import {
  getActionFamily,
  getInterventionLabel,
  loadBanditState,
  makeSiteBanditSegment,
  recommendThompsonArm,
  saveBanditState,
  syncBanditWithSimulator,
  type BanditRewardMap,
  type InterventionArm,
  type SiteBanditFeatures,
} from "../../lib/adops/bandit";

const theme = {
  bg: "#F6F8FC",
  panel: "#FFFFFF",
  panelSoft: "#F1F5FF",
  border: "#D9E2F2",
  text: "#0F172A",
  muted: "#475569",
  faint: "#64748B",
  ok: "#16A34A",
  warn: "#D97706",
  fail: "#DC2626",
  accent: "#0EA5A6",
  accentSoft: "#E6FFFB",
  accentBorder: "#99F6E4",
  overlay: "rgba(15, 23, 42, 0.35)",
};

type Severity = "ok" | "warn" | "fail";
type HealthStatus = "healthy" | "warning" | "error";
type TabKey = "overview" | "health" | "sites" | "adUnits" | "configs";
type DrawerTabKey = "explorer" | "vendors" | "simulator" | "bandit" | "config";
type SimulatorScenario =
  | "addVendor"
  | "removeVendor"
  | "addMissingAdUnits"
  | "remapConfig";
type SiteRankingMode =
  | "investmentPriority"
  | "opportunity"
  | "projectedReturn"
  | "banditScore"
  | "confidence"
  | "inventoryGap"
  | "risk"
  | "quickWins";

type HealthReport = {
  overall: Severity;
  generatedAtIso: string;
  summary: {
    configsFound: number;
    configsParsed: number;
    csvSitesRows: number;
    csvAdUnitsRows: number;
  };
  convert: {
    ran: boolean;
    exitCode: number | null;
    stdoutTail: string[];
    stderrTail: string[];
  };
  issues: Array<{
    severity: Severity;
    source: "csv" | "config" | "convert";
    file: string;
    where?: string;
    message: string;
    openUrl?: string;
  }>;
};

type SiteRow = {
  site: string;
  publisher?: string;
  expectedAdUnits: number;
  actualAdUnits: number;
  configFile?: string;
  usesInMobi: boolean;
  vendors: string[];
  status: HealthStatus;
  warnings: string[];
};

type AdUnitRow = {
  adUnitName: string;
  site: string;
  size?: string;
  vendors: string[];
  gamAdUnit?: string;
  matchedConfig?: string;
  status: HealthStatus;
  warnings: string[];
};

type ConfigRow = {
  fileName: string;
  domain: string;
  host?: string;
  plugins: string[];
  usesInMobi: boolean;
  usesAnyclip: boolean;
  vendorFlags: Record<string, boolean>;
  tagNames: string[];
  gamAdUnits: string[];
  lastModified: string | null;
  healthStatus?: HealthStatus;
  healthWarningCount?: number;
  healthErrorCount?: number;
  healthIssues?: string[];
};

type AdOpsData = {
  summary: {
    totalSites: number;
    totalAdUnits: number;
    totalConfigs: number;
    sitesUsingInMobi: number;
    warnings: number;
    errors: number;
    healthWarnings: number;
    healthErrors: number;
    lastUpdated: string;
  };
  sites: SiteRow[];
  adUnits: AdUnitRow[];
  configs: ConfigRow[];
};

type SiteMetrics = {
  configHealth: HealthStatus;
  configHealthErrors: number;
  configHealthWarnings: number;
  configHealthIssues: string[];
  configVendors: string[];
  adUnitVendors: string[];
  inferredVendors: string[];
  adUnitVendorSummary: Array<{ vendor: string; count: number }>;
  inventoryGap: number;
  riskScore: number;
  opportunityScore: number;
  complexityScore: number;
  coverageScore: number;
  projectedReturnScore: number;
  insights: string[];
  recommendations: string[];
};

type RankedSiteRow = {
  site: SiteRow;
  metrics: SiteMetrics;
  recommendation: {
    arm: InterventionArm;
    score: number;
    posteriorMean: number;
    confidence: number;
    reason: string;
    segment: string;
  } | null;
  bestReward: number;
  priorityScore: number;
  why: string;
  headline: string;
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function formatModeLabel(mode: SiteRankingMode): string {
  switch (mode) {
    case "investmentPriority":
      return "Highest Investment Priority";
    case "opportunity":
      return "Highest Opportunity";
    case "projectedReturn":
      return "Highest Projected Return";
    case "banditScore":
      return "Highest Bandit Score";
    case "confidence":
      return "Highest Confidence";
    case "inventoryGap":
      return "Biggest Inventory Gap";
    case "risk":
      return "Highest Risk";
    case "quickWins":
      return "Quick Wins";
    default:
      return "Site Investment Priority";
  }
}

function formatPercentFromUnit(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function scoreBanditOutcome(params: {
  risk: number;
  opportunity: number;
  coverage: number;
  complexity: number;
  projectedReturn: number;
}): number {
  const value =
    params.projectedReturn * 0.42 +
    params.coverage * 0.24 +
    params.opportunity * 0.18 +
    (100 - params.risk) * 0.16 -
    params.complexity * 0.08;

  return value;
}

function scoreSiteForMode(params: {
  mode: SiteRankingMode;
  metrics: SiteMetrics;
  recommendation: RankedSiteRow["recommendation"];
  bestReward: number;
}): number {
  const { mode, metrics, recommendation, bestReward } = params;
  const score = recommendation?.score ?? 0;
  const posteriorMean = recommendation?.posteriorMean ?? 0;
  const confidence = recommendation?.confidence ?? 0;
  const coverageLiftPotential = Math.max(0, 100 - metrics.coverageScore);
  const inventoryGapAbs = Math.max(0, -metrics.inventoryGap);

  if (mode === "investmentPriority") {
    return (
      metrics.projectedReturnScore * 0.28 +
      metrics.opportunityScore * 0.24 +
      bestReward * 100 * 0.18 +
      posteriorMean * 100 * 0.08 +
      confidence * 100 * 0.12 +
      coverageLiftPotential * 0.08 +
      inventoryGapAbs * 3 -
      metrics.riskScore * 0.12 -
      metrics.complexityScore * 0.04 -
      metrics.configHealthErrors * 6 -
      metrics.configHealthWarnings * 2.5
    );
  }

  if (mode === "opportunity") {
    return (
      metrics.opportunityScore * 0.56 +
      inventoryGapAbs * 8 +
      coverageLiftPotential * 0.22 +
      bestReward * 100 * 0.12
    );
  }

  if (mode === "projectedReturn") {
    return (
      metrics.projectedReturnScore * 0.72 +
      posteriorMean * 100 * 0.18 +
      confidence * 100 * 0.1
    );
  }

  if (mode === "banditScore") {
    return score * 52 + posteriorMean * 28 + confidence * 20;
  }

  if (mode === "confidence") {
    return confidence * 100 + posteriorMean * 15;
  }

  if (mode === "inventoryGap") {
    return inventoryGapAbs * 20 + coverageLiftPotential * 0.35 + metrics.opportunityScore * 0.15;
  }

  if (mode === "risk") {
    return (
      metrics.riskScore * 0.72 +
      metrics.configHealthErrors * 10 +
      metrics.configHealthWarnings * 4 +
      inventoryGapAbs * 6
    );
  }

  return (
    metrics.projectedReturnScore * 0.28 +
    metrics.opportunityScore * 0.24 +
    confidence * 100 * 0.2 +
    (100 - metrics.riskScore) * 0.18 +
    (100 - metrics.complexityScore) * 0.1
  );
}

function buildWhyLabel(params: {
  mode: SiteRankingMode;
  metrics: SiteMetrics;
  recommendation: RankedSiteRow["recommendation"];
  bestReward: number;
}): { headline: string; why: string } {
  const { mode, metrics, recommendation, bestReward } = params;
  const action = recommendation ? getInterventionLabel(recommendation.arm) : "Review site manually";
  const confidenceText = formatPercentFromUnit(recommendation?.confidence ?? 0);

  if (mode === "investmentPriority") {
    return {
      headline: "Strong upside with a clear next move",
      why: `High upside blend: ${metrics.opportunityScore}/100 opportunity, ${metrics.projectedReturnScore}/100 projected return, best simulated reward ${bestReward.toFixed(3)}, and ${confidenceText} confidence. Best next action: ${action}.`,
    };
  }

  if (mode === "opportunity") {
    return {
      headline: metrics.inventoryGap < 0 ? "Expansion room is visible" : "Upside signal is elevated",
      why:
        metrics.inventoryGap < 0
          ? `This site is missing ${Math.abs(metrics.inventoryGap)} expected ad unit${Math.abs(metrics.inventoryGap) === 1 ? "" : "s"}, which suggests room to expand coverage and monetization structure.`
          : `Opportunity score is ${metrics.opportunityScore}/100 and the bandit still sees meaningful upside via ${action}.`,
    };
  }

  if (mode === "projectedReturn") {
    return {
      headline: "Modeled return is leading",
      why: `Projected return is ${metrics.projectedReturnScore}/100, backed by a posterior mean of ${(recommendation?.posteriorMean ?? 0).toFixed(3)} and best reward ${bestReward.toFixed(3)}.`,
    };
  }

  if (mode === "banditScore") {
    return {
      headline: "Bandit recommendation is strong",
      why: `Top adaptive recommendation is ${action} with Thompson score ${(recommendation?.score ?? 0).toFixed(3)}, posterior mean ${(recommendation?.posteriorMean ?? 0).toFixed(3)}, and confidence ${confidenceText}.`,
    };
  }

  if (mode === "confidence") {
    return {
      headline: "Recommendation looks relatively stable",
      why: `Confidence is ${confidenceText}, which makes this site a stronger candidate for acting on the current recommendation: ${action}.`,
    };
  }

  if (mode === "inventoryGap") {
    return {
      headline: "Coverage gap deserves attention",
      why:
        metrics.inventoryGap < 0
          ? `There is an inventory gap of ${Math.abs(metrics.inventoryGap)}. Closing missing ad units could directly lift coverage from ${metrics.coverageScore}/100.`
          : `Coverage is not full at ${metrics.coverageScore}/100, so there may still be structural cleanup worth doing.`,
    };
  }

  if (mode === "risk") {
    return {
      headline: "Operational risk is elevated",
      why: `Risk score is ${metrics.riskScore}/100 with ${metrics.configHealthErrors} config error(s) and ${metrics.configHealthWarnings} warning(s). This site may need stabilization before expansion.`,
    };
  }

  return {
    headline: "Looks like a quick win",
    why: `This site combines good return potential with lower relative risk and manageable complexity. Recommendation confidence is ${confidenceText}.`,
  };
}

function StatusPill({ sev }: { sev: Severity }) {
  const style: Record<Severity, React.CSSProperties> = {
    ok: { background: "#DCFCE7", color: "#14532D", border: "1px solid #86EFAC" },
    warn: { background: "#FFFBEB", color: "#78350F", border: "1px solid #FCD34D" },
    fail: { background: "#FEF2F2", color: "#7F1D1D", border: "1px solid #FCA5A5" },
  };

  return (
    <span
      style={{
        ...style[sev],
        padding: "6px 12px",
        borderRadius: 999,
        fontWeight: 800,
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      {sev === "ok" ? "Healthy" : sev === "warn" ? "Degraded" : "Broken"}
    </span>
  );
}

function HealthStatusPill({ status }: { status: HealthStatus }) {
  const style =
    status === "healthy"
      ? { background: "#DCFCE7", color: "#14532D", border: "1px solid #86EFAC" }
      : status === "warning"
        ? { background: "#FFFBEB", color: "#78350F", border: "1px solid #FCD34D" }
        : { background: "#FEF2F2", color: "#7F1D1D", border: "1px solid #FCA5A5" };

  return (
    <span
      style={{
        ...style,
        padding: "6px 12px",
        borderRadius: 999,
        fontWeight: 800,
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      {status}
    </span>
  );
}

function Panel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 16,
        border: `1px solid ${theme.border}`,
        background: theme.panel,
        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string | number;
  helper?: string;
}) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 16,
        border: `1px solid ${theme.border}`,
        background: theme.panel,
        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div style={{ color: theme.muted, fontWeight: 700, fontSize: 14 }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 30, fontWeight: 900, color: theme.text }}>
        {value}
      </div>
      {helper ? <div style={{ marginTop: 6, color: theme.faint, fontSize: 12 }}>{helper}</div> : null}
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 14px",
        borderRadius: 12,
        border: active ? `1px solid ${theme.accentBorder}` : `1px solid ${theme.border}`,
        background: active ? theme.accentSoft : "#FFF",
        color: active ? "#0F766E" : theme.text,
        fontWeight: 900,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function DrawerSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 14,
        background: "#FFF",
        border: `1px solid ${theme.border}`,
      }}
    >
      <div style={{ fontWeight: 900, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function ScoreBar({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const pct = clamp(value);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 800 }}>{label}</div>
        <div style={{ color: theme.muted }}>{pct}/100</div>
      </div>
      <div
        style={{
          height: 10,
          borderRadius: 999,
          background: "#E5EAF5",
          overflow: "hidden",
          border: `1px solid ${theme.border}`,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: pct >= 70 ? "#0EA5A6" : pct >= 40 ? "#F59E0B" : "#94A3B8",
          }}
        />
      </div>
    </div>
  );
}

function computeSiteMetrics(
  site: SiteRow,
  adUnits: AdUnitRow[],
  config: ConfigRow | null
): SiteMetrics {
  const configVendors = uniq([
    ...(config?.plugins ?? []),
    ...Object.entries(config?.vendorFlags ?? {})
      .filter(([, enabled]) => enabled)
      .map(([vendor]) => vendor),
  ]);

  const vendorMap = new Map<string, number>();
  for (const adUnit of adUnits) {
    for (const vendor of adUnit.vendors) {
      vendorMap.set(vendor, (vendorMap.get(vendor) ?? 0) + 1);
    }
  }

  const adUnitVendorSummary = Array.from(vendorMap.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([vendor, count]) => ({ vendor, count }));

  const adUnitVendors = adUnitVendorSummary.map((v) => v.vendor);
  const inferredVendors = uniq([...configVendors, ...adUnitVendors]);

  const inventoryGap = site.actualAdUnits - site.expectedAdUnits;
  const configHealthErrors = config?.healthErrorCount ?? 0;
  const configHealthWarnings = config?.healthWarningCount ?? 0;
  const configHealth: HealthStatus =
    config?.healthStatus ??
    (configHealthErrors > 0 ? "error" : configHealthWarnings > 0 ? "warning" : "healthy");

  let riskScore = 0;
  let opportunityScore = 0;
  let complexityScore = 0;

  if (!site.configFile) riskScore += 35;
  if (site.status === "error") riskScore += 25;
  if (configHealthErrors > 0) riskScore += Math.min(25, configHealthErrors * 8);
  if (configHealthWarnings > 0) riskScore += Math.min(15, configHealthWarnings * 3);
  if (inventoryGap < 0) riskScore += Math.min(20, Math.abs(inventoryGap) * 5);
  if (adUnitVendors.length <= 1 && site.actualAdUnits > 0) riskScore += 10;

  if (inventoryGap < 0) opportunityScore += Math.min(30, Math.abs(inventoryGap) * 8);
  if (adUnitVendors.length <= 2 && site.actualAdUnits > 0) opportunityScore += 20;
  if (configVendors.length < adUnitVendors.length) opportunityScore += 15;
  if (!site.usesInMobi && adUnitVendors.length > 0) opportunityScore += 8;

  complexityScore += Math.min(40, inferredVendors.length * 5);
  complexityScore += Math.min(30, site.actualAdUnits * 2);

  const coverageScore =
    site.expectedAdUnits > 0
      ? clamp(Math.round((site.actualAdUnits / site.expectedAdUnits) * 100))
      : site.actualAdUnits > 0
        ? 100
        : 0;

  riskScore = clamp(riskScore);
  opportunityScore = clamp(opportunityScore);
  complexityScore = clamp(complexityScore);

  const projectedReturnScore = clamp(
    Math.round(opportunityScore * 0.55 + coverageScore * 0.3 + inferredVendors.length * 3)
  );

  const insights: string[] = [];
  const recommendations: string[] = [];

  if (!site.configFile) {
    insights.push("No config file is matched to this site.");
    recommendations.push("Map or add a config for this site.");
  }

  if (inventoryGap < 0) {
    insights.push(
      `Inventory gap detected: ${Math.abs(inventoryGap)} expected ad unit${Math.abs(inventoryGap) === 1 ? "" : "s"} are missing.`
    );
    recommendations.push("Review missing ad units, config tags, or CSV mapping.");
  }

  if (configHealthErrors > 0) {
    insights.push(`Config health shows ${configHealthErrors} error(s).`);
    recommendations.push("Fix config errors before expanding monetization.");
  }

  if (adUnitVendors.length <= 2 && site.actualAdUnits > 0) {
    insights.push("Vendor diversification appears limited.");
    recommendations.push("Test an additional vendor on this site.");
  }

  return {
    configHealth,
    configHealthErrors,
    configHealthWarnings,
    configHealthIssues: config?.healthIssues ?? [],
    configVendors,
    adUnitVendors,
    inferredVendors,
    adUnitVendorSummary,
    inventoryGap,
    riskScore,
    opportunityScore,
    complexityScore,
    coverageScore,
    projectedReturnScore,
    insights,
    recommendations,
  };
}

function simulateScenario(
  metrics: SiteMetrics,
  scenario: SimulatorScenario,
  selectedVendor: string
) {
  let risk = metrics.riskScore;
  let opportunity = metrics.opportunityScore;
  let complexity = metrics.complexityScore;
  let coverage = metrics.coverageScore;
  let projectedReturn = metrics.projectedReturnScore;
  const notes: string[] = [];

  if (scenario === "addVendor") {
    risk = clamp(risk - 6);
    opportunity = clamp(opportunity + 18);
    complexity = clamp(complexity + 10);
    projectedReturn = clamp(projectedReturn + 14);
    notes.push(`Adding ${selectedVendor} could improve demand competition.`);
  } else if (scenario === "removeVendor") {
    risk = clamp(risk + 8);
    opportunity = clamp(opportunity - 12);
    complexity = clamp(complexity - 8);
    projectedReturn = clamp(projectedReturn - 10);
    notes.push(`Removing ${selectedVendor} simplifies the stack but may reduce coverage.`);
  } else if (scenario === "addMissingAdUnits") {
    const gap = Math.max(0, -metrics.inventoryGap);
    coverage = clamp(metrics.coverageScore + gap * 10);
    risk = clamp(risk - Math.min(20, gap * 6));
    opportunity = clamp(opportunity + Math.min(16, gap * 5));
    projectedReturn = clamp(projectedReturn + Math.min(18, gap * 6));
    notes.push("Closing the inventory gap should improve coverage and reduce risk.");
  } else if (scenario === "remapConfig") {
    risk = clamp(risk - 14);
    opportunity = clamp(opportunity + 10);
    complexity = clamp(complexity + 4);
    projectedReturn = clamp(projectedReturn + 8);
    notes.push("A better config match could reduce mapping errors.");
  }

  return { risk, opportunity, complexity, coverage, projectedReturn, notes };
}

function buildBanditRewardMap(
  metrics: SiteMetrics,
  availableVendors: string[]
): BanditRewardMap {
  const baselineValue = scoreBanditOutcome({
    risk: metrics.riskScore,
    opportunity: metrics.opportunityScore,
    coverage: metrics.coverageScore,
    complexity: metrics.complexityScore,
    projectedReturn: metrics.projectedReturnScore,
  });

  const rtb = simulateScenario(metrics, "addVendor", "rtbhouse");
  const seed = simulateScenario(metrics, "addVendor", "seedtag");
  const media = simulateScenario(metrics, "addVendor", "medianet");
  const missing = simulateScenario(metrics, "addMissingAdUnits", "n/a");
  const remap = simulateScenario(metrics, "remapConfig", "n/a");

  const weakestVendor =
    metrics.adUnitVendorSummary[metrics.adUnitVendorSummary.length - 1]?.vendor ??
    availableVendors[0] ??
    "rtbhouse";

  const removeWeak = simulateScenario(metrics, "removeVendor", weakestVendor);

  function toReward(sim: {
    risk: number;
    opportunity: number;
    coverage: number;
    complexity: number;
    projectedReturn: number;
  }): number {
    const simValue = scoreBanditOutcome(sim);
    const delta = simValue - baselineValue;
    return Math.max(0.05, Math.min(0.95, 0.5 + delta / 50));
  }

  const holdReward = Math.max(0.05, Math.min(0.95, baselineValue / 100));

  return {
    add_vendor_rtbhouse: toReward(rtb),
    add_vendor_seedtag: toReward(seed),
    add_vendor_medianet: toReward(media),
    add_missing_ad_units: toReward(missing),
    remap_config: toReward(remap),
    remove_weak_vendor: toReward(removeWeak),
    do_nothing: holdReward,
  };
}

export default function HealthPage() {
  const [loading, setLoading] = React.useState(false);
  const [healthReport, setHealthReport] = React.useState<HealthReport | null>(null);
  const [adOpsData, setAdOpsData] = React.useState<AdOpsData | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const [autoRefresh, setAutoRefresh] = React.useState(true);
  const [tab, setTab] = React.useState<TabKey>("overview");
  const [drawerTab, setDrawerTab] = React.useState<DrawerTabKey>("explorer");
  const [severityFilter, setSeverityFilter] = React.useState<"all" | Severity>("all");
  const [statusFilter, setStatusFilter] = React.useState<"all" | HealthStatus>("all");
  const [siteRankingMode, setSiteRankingMode] =
    React.useState<SiteRankingMode>("investmentPriority");
  const [query, setQuery] = React.useState("");
  const [selectedSite, setSelectedSite] = React.useState<SiteRow | null>(null);

  const [simScenario, setSimScenario] = React.useState<SimulatorScenario>("addVendor");
  const [simVendor, setSimVendor] = React.useState("rtbhouse");

  async function runChecks() {
    setLoading(true);
    setErr(null);

    try {
      const [healthRes, adOpsRes] = await Promise.all([
        fetch("/api/health/run", { method: "POST" }),
        fetch("/api/adops", { method: "GET", cache: "no-store" }),
      ]);

      const healthJson = (await healthRes.json()) as HealthReport;
      const adOpsJson = (await adOpsRes.json()) as AdOpsData;

      setHealthReport(healthJson);
      setAdOpsData(adOpsJson);

      if (selectedSite) {
        const refreshed = adOpsJson.sites.find((s) => s.site === selectedSite.site) ?? null;
        setSelectedSite(refreshed);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => runChecks(), 2 * 60 * 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  React.useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedSite(null);
    }

    if (selectedSite) {
      window.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }

    return () => {
      window.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [selectedSite]);

  const issues = healthReport?.issues ?? [];
  const failCount = issues.filter((i) => i.severity === "fail").length;
  const warnCount = issues.filter((i) => i.severity === "warn").length;

  const q = query.trim().toLowerCase();

  const filteredIssues = issues.filter((i) => {
    if (severityFilter !== "all" && i.severity !== severityFilter) return false;
    if (!q) return true;
    return [i.source, i.file, i.where ?? "", i.message].join(" ").toLowerCase().includes(q);
  });

  const filteredSites = (adOpsData?.sites ?? []).filter((site) => {
    if (statusFilter !== "all" && site.status !== statusFilter) return false;
    if (!q) return true;
    return [site.site, site.publisher ?? "", site.configFile ?? "", site.vendors.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const filteredAdUnits = (adOpsData?.adUnits ?? []).filter((adUnit) => {
    if (statusFilter !== "all" && adUnit.status !== statusFilter) return false;
    if (!q) return true;
    return [
      adUnit.adUnitName,
      adUnit.site,
      adUnit.size ?? "",
      adUnit.gamAdUnit ?? "",
      adUnit.matchedConfig ?? "",
      adUnit.vendors.join(" "),
    ]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const filteredConfigs = (adOpsData?.configs ?? []).filter((config) => {
    if (!q) return true;
    return [
      config.fileName,
      config.domain,
      config.host ?? "",
      config.plugins.join(" "),
      ...(config.healthIssues ?? []),
    ]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const selectedSiteAdUnits = React.useMemo(() => {
    if (!selectedSite || !adOpsData) return [];
    return adOpsData.adUnits.filter((a) => a.site === selectedSite.site);
  }, [selectedSite, adOpsData]);

  const selectedSiteConfig = React.useMemo(() => {
    if (!selectedSite || !adOpsData || !selectedSite.configFile) return null;
    return adOpsData.configs.find((c) => c.fileName === selectedSite.configFile) ?? null;
  }, [selectedSite, adOpsData]);

  const selectedSiteMetrics = React.useMemo(() => {
    if (!selectedSite) return null;
    return computeSiteMetrics(selectedSite, selectedSiteAdUnits, selectedSiteConfig);
  }, [selectedSite, selectedSiteAdUnits, selectedSiteConfig]);

  const availableSimVendors = React.useMemo(() => {
    const siteVendors = selectedSiteMetrics?.inferredVendors ?? [];
    return uniq(["rtbhouse", "seedtag", "medianet", ...siteVendors]);
  }, [selectedSiteMetrics]);

  React.useEffect(() => {
    if (availableSimVendors.length > 0 && !availableSimVendors.includes(simVendor)) {
      setSimVendor(availableSimVendors[0]);
    }
  }, [availableSimVendors, simVendor]);

  const simulation = React.useMemo(() => {
    if (!selectedSiteMetrics) return null;
    return simulateScenario(selectedSiteMetrics, simScenario, simVendor);
  }, [selectedSiteMetrics, simScenario, simVendor]);

  const banditRewardMap = React.useMemo(() => {
    if (!selectedSiteMetrics) return null;
    return buildBanditRewardMap(selectedSiteMetrics, availableSimVendors);
  }, [selectedSiteMetrics, availableSimVendors]);

  const siteRankings = React.useMemo(() => {
    if (!adOpsData) {
      return {
        topRisk: [] as Array<{ site: SiteRow; metrics: SiteMetrics }>,
        topOpportunity: [] as Array<{ site: SiteRow; metrics: SiteMetrics }>,
        topReturn: [] as Array<{ site: SiteRow; metrics: SiteMetrics }>,
      };
    }

    const rows = adOpsData.sites.map((site) => {
      const siteAdUnits = adOpsData.adUnits.filter((a) => a.site === site.site);
      const config = site.configFile
        ? adOpsData.configs.find((c) => c.fileName === site.configFile) ?? null
        : null;

      return {
        site,
        metrics: computeSiteMetrics(site, siteAdUnits, config),
      };
    });

    return {
      topRisk: [...rows].sort((a, b) => b.metrics.riskScore - a.metrics.riskScore).slice(0, 5),
      topOpportunity: [...rows]
        .sort((a, b) => b.metrics.opportunityScore - a.metrics.opportunityScore)
        .slice(0, 5),
      topReturn: [...rows]
        .sort((a, b) => b.metrics.projectedReturnScore - a.metrics.projectedReturnScore)
        .slice(0, 5),
    };
  }, [adOpsData]);

  const rankedSites = React.useMemo(() => {
    if (!adOpsData) return [] as RankedSiteRow[];

    const state = loadBanditState();

    const rows = adOpsData.sites.map((site) => {
      const siteAdUnits = adOpsData.adUnits.filter((a) => a.site === site.site);
      const config = site.configFile
        ? adOpsData.configs.find((c) => c.fileName === site.configFile) ?? null
        : null;

      const metrics = computeSiteMetrics(site, siteAdUnits, config);
      const availableVendors = uniq(["rtbhouse", "seedtag", "medianet", ...metrics.inferredVendors]);
      const rewardMap = buildBanditRewardMap(metrics, availableVendors);

      const features: SiteBanditFeatures = {
        riskScore: metrics.riskScore,
        opportunityScore: metrics.opportunityScore,
        coverageScore: metrics.coverageScore,
        vendorCount: metrics.inferredVendors.length,
        inventoryGap: metrics.inventoryGap,
        hasConfig: Boolean(site.configFile),
        configHealthErrors: metrics.configHealthErrors,
        configHealthWarnings: metrics.configHealthWarnings,
      };

      const segment = makeSiteBanditSegment(features);
      syncBanditWithSimulator(state, { segment }, rewardMap);
      const recommendation = recommendThompsonArm(state, { segment }, rewardMap);
      const bestReward = Math.max(...Object.values(rewardMap));
      const priorityScore = scoreSiteForMode({
        mode: siteRankingMode,
        metrics,
        recommendation,
        bestReward,
      });
      const explanation = buildWhyLabel({
        mode: siteRankingMode,
        metrics,
        recommendation,
        bestReward,
      });

      return {
        site,
        metrics,
        recommendation,
        bestReward,
        priorityScore,
        why: explanation.why,
        headline: explanation.headline,
      };
    });

    saveBanditState(state);

    return rows.sort((a, b) => b.priorityScore - a.priorityScore);
  }, [adOpsData, siteRankingMode]);

  const filteredRankedSites = React.useMemo(() => {
    return rankedSites.filter((row) => {
      if (statusFilter !== "all" && row.site.status !== statusFilter) return false;
      if (!q) return true;
      return [
        row.site.site,
        row.site.publisher ?? "",
        row.site.configFile ?? "",
        row.site.vendors.join(" "),
        row.why,
        row.headline,
        row.recommendation ? getInterventionLabel(row.recommendation.arm) : "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rankedSites, statusFilter, q]);

  const rankingSummary = React.useMemo(() => {
    const leader = filteredRankedSites[0] ?? null;
    const runnerUp = filteredRankedSites[1] ?? null;

    let averageScore = 0;
    if (filteredRankedSites.length > 0) {
      averageScore =
        filteredRankedSites.reduce((sum, row) => sum + row.priorityScore, 0) / filteredRankedSites.length;
    }

    return {
      leader,
      runnerUp,
      averageScore,
      total: filteredRankedSites.length,
    };
  }, [filteredRankedSites]);

  const banditRecommendation = React.useMemo(() => {
    if (!selectedSiteMetrics || !selectedSite || !banditRewardMap) return null;

    const features: SiteBanditFeatures = {
      riskScore: selectedSiteMetrics.riskScore,
      opportunityScore: selectedSiteMetrics.opportunityScore,
      coverageScore: selectedSiteMetrics.coverageScore,
      vendorCount: selectedSiteMetrics.inferredVendors.length,
      inventoryGap: selectedSiteMetrics.inventoryGap,
      hasConfig: Boolean(selectedSite.configFile),
      configHealthErrors: selectedSiteMetrics.configHealthErrors,
      configHealthWarnings: selectedSiteMetrics.configHealthWarnings,
    };

    const state = loadBanditState();
    const segment = makeSiteBanditSegment(features);

    syncBanditWithSimulator(state, { segment }, banditRewardMap);

    const recommendation = recommendThompsonArm(state, { segment }, banditRewardMap);

    saveBanditState(state);

    return recommendation;
  }, [selectedSiteMetrics, selectedSite, banditRewardMap]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: theme.bg,
        color: theme.text,
        padding: 24,
        fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1440, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 32 }}>
              RevIQ Operations Dashboard <span style={{ color: theme.accent }}>(khanfigs)</span>
            </h1>
            <div style={{ color: theme.muted, marginTop: 8 }}>
              Explorer, simulator, and adaptive bandit recommendations
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: 10, alignItems: "center", color: theme.muted }}>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh
            </label>
            <button
              onClick={runChecks}
              disabled={loading}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: `1px solid ${theme.accentBorder}`,
                background: loading ? "#E2E8F0" : theme.accent,
                color: loading ? theme.muted : "#062B2B",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 900,
              }}
            >
              {loading ? "Running..." : "Refresh"}
            </button>
          </div>
        </div>

        {err && (
          <Panel style={{ background: "#FEF2F2", border: "1px solid #FCA5A5" }}>
            <div style={{ color: theme.fail, fontWeight: 900, marginBottom: 6 }}>Request failed</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{err}</div>
          </Panel>
        )}

        <div
          style={{
            marginTop: 16,
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          <StatCard label="Health Fails" value={failCount} />
          <StatCard label="Health Warnings" value={warnCount} />
          <StatCard label="Sites" value={adOpsData?.summary.totalSites ?? 0} />
          <StatCard label="Ad Units" value={adOpsData?.summary.totalAdUnits ?? 0} />
          <StatCard label="Configs" value={adOpsData?.summary.totalConfigs ?? 0} />
          <StatCard label="InMobi Sites" value={adOpsData?.summary.sitesUsingInMobi ?? 0} />
          <StatCard label="Config Health Warns" value={adOpsData?.summary.healthWarnings ?? 0} />
          <StatCard label="Config Health Errors" value={adOpsData?.summary.healthErrors ?? 0} />
        </div>

        <Panel>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>Overview</TabButton>
              <TabButton active={tab === "health"} onClick={() => setTab("health")}>Health</TabButton>
              <TabButton active={tab === "sites"} onClick={() => setTab("sites")}>Sites</TabButton>
              <TabButton active={tab === "adUnits"} onClick={() => setTab("adUnits")}>Ad Units</TabButton>
              <TabButton active={tab === "configs"} onClick={() => setTab("configs")}>Configs</TabButton>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: `1px solid ${theme.border}`,
                  minWidth: 220,
                }}
              />

              {tab === "health" ? (
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value as "all" | Severity)}
                  style={{ padding: "10px 12px", borderRadius: 12, border: `1px solid ${theme.border}` }}
                >
                  <option value="all">All severities</option>
                  <option value="fail">Fail only</option>
                  <option value="warn">Warn only</option>
                  <option value="ok">Ok only</option>
                </select>
              ) : tab === "sites" || tab === "adUnits" ? (
                <>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as "all" | HealthStatus)}
                    style={{ padding: "10px 12px", borderRadius: 12, border: `1px solid ${theme.border}` }}
                  >
                    <option value="all">All statuses</option>
                    <option value="healthy">Healthy</option>
                    <option value="warning">Warning</option>
                    <option value="error">Error</option>
                  </select>

                  {tab === "sites" && (
                    <select
                      value={siteRankingMode}
                      onChange={(e) => setSiteRankingMode(e.target.value as SiteRankingMode)}
                      style={{ padding: "10px 12px", borderRadius: 12, border: `1px solid ${theme.border}` }}
                    >
                      <option value="investmentPriority">Highest Investment Priority</option>
                      <option value="opportunity">Highest Opportunity</option>
                      <option value="projectedReturn">Highest Projected Return</option>
                      <option value="banditScore">Highest Bandit Score</option>
                      <option value="confidence">Highest Confidence</option>
                      <option value="inventoryGap">Biggest Inventory Gap</option>
                      <option value="risk">Highest Risk</option>
                      <option value="quickWins">Quick Wins</option>
                    </select>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </Panel>

        {tab === "overview" && (
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr 1fr" }}>
            <Panel>
              <h2 style={{ marginTop: 0 }}>Highest Revenue Risk</h2>
              <div style={{ display: "grid", gap: 10 }}>
                {siteRankings.topRisk.map(({ site, metrics }) => (
                  <div
                    key={site.site}
                    onClick={() => {
                      setSelectedSite(site);
                      setDrawerTab("explorer");
                    }}
                    style={{
                      cursor: "pointer",
                      border: `1px solid ${theme.border}`,
                      borderRadius: 12,
                      padding: 12,
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>{site.site}</div>
                    <div style={{ color: theme.muted, fontSize: 14 }}>
                      Risk {metrics.riskScore}/100
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel>
              <h2 style={{ marginTop: 0 }}>Expansion Opportunities</h2>
              <div style={{ display: "grid", gap: 10 }}>
                {siteRankings.topOpportunity.map(({ site, metrics }) => (
                  <div
                    key={site.site}
                    onClick={() => {
                      setSelectedSite(site);
                      setDrawerTab("bandit");
                    }}
                    style={{
                      cursor: "pointer",
                      border: `1px solid ${theme.border}`,
                      borderRadius: 12,
                      padding: 12,
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>{site.site}</div>
                    <div style={{ color: theme.muted, fontSize: 14 }}>
                      Opportunity {metrics.opportunityScore}/100
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel>
              <h2 style={{ marginTop: 0 }}>Best Return Potential</h2>
              <div style={{ display: "grid", gap: 10 }}>
                {siteRankings.topReturn.map(({ site, metrics }) => (
                  <div
                    key={site.site}
                    onClick={() => {
                      setSelectedSite(site);
                      setDrawerTab("simulator");
                    }}
                    style={{
                      cursor: "pointer",
                      border: `1px solid ${theme.border}`,
                      borderRadius: 12,
                      padding: 12,
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>{site.site}</div>
                    <div style={{ color: theme.muted, fontSize: 14 }}>
                      Return {metrics.projectedReturnScore}/100
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}

        {tab === "health" && (
          <Panel>
            <h2 style={{ marginTop: 0 }}>Issues</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: `1px solid ${theme.border}` }}>
                    <th style={{ padding: "10px 8px" }}>Severity</th>
                    <th style={{ padding: "10px 8px" }}>Source</th>
                    <th style={{ padding: "10px 8px" }}>File</th>
                    <th style={{ padding: "10px 8px" }}>Where</th>
                    <th style={{ padding: "10px 8px" }}>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIssues.map((i, idx) => (
                    <tr key={idx} style={{ borderBottom: `1px solid ${theme.border}` }}>
                      <td style={{ padding: "10px 8px" }}>
                        <StatusPill sev={i.severity} />
                      </td>
                      <td style={{ padding: "10px 8px" }}>{i.source}</td>
                      <td style={{ padding: "10px 8px" }}>{i.file}</td>
                      <td style={{ padding: "10px 8px" }}>{i.where ?? ""}</td>
                      <td style={{ padding: "10px 8px" }}>{i.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {tab === "sites" && (
          <>
            <Panel>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ marginTop: 0, marginBottom: 6 }}>Site Investment Priority</h2>
                  <div style={{ color: theme.muted }}>
                    Ranked using your simulator, structural site metrics, and Thompson bandit guidance.
                  </div>
                </div>
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `1px solid ${theme.border}`,
                    background: theme.panelSoft,
                    color: theme.muted,
                    fontWeight: 700,
                  }}
                >
                  Active sort: <span style={{ color: theme.text }}>{formatModeLabel(siteRankingMode)}</span>
                </div>
              </div>

              <div
                style={{
                  marginTop: 16,
                  display: "grid",
                  gap: 16,
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                }}
              >
                <StatCard
                  label="Top Focus Site"
                  value={rankingSummary.leader?.site.site ?? "—"}
                  helper={rankingSummary.leader?.headline ?? "No matching site for the current filters."}
                />
                <StatCard
                  label="Top Score"
                  value={rankingSummary.leader ? rankingSummary.leader.priorityScore.toFixed(1) : "—"}
                  helper={rankingSummary.leader?.recommendation ? getInterventionLabel(rankingSummary.leader.recommendation.arm) : "No recommendation"}
                />
                <StatCard
                  label="Runner-Up"
                  value={rankingSummary.runnerUp?.site.site ?? "—"}
                  helper={rankingSummary.runnerUp?.headline ?? "Second-best candidate will appear here."}
                />
                <StatCard
                  label="Average Priority"
                  value={rankingSummary.total > 0 ? rankingSummary.averageScore.toFixed(1) : "—"}
                  helper={`${rankingSummary.total} site${rankingSummary.total === 1 ? "" : "s"} in current view`}
                />
              </div>

              {rankingSummary.leader && (
                <div
                  style={{
                    marginTop: 16,
                    padding: 14,
                    borderRadius: 14,
                    border: `1px solid ${theme.accentBorder}`,
                    background: theme.accentSoft,
                  }}
                >
                  <div style={{ fontWeight: 900, color: "#0F766E" }}>Suggested next move</div>
                  <div style={{ marginTop: 6, color: theme.text }}>
                    <span style={{ fontWeight: 800 }}>{rankingSummary.leader.site.site}</span> leads under
                    <span style={{ fontWeight: 800 }}> {formatModeLabel(siteRankingMode)}</span>. {rankingSummary.leader.why}
                  </div>
                </div>
              )}

              <div style={{ overflowX: "auto", marginTop: 16 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: `1px solid ${theme.border}` }}>
                      <th style={{ padding: "10px 8px" }}>Rank</th>
                      <th style={{ padding: "10px 8px" }}>Site</th>
                      <th style={{ padding: "10px 8px" }}>Priority</th>
                      <th style={{ padding: "10px 8px" }}>Opportunity</th>
                      <th style={{ padding: "10px 8px" }}>Return</th>
                      <th style={{ padding: "10px 8px" }}>Risk</th>
                      <th style={{ padding: "10px 8px" }}>Inv. Gap</th>
                      <th style={{ padding: "10px 8px" }}>Confidence</th>
                      <th style={{ padding: "10px 8px" }}>Recommended Action</th>
                      <th style={{ padding: "10px 8px" }}>Focus Insight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRankedSites.map((row, idx) => (
                      <tr
                        key={row.site.site}
                        onClick={() => {
                          setSelectedSite(row.site);
                          setDrawerTab("bandit");
                        }}
                        style={{
                          borderBottom: `1px solid ${theme.border}`,
                          cursor: "pointer",
                          background: idx === 0 ? "#F8FEFD" : "transparent",
                        }}
                      >
                        <td style={{ padding: "10px 8px", fontWeight: 800 }}>{idx + 1}</td>
                        <td style={{ padding: "10px 8px" }}>
                          <div style={{ fontWeight: 800 }}>{row.site.site}</div>
                          <div style={{ color: theme.faint, fontSize: 12 }}>{row.site.publisher ?? "Unknown publisher"}</div>
                        </td>
                        <td style={{ padding: "10px 8px", fontWeight: 800 }}>{row.priorityScore.toFixed(1)}</td>
                        <td style={{ padding: "10px 8px" }}>{row.metrics.opportunityScore}</td>
                        <td style={{ padding: "10px 8px" }}>{row.metrics.projectedReturnScore}</td>
                        <td style={{ padding: "10px 8px" }}>{row.metrics.riskScore}</td>
                        <td style={{ padding: "10px 8px" }}>{row.metrics.inventoryGap}</td>
                        <td style={{ padding: "10px 8px" }}>
                          {formatPercentFromUnit(row.recommendation?.confidence ?? 0)}
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          {row.recommendation ? getInterventionLabel(row.recommendation.arm) : "—"}
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          <div style={{ fontWeight: 800 }}>{row.headline}</div>
                          <div style={{ color: theme.muted, marginTop: 4 }}>{row.why}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel>
              <h2 style={{ marginTop: 0 }}>Sites</h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: `1px solid ${theme.border}` }}>
                      <th style={{ padding: "10px 8px" }}>Site</th>
                      <th style={{ padding: "10px 8px" }}>Publisher</th>
                      <th style={{ padding: "10px 8px" }}>Expected</th>
                      <th style={{ padding: "10px 8px" }}>Actual</th>
                      <th style={{ padding: "10px 8px" }}>Config</th>
                      <th style={{ padding: "10px 8px" }}>Vendors</th>
                      <th style={{ padding: "10px 8px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSites.map((site) => (
                      <tr
                        key={site.site}
                        onClick={() => {
                          setSelectedSite(site);
                          setDrawerTab("explorer");
                        }}
                        style={{
                          borderBottom: `1px solid ${theme.border}`,
                          cursor: "pointer",
                        }}
                      >
                        <td style={{ padding: "10px 8px", fontWeight: 800 }}>{site.site}</td>
                        <td style={{ padding: "10px 8px" }}>{site.publisher ?? "—"}</td>
                        <td style={{ padding: "10px 8px" }}>{site.expectedAdUnits}</td>
                        <td style={{ padding: "10px 8px" }}>{site.actualAdUnits}</td>
                        <td style={{ padding: "10px 8px" }}>{site.configFile ?? "Missing"}</td>
                        <td style={{ padding: "10px 8px" }}>{site.vendors.join(", ") || "—"}</td>
                        <td style={{ padding: "10px 8px" }}>
                          <HealthStatusPill status={site.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </>
        )}

        {tab === "adUnits" && (
          <Panel>
            <h2 style={{ marginTop: 0 }}>Ad Units</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: `1px solid ${theme.border}` }}>
                    <th style={{ padding: "10px 8px" }}>Ad Unit</th>
                    <th style={{ padding: "10px 8px" }}>Site</th>
                    <th style={{ padding: "10px 8px" }}>Size</th>
                    <th style={{ padding: "10px 8px" }}>GAM Ad Unit</th>
                    <th style={{ padding: "10px 8px" }}>Config</th>
                    <th style={{ padding: "10px 8px" }}>Vendors</th>
                    <th style={{ padding: "10px 8px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAdUnits.map((adUnit, idx) => (
                    <tr key={`${adUnit.site}-${adUnit.adUnitName}-${idx}`} style={{ borderBottom: `1px solid ${theme.border}` }}>
                      <td style={{ padding: "10px 8px" }}>{adUnit.adUnitName}</td>
                      <td style={{ padding: "10px 8px" }}>{adUnit.site}</td>
                      <td style={{ padding: "10px 8px" }}>{adUnit.size ?? "—"}</td>
                      <td style={{ padding: "10px 8px" }}>{adUnit.gamAdUnit ?? "—"}</td>
                      <td style={{ padding: "10px 8px" }}>{adUnit.matchedConfig ?? "Missing"}</td>
                      <td style={{ padding: "10px 8px" }}>{adUnit.vendors.join(", ") || "—"}</td>
                      <td style={{ padding: "10px 8px" }}>
                        <HealthStatusPill status={adUnit.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {tab === "configs" && (
          <Panel>
            <h2 style={{ marginTop: 0 }}>Configs</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: `1px solid ${theme.border}` }}>
                    <th style={{ padding: "10px 8px" }}>Config File</th>
                    <th style={{ padding: "10px 8px" }}>Domain</th>
                    <th style={{ padding: "10px 8px" }}>Health</th>
                    <th style={{ padding: "10px 8px" }}>Plugins</th>
                    <th style={{ padding: "10px 8px" }}>Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredConfigs.map((config) => (
                    <tr key={config.fileName} style={{ borderBottom: `1px solid ${theme.border}` }}>
                      <td style={{ padding: "10px 8px" }}>{config.fileName}</td>
                      <td style={{ padding: "10px 8px" }}>{config.domain}</td>
                      <td style={{ padding: "10px 8px" }}>
                        <HealthStatusPill status={config.healthStatus ?? "healthy"} />
                      </td>
                      <td style={{ padding: "10px 8px" }}>{config.plugins.join(", ") || "—"}</td>
                      <td style={{ padding: "10px 8px" }}>{config.tagNames.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>

      {selectedSite && selectedSiteMetrics && (
        <>
          <div
            onClick={() => setSelectedSite(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: theme.overlay,
              zIndex: 40,
            }}
          />
          <div
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              width: "min(820px, 96vw)",
              height: "100vh",
              background: theme.bg,
              borderLeft: `1px solid ${theme.border}`,
              boxShadow: "-18px 0 40px rgba(15, 23, 42, 0.18)",
              zIndex: 50,
              overflowY: "auto",
              padding: 20,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h2 style={{ margin: 0 }}>{selectedSite.site}</h2>
                <div style={{ color: theme.muted, marginTop: 6 }}>{selectedSite.publisher || "Unknown publisher"}</div>
              </div>
              <button
                onClick={() => setSelectedSite(null)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: `1px solid ${theme.border}`,
                  background: "#FFF",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                Close
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <TabButton active={drawerTab === "explorer"} onClick={() => setDrawerTab("explorer")}>Explorer</TabButton>
              <TabButton active={drawerTab === "vendors"} onClick={() => setDrawerTab("vendors")}>Vendors</TabButton>
              <TabButton active={drawerTab === "simulator"} onClick={() => setDrawerTab("simulator")}>Simulator</TabButton>
              <TabButton active={drawerTab === "bandit"} onClick={() => setDrawerTab("bandit")}>Bandit</TabButton>
              <TabButton active={drawerTab === "config"} onClick={() => setDrawerTab("config")}>Config</TabButton>
            </div>

            <div
              style={{
                marginTop: 12,
                display: "grid",
                gap: 16,
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              }}
            >
              <StatCard label="Expected" value={selectedSite.expectedAdUnits} />
              <StatCard label="Actual" value={selectedSite.actualAdUnits} />
              <StatCard label="Risk" value={selectedSiteMetrics.riskScore} />
              <StatCard label="Return" value={selectedSiteMetrics.projectedReturnScore} />
            </div>

            {drawerTab === "explorer" && (
              <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
                <DrawerSection title="Auto Site Explorer">
                  <div style={{ color: theme.muted, lineHeight: 1.9 }}>
                    <div><b style={{ color: theme.text }}>Config File:</b> {selectedSite.configFile ?? "Missing"}</div>
                    <div><b style={{ color: theme.text }}>Config Health:</b> <HealthStatusPill status={selectedSiteMetrics.configHealth} /></div>
                    <div><b style={{ color: theme.text }}>Expected vs Actual:</b> {selectedSite.expectedAdUnits} vs {selectedSite.actualAdUnits}</div>
                    <div><b style={{ color: theme.text }}>Inventory Gap:</b> {selectedSiteMetrics.inventoryGap}</div>
                    <div><b style={{ color: theme.text }}>Config Vendors:</b> {selectedSiteMetrics.configVendors.join(", ") || "—"}</div>
                    <div><b style={{ color: theme.text }}>Ad Unit Vendors:</b> {selectedSiteMetrics.adUnitVendors.join(", ") || "—"}</div>
                  </div>
                </DrawerSection>

                <DrawerSection title="Insights">
                  <div style={{ display: "grid", gap: 8, color: theme.muted }}>
                    {selectedSiteMetrics.insights.length === 0 ? (
                      <div>No major insights found.</div>
                    ) : (
                      selectedSiteMetrics.insights.map((insight, idx) => (
                        <div key={idx}>• {insight}</div>
                      ))
                    )}
                  </div>
                </DrawerSection>

                <DrawerSection title="Score Snapshot">
                  <div style={{ display: "grid", gap: 14 }}>
                    <ScoreBar label="Revenue Risk" value={selectedSiteMetrics.riskScore} />
                    <ScoreBar label="Opportunity" value={selectedSiteMetrics.opportunityScore} />
                    <ScoreBar label="Coverage" value={selectedSiteMetrics.coverageScore} />
                    <ScoreBar label="Complexity" value={selectedSiteMetrics.complexityScore} />
                    <ScoreBar label="Projected Return" value={selectedSiteMetrics.projectedReturnScore} />
                  </div>
                </DrawerSection>
              </div>
            )}

            {drawerTab === "vendors" && (
              <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
                <DrawerSection title="Vendor Coverage">
                  <div style={{ display: "grid", gap: 10 }}>
                    {selectedSiteMetrics.adUnitVendorSummary.length === 0 ? (
                      <div style={{ color: theme.muted }}>No vendor coverage found.</div>
                    ) : (
                      selectedSiteMetrics.adUnitVendorSummary.map(({ vendor, count }) => (
                        <div
                          key={vendor}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "10px 12px",
                            borderRadius: 12,
                            background: theme.panelSoft,
                            border: `1px solid ${theme.border}`,
                          }}
                        >
                          <div style={{ fontWeight: 800 }}>{vendor}</div>
                          <div style={{ color: theme.muted }}>
                            {count} ad unit{count === 1 ? "" : "s"}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </DrawerSection>
              </div>
            )}

            {drawerTab === "simulator" && simulation && (
              <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
                <DrawerSection title="What-If Simulator">
                  <div style={{ display: "grid", gap: 14 }}>
                    <select
                      value={simScenario}
                      onChange={(e) => setSimScenario(e.target.value as SimulatorScenario)}
                      style={{ padding: "10px 12px", borderRadius: 12, border: `1px solid ${theme.border}` }}
                    >
                      <option value="addVendor">Add Vendor</option>
                      <option value="removeVendor">Remove Vendor</option>
                      <option value="addMissingAdUnits">Add Missing Ad Units</option>
                      <option value="remapConfig">Remap Config</option>
                    </select>

                    {(simScenario === "addVendor" || simScenario === "removeVendor") && (
                      <select
                        value={simVendor}
                        onChange={(e) => setSimVendor(e.target.value)}
                        style={{ padding: "10px 12px", borderRadius: 12, border: `1px solid ${theme.border}` }}
                      >
                        {availableSimVendors.map((vendor) => (
                          <option key={vendor} value={vendor}>
                            {vendor}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </DrawerSection>

                <DrawerSection title="Simulated Outcome">
                  <div style={{ display: "grid", gap: 14 }}>
                    <ScoreBar label="Revenue Risk" value={simulation.risk} />
                    <ScoreBar label="Opportunity" value={simulation.opportunity} />
                    <ScoreBar label="Coverage" value={simulation.coverage} />
                    <ScoreBar label="Complexity" value={simulation.complexity} />
                    <ScoreBar label="Projected Return" value={simulation.projectedReturn} />
                  </div>
                </DrawerSection>

                <DrawerSection title="Simulator Notes">
                  <div style={{ display: "grid", gap: 8, color: theme.muted }}>
                    {simulation.notes.map((note, idx) => (
                      <div key={idx}>• {note}</div>
                    ))}
                  </div>
                </DrawerSection>
              </div>
            )}

            {drawerTab === "bandit" && banditRecommendation && banditRewardMap && (
              <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
                <DrawerSection title="Bandit Recommendation Engine">
                  <div style={{ color: theme.muted, lineHeight: 1.9 }}>
                    <div>
                      <b style={{ color: theme.text }}>Recommended Action:</b>{" "}
                      {getInterventionLabel(banditRecommendation.arm)}
                    </div>
                    <div>
                      <b style={{ color: theme.text }}>Action Family:</b>{" "}
                      {getActionFamily(banditRecommendation.arm)}
                    </div>
                    <div>
                      <b style={{ color: theme.text }}>Selection Policy:</b>{" "}
                      {banditRecommendation.reason}
                    </div>
                    <div>
                      <b style={{ color: theme.text }}>Context Segment:</b>{" "}
                      {banditRecommendation.segment}
                    </div>
                    <div>
                      <b style={{ color: theme.text }}>Thompson Score:</b>{" "}
                      {banditRecommendation.score.toFixed(3)}
                    </div>
                    <div>
                      <b style={{ color: theme.text }}>Posterior Mean:</b>{" "}
                      {banditRecommendation.posteriorMean.toFixed(3)}
                    </div>
                    <div>
                      <b style={{ color: theme.text }}>Confidence:</b>{" "}
                      {(banditRecommendation.confidence * 100).toFixed(0)}%
                    </div>
                  </div>
                </DrawerSection>

                <DrawerSection title="Simulator-backed reward map">
                  <div style={{ display: "grid", gap: 10 }}>
                    {(Object.entries(banditRewardMap) as Array<[string, number]>)
                      .sort((a, b) => b[1] - a[1])
                      .map(([arm, reward]) => (
                        <div
                          key={arm}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "10px 12px",
                            borderRadius: 12,
                            background: theme.panelSoft,
                            border: `1px solid ${theme.border}`,
                          }}
                        >
                          <div style={{ fontWeight: 800, color: theme.text }}>
                            {getInterventionLabel(arm as InterventionArm)}
                          </div>
                          <div style={{ color: theme.muted }}>{reward.toFixed(3)}</div>
                        </div>
                      ))}
                  </div>
                </DrawerSection>

                <DrawerSection title="What changed">
                  <div style={{ display: "grid", gap: 8, color: theme.muted }}>
                    <div>
                      • The model now learns from simulator-estimated intervention quality instead of fixed heuristic priors.
                    </div>
                    <div>
                      • Thompson scores no longer stay at zero because the posterior is updated automatically from simulated rewards.
                    </div>
                    <div>
                      • Manual training is gone — the system updates itself whenever the site is refreshed.
                    </div>
                    <div>
                      • This removes a major assumption: we no longer hard-code which actions are best before evaluating scenario outcomes.
                    </div>
                  </div>
                </DrawerSection>
              </div>
            )}

            {drawerTab === "config" && (
              <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
                <DrawerSection title="Config Health Issues">
                  {selectedSiteMetrics.configHealthIssues.length === 0 ? (
                    <div style={{ color: theme.muted }}>No config health issues found.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8, color: theme.muted }}>
                      {selectedSiteMetrics.configHealthIssues.map((issue, idx) => (
                        <div key={idx}>• {issue}</div>
                      ))}
                    </div>
                  )}
                </DrawerSection>

                <DrawerSection title={`Ad Units for ${selectedSite.site}`}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ textAlign: "left", borderBottom: `1px solid ${theme.border}` }}>
                          <th style={{ padding: "10px 8px" }}>Ad Unit</th>
                          <th style={{ padding: "10px 8px" }}>Size</th>
                          <th style={{ padding: "10px 8px" }}>GAM Ad Unit</th>
                          <th style={{ padding: "10px 8px" }}>Vendors</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSiteAdUnits.map((adUnit, idx) => (
                          <tr key={`${adUnit.adUnitName}-${idx}`} style={{ borderBottom: `1px solid ${theme.border}` }}>
                            <td style={{ padding: "10px 8px" }}>{adUnit.adUnitName}</td>
                            <td style={{ padding: "10px 8px" }}>{adUnit.size ?? "—"}</td>
                            <td style={{ padding: "10px 8px" }}>{adUnit.gamAdUnit ?? "—"}</td>
                            <td style={{ padding: "10px 8px" }}>{adUnit.vendors.join(", ") || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </DrawerSection>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}