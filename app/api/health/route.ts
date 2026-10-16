import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

// Without this, Next.js prerenders this route at build time and serves a
// cached result — the health check would never touch the database.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = sql();
    await db`SELECT 1 as ok`;
    return NextResponse.json({ ok: true, db: true, time: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, db: false, error: e instanceof Error ? e.message : "db error" },
      { status: 500 }
    );
  }
}
