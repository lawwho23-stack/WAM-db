import { NextResponse } from "next/server";
import { z } from "zod";
import { accountsWithThb, createAccount, updateAccount, purgeAccount, toMinor, todayISO, type AccountKind } from "@/lib/money";
import { requireOwner } from "@/lib/owner-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["cash", "bank", "ewallet", "credit", "investment", "other"]).default("bank"),
  currency: z.enum(["THB", "MMK", "USD"]),
  openingBalance: z.number().min(-1_000_000_000).max(1_000_000_000).default(0),
  note: z.string().max(500).nullable().optional(),
});

const PatchSchema = CreateSchema.partial().extend({ id: z.string().uuid(), archived: z.boolean().optional() });

/** GET /api/money/accounts — every account with its balance in THB too. */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const includeArchived = new URL(request.url).searchParams.get("all") === "1";
  try {
    return NextResponse.json({ accounts: await accountsWithThb(todayISO(), { includeArchived }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}

/** POST /api/money/accounts — a new place money sits. Opening balance is in major units. */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });

  try {
    const account = await createAccount({
      name: parsed.data.name,
      kind: parsed.data.kind as AccountKind,
      currency: parsed.data.currency,
      openingBalanceMinor: toMinor(parsed.data.openingBalance),
      note: parsed.data.note ?? null,
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}

/** PATCH /api/money/accounts — rename, re-open, archive. */
export async function PATCH(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });

  const { id, openingBalance, ...rest } = parsed.data;
  try {
    const account = await updateAccount(id, {
      ...rest,
      kind: rest.kind as AccountKind | undefined,
      openingBalanceMinor: openingBalance === undefined ? undefined : toMinor(openingBalance),
    });
    return NextResponse.json({ account });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}

/**
 * DELETE /api/money/accounts — remove an account for good.
 *
 * Refused while it still has live transactions; archiving is the way to retire
 * an account that has history. This exists for accounts created by mistake and
 * for clearing out test data.
 */
export async function DELETE(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const parsed = z.object({ id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });

  try {
    return NextResponse.json(await purgeAccount(parsed.data.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}
