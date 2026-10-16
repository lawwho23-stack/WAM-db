import { NextResponse } from "next/server";
import { z } from "zod";
import { createTransaction, listTransactions, toMinor, type CategoryKind, type Currency } from "@/lib/money";
import { requireOwner } from "@/lib/owner-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const CreateSchema = z.object({
  accountId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  occurredOn: z.string().regex(DAY, "Use YYYY-MM-DD."),
  amount: z.number().refine((n) => n !== 0, "An amount of zero moves nothing."),
  currency: z.enum(["THB", "MMK", "USD"]).optional(),
  rateToThb: z.number().positive().optional(),
  payee: z.string().max(120).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  tags: z.array(z.string().max(30)).max(12).optional(),
});

/** GET /api/money/transactions — filters: month, from, to, accountId, categoryId, kind, q, limit, offset. */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const p = new URL(request.url).searchParams;
  try {
    const out = await listTransactions({
      month: p.get("month"),
      from: p.get("from"),
      to: p.get("to"),
      accountId: p.get("accountId"),
      categoryId: p.get("categoryId"),
      kind: (p.get("kind") as CategoryKind | null) ?? null,
      q: p.get("q"),
      limit: p.get("limit") ? Number(p.get("limit")) : 100,
      offset: p.get("offset") ? Number(p.get("offset")) : 0,
    });
    return NextResponse.json(out);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}

/** POST /api/money/transactions — the amount arrives in major units and is stored in minor ones. */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });

  try {
    const transaction = await createTransaction({
      accountId: parsed.data.accountId,
      categoryId: parsed.data.categoryId ?? null,
      occurredOn: parsed.data.occurredOn,
      amountMinor: toMinor(parsed.data.amount),
      currency: parsed.data.currency as Currency | undefined,
      rateToThb: parsed.data.rateToThb,
      payee: parsed.data.payee ?? null,
      note: parsed.data.note ?? null,
      tags: parsed.data.tags ?? [],
      source: "manual",
    });
    return NextResponse.json({ transaction }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}
