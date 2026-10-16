import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth-session";

/**
 * The front door.
 *
 * Next 16 renamed `middleware.ts` to `proxy.ts`; same behaviour, and it runs on
 * the Node.js runtime by default. Everything is closed unless it is on the
 * public list below:
 *
 *   /login              the sign-in form itself
 *   /api/auth/login     the only endpoint that can mint a session
 *   /api/mcp            agents authenticate with their own bearer token
 *   /api/cron           Vercel Cron authenticates with CRON_SECRET
 *   /api/health         says whether the database answers, nothing else
 *
 * Pages redirect to /login with a `next` so the owner lands back where they
 * were. API routes get a 401 JSON, because a redirect would look like success
 * to a fetch() caller.
 *
 * Routes check again inside themselves (lib/owner-guard.ts) — a matcher edit
 * here must never be the only thing standing between a stranger and the data.
 */

const PUBLIC_EXACT = new Set(["/login", "/api/auth/login", "/api/mcp", "/api/cron", "/api/health", "/icon.svg", "/favicon.ico"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_EXACT.has(pathname)) return NextResponse.next();

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Owner sign-in required.", signIn: "/login" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip compiled assets, images and the favicon; everything else is checked.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
