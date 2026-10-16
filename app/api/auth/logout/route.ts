import { NextResponse } from "next/server";
import { withoutSessionCookie } from "@/lib/owner-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/logout — drop the session cookie. */
export async function POST() {
  return withoutSessionCookie(NextResponse.json({ ok: true }));
}
