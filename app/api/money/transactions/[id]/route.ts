import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteTransaction, getTransaction, toMinor, updateTransaction, type Currency } from "@/lib/money";
import { requireOwner } from "@/lib/owner-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amount: z.number().refine((n) => n !== 0, "An amount of zero moves nothing.").optional(),
  currency: z.enum(["THB", "MMK", "USD"]).optional(),
  rateToThb: z.number().positive().optional(),
  payee: z.string().max(120).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  tags: z.array(z.string().max(30)).max(12).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { id } = await params;
  const transaction = await getTransaction(id);
  if (!transaction) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
  return NextResponse.json({ transaction });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { id } = await params;
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });

  const { amount, ...rest } = parsed.data;
  try {
    const transaction = await updateTransaction(id, {
      ...rest,
      currency: rest.currency as Currency | undefined,
      amountMinor: amount === undefined ? undefined : toMinor(amount),
    });
    return NextResponse.json({ transaction });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { id } = await params;
  try {
    return NextResponse.json(await deleteTransaction(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}
