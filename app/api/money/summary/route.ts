import { NextResponse } from "next/server";
import { moneySummary, monthOf } from "@/lib/money";
import { requireOwner } from "@/lib/owner-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/money/summary?month=YYYY-MM — everything the dashboard needs, in one call. */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const month = new URL(request.url).searchParams.get("month") || monthOf();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month must look like 2026-10." }, { status: 400 });
  }
  try {
    return NextResponse.json(await moneySummary(month));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}
