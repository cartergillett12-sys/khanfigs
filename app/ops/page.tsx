"use client";

import { useEffect, useMemo, useState } from "react";

type DashboardData = {
  summary: {
    totalSites: number;
    totalAdUnits: number;
    totalConfigs: number;
    sitesUsingInMobi: number;
    warnings: number;
    errors: number;
    lastUpdated: string;
  };
  sites: {
    site: string;
    publisher?: string;
    expectedAdUnits: number;
    actualAdUnits: number;
    configFile?: string;
    usesInMobi: boolean;
    vendors: string[];
    status: "healthy" | "warning" | "error";
    warnings: string[];
  }[];
  adUnits: {
    adUnitName: string;
    site: string;
    size?: string;
    vendors: string[];
    gamAdUnit?: string;
    matchedConfig?: string;
    status: "healthy" | "warning" | "error";
    warnings: string[];
  }[];
  configs: {
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
  }[];
};

type TabKey = "sites" | "adUnits" | "configs";

function StatusPill({ status }: { status: "healthy" | "warning" | "error" }) {
  const styles =
    status === "healthy"
      ? "bg-green-100 text-green-800 border-green-200"
      : status === "warning"
      ? "bg-yellow-100 text-yellow-800 border-yellow-200"
      : "bg-red-100 text-red-800 border-red-200";

  return (
    <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${styles}`}>
      {status}
    </span>
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
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-bold text-slate-900">{value}</div>
      {helper ? <div className="mt-1 text-xs text-slate-500">{helper}</div> : null}
    </div>
  );
}

export default function OpsPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("sites");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "healthy" | "warning" | "error">("all");
  const [vendorFilter, setVendorFilter] = useState("all");

  async function loadData() {
    try {
      setError("");
      const response = await fetch("/api/adops", { cache: "no-store" });
      const json = await response.json();

      if (!response.ok) {
        throw new Error(json?.details || "Failed to load dashboard.");
      }

      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, []);

  const allVendors = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();

    for (const site of data.sites) {
      for (const vendor of site.vendors) set.add(vendor);
    }
    for (const adUnit of data.adUnits) {
      for (const vendor of adUnit.vendors) set.add(vendor);
    }
    for (const config of data.configs) {
      for (const plugin of config.plugins) set.add(plugin);
    }

    return Array.from(set).sort();
  }, [data]);

  const filteredSites = useMemo(() => {
    if (!data) return [];

    return data.sites.filter((site) => {
      const matchesSearch =
        !search ||
        site.site.toLowerCase().includes(search.toLowerCase()) ||
        (site.publisher || "").toLowerCase().includes(search.toLowerCase()) ||
        (site.configFile || "").toLowerCase().includes(search.toLowerCase());

      const matchesStatus = statusFilter === "all" || site.status === statusFilter;
      const matchesVendor = vendorFilter === "all" || site.vendors.includes(vendorFilter);

      return matchesSearch && matchesStatus && matchesVendor;
    });
  }, [data, search, statusFilter, vendorFilter]);

  const filteredAdUnits = useMemo(() => {
    if (!data) return [];

    return data.adUnits.filter((adUnit) => {
      const matchesSearch =
        !search ||
        adUnit.adUnitName.toLowerCase().includes(search.toLowerCase()) ||
        adUnit.site.toLowerCase().includes(search.toLowerCase()) ||
        (adUnit.gamAdUnit || "").toLowerCase().includes(search.toLowerCase());

      const matchesStatus = statusFilter === "all" || adUnit.status === statusFilter;
      const matchesVendor = vendorFilter === "all" || adUnit.vendors.includes(vendorFilter);

      return matchesSearch && matchesStatus && matchesVendor;
    });
  }, [data, search, statusFilter, vendorFilter]);

  const filteredConfigs = useMemo(() => {
    if (!data) return [];

    return data.configs.filter((config) => {
      const inferredStatus =
        config.plugins.length === 0 ? "warning" : "healthy";

      const matchesSearch =
        !search ||
        config.fileName.toLowerCase().includes(search.toLowerCase()) ||
        config.domain.toLowerCase().includes(search.toLowerCase()) ||
        (config.host || "").toLowerCase().includes(search.toLowerCase());

      const matchesStatus = statusFilter === "all" || inferredStatus === statusFilter;
      const matchesVendor =
        vendorFilter === "all" ||
        config.plugins.includes(vendorFilter) ||
        !!config.vendorFlags[vendorFilter];

      return matchesSearch && matchesStatus && matchesVendor;
    });
  }, [data, search, statusFilter, vendorFilter]);

  if (loading) {
    return <div className="p-8 text-slate-700">Loading ad ops dashboard...</div>;
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
          Failed to load dashboard: {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="p-8 text-slate-700">No dashboard data found.</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Ad Ops Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">
              Live view of sites, ad units, and khanfigs config state.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-500">
              Last updated: {new Date(data.summary.lastUpdated).toLocaleString()}
            </div>
            <button
              onClick={loadData}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium shadow-sm hover:bg-slate-100"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Sites" value={data.summary.totalSites} />
          <StatCard label="Ad Units" value={data.summary.totalAdUnits} />
          <StatCard label="Configs" value={data.summary.totalConfigs} />
          <StatCard label="InMobi Sites" value={data.summary.sitesUsingInMobi} />
          <StatCard label="Warnings" value={data.summary.warnings} />
          <StatCard label="Errors" value={data.summary.errors} />
        </div>

        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sites, ad units, configs, publishers..."
              className="w-full rounded-xl border border-slate-300 px-4 py-2 outline-none focus:border-slate-500"
            />

            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "all" | "healthy" | "warning" | "error")
              }
              className="rounded-xl border border-slate-300 bg-white px-4 py-2"
            >
              <option value="all">All statuses</option>
              <option value="healthy">Healthy</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </select>

            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2"
            >
              <option value="all">All vendors</option>
              {allVendors.map((vendor) => (
                <option key={vendor} value={vendor}>
                  {vendor}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setTab("sites")}
            className={`rounded-xl px-4 py-2 text-sm font-medium ${
              tab === "sites" ? "bg-slate-900 text-white" : "bg-white text-slate-700 border border-slate-300"
            }`}
          >
            Sites
          </button>
          <button
            onClick={() => setTab("adUnits")}
            className={`rounded-xl px-4 py-2 text-sm font-medium ${
              tab === "adUnits" ? "bg-slate-900 text-white" : "bg-white text-slate-700 border border-slate-300"
            }`}
          >
            Ad Units
          </button>
          <button
            onClick={() => setTab("configs")}
            className={`rounded-xl px-4 py-2 text-sm font-medium ${
              tab === "configs" ? "bg-slate-900 text-white" : "bg-white text-slate-700 border border-slate-300"
            }`}
          >
            Configs
          </button>
        </div>

        {tab === "sites" && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="px-4 py-3">Site</th>
                    <th className="px-4 py-3">Publisher</th>
                    <th className="px-4 py-3">Expected Ad Units</th>
                    <th className="px-4 py-3">Actual Ad Units</th>
                    <th className="px-4 py-3">Config</th>
                    <th className="px-4 py-3">InMobi</th>
                    <th className="px-4 py-3">Vendors</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSites.map((site) => (
                    <tr key={site.site} className="border-t border-slate-200 align-top">
                      <td className="px-4 py-3 font-medium">{site.site}</td>
                      <td className="px-4 py-3">{site.publisher || "—"}</td>
                      <td className="px-4 py-3">{site.expectedAdUnits}</td>
                      <td className="px-4 py-3">{site.actualAdUnits}</td>
                      <td className="px-4 py-3">{site.configFile || "Missing"}</td>
                      <td className="px-4 py-3">{site.usesInMobi ? "Yes" : "No"}</td>
                      <td className="px-4 py-3">{site.vendors.join(", ") || "—"}</td>
                      <td className="px-4 py-3">
                        <StatusPill status={site.status} />
                        {site.warnings.length > 0 && (
                          <div className="mt-2 space-y-1 text-xs text-slate-600">
                            {site.warnings.map((warning, index) => (
                              <div key={index}>• {warning}</div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredSites.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                        No matching sites found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "adUnits" && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="px-4 py-3">Ad Unit</th>
                    <th className="px-4 py-3">Site</th>
                    <th className="px-4 py-3">Size</th>
                    <th className="px-4 py-3">GAM Ad Unit</th>
                    <th className="px-4 py-3">Config</th>
                    <th className="px-4 py-3">Vendors</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAdUnits.map((adUnit, index) => (
                    <tr key={`${adUnit.site}-${adUnit.adUnitName}-${index}`} className="border-t border-slate-200 align-top">
                      <td className="px-4 py-3 font-medium">{adUnit.adUnitName}</td>
                      <td className="px-4 py-3">{adUnit.site || "—"}</td>
                      <td className="px-4 py-3">{adUnit.size || "—"}</td>
                      <td className="px-4 py-3">{adUnit.gamAdUnit || "—"}</td>
                      <td className="px-4 py-3">{adUnit.matchedConfig || "Missing"}</td>
                      <td className="px-4 py-3">{adUnit.vendors.join(", ") || "—"}</td>
                      <td className="px-4 py-3">
                        <StatusPill status={adUnit.status} />
                        {adUnit.warnings.length > 0 && (
                          <div className="mt-2 space-y-1 text-xs text-slate-600">
                            {adUnit.warnings.map((warning, warningIndex) => (
                              <div key={warningIndex}>• {warning}</div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredAdUnits.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        No matching ad units found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "configs" && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="px-4 py-3">Config File</th>
                    <th className="px-4 py-3">Domain</th>
                    <th className="px-4 py-3">Host</th>
                    <th className="px-4 py-3">Plugins</th>
                    <th className="px-4 py-3">Tags</th>
                    <th className="px-4 py-3">Last Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredConfigs.map((config) => (
                    <tr key={config.fileName} className="border-t border-slate-200 align-top">
                      <td className="px-4 py-3 font-medium">{config.fileName}</td>
                      <td className="px-4 py-3">{config.domain}</td>
                      <td className="px-4 py-3">{config.host || "—"}</td>
                      <td className="px-4 py-3">{config.plugins.join(", ") || "—"}</td>
                      <td className="px-4 py-3">{config.tagNames.length}</td>
                      <td className="px-4 py-3">
                        {config.lastModified
                          ? new Date(config.lastModified).toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                  {filteredConfigs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No matching configs found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}