import { NextResponse } from "next/server";
import { searchMemory } from "@/lib/memory";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") || "laww-personal";
  const q = searchParams.get("q") || "";
  if (!q) return NextResponse.json({ error: "Add ?q=your+question" }, { status: 400 });
  try {
    const rows = await searchMemory(scope, q, 8);
    return NextResponse.json({ query: q, scope, count: rows.length, results: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  try {
    const rows = await searchMemory(body.scope || "laww-personal", body.query, 8);
    return NextResponse.json({ count: rows.length, results: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
