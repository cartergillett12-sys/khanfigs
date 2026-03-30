import { NextResponse } from "next/server";
import { buildHealthReport } from "../../../../src/health/engine";

export const runtime = "nodejs";

export async function POST() {
  try {
    const report = await buildHealthReport();
    return NextResponse.json(report);
  } catch (err) {
    // Always return JSON so the UI never crashes parsing it
    return NextResponse.json(
      {
        overall: "fail",
        generatedAtIso: new Date().toISOString(),
        summary: { configsFound: 0, configsParsed: 0, csvSitesRows: 0, csvAdUnitsRows: 0 },
        convert: { ran: false, exitCode: null, stdoutTail: [], stderrTail: [] },
        issues: [
          {
            severity: "fail",
            source: "convert",
            file: "app/api/health/run/route.ts",
            message: `Health route crashed: ${String(err)}`,
          },
        ],
        debug: {
          sitesPath: "",
          sitesMtimeIso: null,
          sitesBytes: null,
          lastSitesUrl: null,
        },
        _rawError: String(err),
      },
      { status: 500 },
    );
  }
}