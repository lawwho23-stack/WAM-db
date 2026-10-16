import { NextResponse } from "next/server";
import { importCsv } from "@/lib/money";
import { requireOwner } from "@/lib/owner-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/money/import
 *
 * Accepts either a raw text/csv body or JSON { "csv": "..." }. Rows that are
 * already in the database (same fingerprint) are skipped, so importing the same
 * file twice is harmless.
 */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  let csv = "";
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("text/csv") || type.includes("text/plain")) {
    csv = await request.text();
  } else {
    const body = (await request.json().catch(() => null)) as { csv?: unknown } | null;
    csv = typeof body?.csv === "string" ? body.csv : "";
  }
  if (!csv.trim()) return NextResponse.json({ error: "Send a CSV body, or JSON with a csv field." }, { status: 400 });

  try {
    return NextResponse.json(await importCsv(csv));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}
