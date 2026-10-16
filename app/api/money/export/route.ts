import { listTransactions, toCsv } from "@/lib/money";
import { requireOwner } from "@/lib/owner-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/money/export?from=&to=&month= — the same CSV shape that /import accepts. */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const p = new URL(request.url).searchParams;
  try {
    const { rows } = await listTransactions({
      month: p.get("month"),
      from: p.get("from"),
      to: p.get("to"),
      accountId: p.get("accountId"),
      categoryId: p.get("categoryId"),
      q: p.get("q"),
      limit: 500,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(toCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="wam-money-${stamp}.csv"`,
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "error" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
}
