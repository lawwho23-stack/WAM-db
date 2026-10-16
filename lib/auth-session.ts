import { scryptSync } from "node:crypto";

/**
 * Owner-only sign-in.
 *
 * There is exactly one account: the owner. No user table, no signup, no
 * password reset flow. Three environment variables decide everything:
 *
 *   OWNER_EMAIL          the only email that may sign in
 *   OWNER_PASSWORD       the passphrase (or OWNER_PASSWORD_HASH, preferred)
 *   SESSION_SECRET       32+ chars, signs the session cookie
 *
 * A signed cookie carries the session. It is tamper-proof, not encrypted —
 * the only thing inside is the owner email and an expiry, and both are checked
 * against the server's own values on every request.
 */

export const SESSION_COOKIE = "wam_session";
export const SESSION_DAYS = 30;

export type Session = { email: string; exp: number };

/** Read a required env var, failing closed when it is missing. */
function required(name: string, minLength = 1): string {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new Error(`${name} is missing${minLength > 1 ? ` or shorter than ${minLength} characters` : ""}.`);
  }
  return value;
}

/** Compare two strings without leaking their difference through timing. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The one email allowed in. Case-insensitive, whitespace-insensitive. */
export function isOwnerEmail(email: string): boolean {
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!owner) return false; // no owner configured: nobody gets in
  return email.trim().toLowerCase() === owner;
}

/**
 * Check a passphrase. Prefers OWNER_PASSWORD_HASH ("scrypt:<salt>:<hex>") so
 * the real passphrase never sits in an env var; falls back to OWNER_PASSWORD.
 */
export function verifyPassphrase(input: string): boolean {
  const stored = process.env.OWNER_PASSWORD_HASH?.trim();
  if (stored) {
    const [scheme, salt, hash] = stored.split(":");
    if (scheme !== "scrypt" || !salt || !hash) {
      throw new Error("OWNER_PASSWORD_HASH must look like scrypt:<salt>:<hex>.");
    }
    return safeEqual(scryptSync(input, salt, 64).toString("hex"), hash);
  }
  const plain = required("OWNER_PASSWORD");
  return safeEqual(input, plain);
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(required("SESSION_SECRET", 32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Buffer.from(new Uint8Array(signature)).toString("base64url");
}

/** Build a signed session value: payload.signature */
export async function createSession(email: string, days = SESSION_DAYS): Promise<string> {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + days * 86_400_000 })).toString("base64url");
  return `${payload}.${await sign(payload)}`;
}

/** Verify a cookie value. Returns the session, or null for anything suspect. */
export async function verifySession(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  let expected: string;
  try {
    expected = await sign(payload);
  } catch {
    return null; // SESSION_SECRET not configured: fail closed
  }
  if (!safeEqual(expected, signature)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (typeof parsed?.email !== "string" || typeof parsed?.exp !== "number") return null;
    if (parsed.exp < Date.now()) return null;
    if (!isOwnerEmail(parsed.email)) return null; // the allowlist still holds
    return parsed;
  } catch {
    return null;
  }
}

/** True when the owner login is fully configured, so /login can say so. */
export function authConfigured(): boolean {
  try {
    required("SESSION_SECRET", 32);
    required("OWNER_EMAIL");
    if (process.env.OWNER_PASSWORD_HASH) return true;
    required("OWNER_PASSWORD");
    return true;
  } catch {
    return false;
  }
}
