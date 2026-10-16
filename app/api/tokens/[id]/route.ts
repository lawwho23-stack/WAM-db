import { NextResponse } from "next/server";
import { revokeToken } from "@/lib/auth-tokens";
import { requireOwner } from "@/lib/owner-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/tokens/[id]          revoke (kept in the list for the record)
 * DELETE /api/tokens/[id]?purge=1  remove the row entirely
 *
 * Purge is for test tokens and rotated keys, where the record has no value.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { id } = await params;
  const purge = new URL(req.url).searchParams.get("purge") === "1";
  try {
    return NextResponse.json(await revokeToken(id, purge));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
