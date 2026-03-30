import { NextResponse } from "next/server";
import { buildDashboardData } from "../../../lib/adops/parser";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await buildDashboardData();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to build ad ops dashboard:", error);

    return NextResponse.json(
      {
        error: "Failed to load ad ops dashboard data.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}