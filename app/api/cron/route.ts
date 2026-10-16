import { NextResponse } from "next/server";
import { runQueuedJobs, backfillEmbeddings, decayImportance } from "@/lib/memory";
import { refreshRatesFromFeed } from "@/lib/money";
import { safeEqual } from "@/lib/auth-tokens";

// Background jobs. Writes return fast and this drains what they queued:
// embeddings first, then nightly decay of memories nobody has retrieved, then
// the day's exchange rates.
//
// Guarded by CRON_SECRET. Vercel Cron sends it as an Authorization bearer
// header; a manual run can pass ?secret= instead.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.replace(/^Bearer\s+/i, "").trim();
  const query = new URL(req.url).searchParams.get("secret") ?? "";
  return (bearer && safeEqual(bearer, secret)) || (query && safeEqual(query, secret));
}

async function run(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized. Set CRON_SECRET and pass it as a bearer token or ?secret=." }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const job = params.get("job") ?? "all";
  const limit = Math.min(Number(params.get("limit") ?? 25) || 25, 100);

  try {
    const started = Date.now();
      const result =
        job === "embed" ? await backfillEmbeddings(limit)
        : job === "decay" ? await decayImportance()
        : job === "rates" ? { rates: await refreshRatesFromFeed() }
        : {
            ...(await runQueuedJobs(limit)),
            // The daily run also keeps the kyat and the dollar fresh. A feed
            // that is down must not fail the memory jobs, so it is caught and
            // reported rather than thrown.
            rates: await refreshRatesFromFeed().catch((e) => ({
              error: e instanceof Error ? e.message : "rate feed error",
            })),
          };
    return NextResponse.json({ ok: true, job, ...result, ms: Date.now() - started, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "job error" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
