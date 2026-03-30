export type HealthStatus = "healthy" | "warning" | "error";

export type ConfigHealthSummary = {
  configFile: string;
  status: HealthStatus;
  warningCount: number;
  errorCount: number;
  issueMessages: string[];
};

export type VendorCoverage = {
  vendor: string;
  adUnitCount: number;
};

export type SiteInsight = {
  aliasMatched: boolean;
  aliasSource?: string;
  configVendors: string[];
  adUnitVendors: string[];
  inferredVendors: string[];
  vendorCoverage: VendorCoverage[];
  expectedGap: number;
  riskScore: number;
  opportunityScore: number;
  complexityScore: number;
  coverageScore: number;
  insights: string[];
  recommendations: string[];
};

export type ConfigSummary = {
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

export type SiteSummary = {
  site: string;
  publisher?: string;
  expectedAdUnits: number;
  actualAdUnits: number;
  configFile?: string;
  usesInMobi: boolean;
  vendors: string[];
  status: HealthStatus;
  warnings: string[];

  healthStatus?: HealthStatus;
  healthWarningCount?: number;
  healthErrorCount?: number;

  insight?: SiteInsight;
};

export type AdUnitSummary = {
  adUnitName: string;
  site: string;
  size?: string;
  vendors: string[];
  gamAdUnit?: string;
  matchedConfig?: string;
  status: HealthStatus;
  warnings: string[];

  healthStatus?: HealthStatus;
  healthWarningCount?: number;
  healthErrorCount?: number;
};

export type DashboardData = {
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
  sites: SiteSummary[];
  adUnits: AdUnitSummary[];
  configs: ConfigSummary[];
};