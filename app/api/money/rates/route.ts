import { NextResponse } from "next/server";
import { z } from "zod";
import { latestRates, listRates, refreshRatesFromFeed, upsertRate, todayISO } from "@/lib/money";
import { requireOwner } from "@/lib/owner-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostSchema = z.union([
  z.object({ refresh: z.literal(true) }),
  z.object({
    currency: z.enum(["MMK", "USD"]),
    rate: z.number().positive(),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
]);

/** GET /api/money/rates — the rate in force today, plus the recent history. */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const [current, history] = await Promise.all([latestRates(todayISO()), listRates(24)]);
    return NextResponse.json({ current, history });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}

/** POST /api/money/rates — set a rate by hand, or pull today's from the feed. */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });

  try {
    if ("refresh" in parsed.data) return NextResponse.json({ updated: await refreshRatesFromFeed() });
    const rate = await upsertRate(parsed.data.currency, parsed.data.rate, parsed.data.asOf ?? todayISO(), "manual");
    return NextResponse.json({ rate }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}
