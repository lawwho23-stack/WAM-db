import { NextResponse } from "next/server";
import { z } from "zod";
import { searchSkills, upsertSkill, getSkill, revokeSkill } from "@/lib/skills";
import { requireOwner } from "@/lib/owner-guard";

// Same skill functions the MCP tools call, so the UI and agents never drift.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UpsertSchema = z.object({
  scope: z.string().default("laww-personal"),
  command: z.string().regex(/^\/[a-z][a-z0-9_]{0,63}$/, "Command must look like /review"),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  body: z.string().min(1),
});

export async function GET(req: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const p = new URL(req.url).searchParams;
  try {
    const results = await searchSkills(p.get("scope") || "laww-personal", p.get("q") || "");
    return NextResponse.json({ count: results.length, results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const parsed = UpsertSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  try {
    return NextResponse.json(await upsertSkill(parsed.data));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}

/** Load one skill in full (the body search_skills deliberately omits). */
export async function PATCH(req: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const parsed = z
    .object({ scope: z.string().default("laww-personal"), command: z.string() })
    .safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  try {
    return NextResponse.json(await getSkill(parsed.data.scope, parsed.data.command));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 404 });
  }
}

export async function DELETE(req: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const parsed = z
    .object({ scope: z.string().default("laww-personal"), command: z.string() })
    .safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  try {
    return NextResponse.json(await revokeSkill(parsed.data.scope, parsed.data.command));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
