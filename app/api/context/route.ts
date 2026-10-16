import { NextResponse } from "next/server";
import { getContext } from "@/lib/memory";

export async function GET(req: Request) {
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
