import { NextResponse } from "next/server";
import { updateMemory } from "@/lib/memory";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  if (!body.content) return NextResponse.json({ error: "content required" }, { status: 400 });
  try {
    const out = await updateMemory(params.id, body.content, body.reason || "edit");
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
