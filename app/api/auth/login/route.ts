import { NextResponse } from "next/server";
import { authConfigured, createSession, isOwnerEmail, verifyPassphrase } from "@/lib/auth-session";
import { withSessionCookie } from "@/lib/owner-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login  { email, password }
 *
 * Two things must both be true: the email is the owner's, and the passphrase
 * matches. A wrong email and a wrong passphrase return the same message, so the
 * response never confirms which half was right.
 *
 * Attempts are rate limited in memory. That is best effort — serverless
 * instances come and go — but it turns an unlimited guessing loop into a slow
 * one, and the passphrase check is deliberately expensive (scrypt).
 */

const MAX_ATTEMPTS = 6;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { count: number; first: number }>();

function clientKey(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "local"
  );
}

function tooMany(key: string) {
  const record = attempts.get(key);
  if (!record) return false;
  if (Date.now() - record.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function noteFailure(key: string) {
  const record = attempts.get(key);
  if (!record || Date.now() - record.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else record.count += 1;
}

// scrypt is intentionally slow; give the function room on a cold start.
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json(
      { error: "Sign-in is not configured. Set OWNER_EMAIL, OWNER_PASSWORD and SESSION_SECRET." },
      { status: 503 },
    );
  }

  let email = "";
  let password = "";
  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    email = typeof body.email === "string" ? body.email : "";
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Send JSON with an email and a passphrase." }, { status: 400 });
  }

  const key = clientKey(request);
  if (tooMany(key)) {
    return NextResponse.json({ error: "Too many attempts. Wait ten minutes and try again." }, { status: 429 });
  }

  const ok = email.length > 0 && password.length > 0 && isOwnerEmail(email) && verifyPassphrase(password);
  if (!ok) {
    noteFailure(key);
    return NextResponse.json({ error: "That email and passphrase do not match the owner." }, { status: 401 });
  }

  attempts.delete(key);
  return withSessionCookie(NextResponse.json({ ok: true, email: email.trim().toLowerCase() }), await createSession(email));
}
