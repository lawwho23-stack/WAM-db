import { NextResponse } from "next/server";
import { z } from "zod";
import { sql, getScope } from "@/lib/db";
import { writeMemory } from "@/lib/memory";

const WriteSchema = z.object({
  scope: z.string().default("laww-personal"),
  type: z.enum(["fact", "preference", "decision", "experience", "procedure", "run_record", "skill_ref"]).default("fact"),
  content: z.string().min(1).max(8000),
  fact_key: z.string().nullable().optional(),
  trust: z.enum(["owner_asserted", "source_extracted", "agent_reported", "inferred"]).default("agent_reported"),
  importance: z.number().min(0).max(1).default(0.5),
  labels: z.array(z.string()).default([]),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const scopeName = searchParams.get("scope") || "laww-personal";
  try {
    const db = sql();
    const scope = await getScope(scopeName);
    const rows = await db`SELECT id, type, left(content, 200) as snippet, trust, importance, labels, state, updated_at
      FROM memories WHERE scope_id = ${scope.id} AND state = 'active' ORDER BY updated_at DESC LIMIT 50`;
    return NextResponse.json({ scope: scopeName, count: rows.length, results: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = WriteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    const out = await writeMemory(parsed.data);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
