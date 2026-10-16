import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_DAYS, verifySession, type Session } from "@/lib/auth-session";

/**
 * Server-side owner checks.
 *
 * `proxy.ts` already turns anonymous requests away before they reach a route,
 * but Next's own guidance is to verify again inside the handler — a matcher
 * change can silently drop coverage. These are cheap, so every API route calls
 * one of them.
 */

/** The signed-in owner for this request, or null. */
export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

/** Returns a 401 response when the caller is not the owner, else null. */
export async function requireOwner(): Promise<NextResponse | null> {
  const session = await currentSession();
  if (session) return null;
  return NextResponse.json({ error: "Owner sign-in required.", signIn: "/login" }, { status: 401 });
}

/** Attach the session cookie to a response. */
export function withSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return response;
}

/** Clear the session cookie. */
export function withoutSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set({ name: SESSION_COOKIE, value: "", httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
