import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

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
