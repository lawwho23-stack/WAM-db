import { NextResponse } from "next/server";
import { getContext } from "@/lib/memory";
import { requireOwner } from "@/lib/owner-guard";

export async function GET(req: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") || "laww-personal";
  const session = searchParams.get("session") || undefined;
  try {
    const ctx = await getContext(scope, session);
    return NextResponse.json(ctx);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
