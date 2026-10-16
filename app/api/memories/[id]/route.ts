import { NextResponse } from "next/server";
import { z } from "zod";
import { getMemoryDetail, updateMemory, setMemoryPin, setMemoryState } from "@/lib/memory";
import { requireOwner } from "@/lib/owner-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { id } = await params;
  try {
    return NextResponse.json(await getMemoryDetail(id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 404 });
  }
}

const PatchSchema = z.object({
  content: z.string().min(1).max(8000).optional(),
  reason: z.string().max(200).optional(),
  pinned: z.boolean().optional(),
  state: z.enum(["active", "expired", "deleted"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { id } = await params;
  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  const { content, reason, pinned, state } = parsed.data;
  if (content === undefined && pinned === undefined && state === undefined) {
    return NextResponse.json({ error: "Nothing to change. Send content, pinned or state." }, { status: 400 });
  }

  try {
    const out: Record<string, unknown> = {};
    if (content !== undefined) Object.assign(out, await updateMemory(id, content, reason ?? "edit"));
    if (pinned !== undefined) out.pin = await setMemoryPin(id, pinned);
    if (state !== undefined) out.state = await setMemoryState(id, state);
    return NextResponse.json({ id, ...out });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}

/** Soft delete. The row stays in the table with state = 'deleted'. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { id } = await params;
  try {
    return NextResponse.json(await setMemoryState(id, "deleted"));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
