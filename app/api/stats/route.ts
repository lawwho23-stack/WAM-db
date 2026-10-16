import { NextResponse } from "next/server";
import { scopeStats } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const scope = new URL(req.url).searchParams.get("scope") || "laww-personal";
  try {
    return NextResponse.json(await scopeStats(scope));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
