import { NextResponse } from "next/server";
import { z } from "zod";
import { writeMemory, listMemories } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WriteSchema = z.object({
  scope: z.string().default("laww-personal"),
  type: z.enum(["fact", "preference", "decision", "experience", "procedure", "run_record", "skill_ref"]).default("fact"),
  content: z.string().min(1).max(8000),
  fact_key: z.string().nullable().optional(),
  trust: z.enum(["owner_asserted", "source_extracted", "agent_reported", "inferred"]).default("owner_asserted"),
  importance: z.number().min(0).max(1).default(0.5),
  labels: z.array(z.string()).default([]),
});

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  try {
    const out = await listMemories({
      scope: p.get("scope") || "laww-personal",
      type: p.get("type") || undefined,
      trust: p.get("trust") || undefined,
      state: p.get("state") || "active",
      label: p.get("label") || undefined,
      limit: p.get("limit") ? Number(p.get("limit")) : 50,
      offset: p.get("offset") ? Number(p.get("offset")) : 0,
    });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const parsed = WriteSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  try {
    return NextResponse.json(await writeMemory(parsed.data));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
