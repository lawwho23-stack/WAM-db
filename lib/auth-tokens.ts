import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { sql, getWorkspaceId } from "./db";

// One token per agent. The raw value is shown once at creation and never
// stored — we keep a sha256 hash, so a database leak never hands out a
// working credential.

export type TokenContext = {
  tokenId: string;
  tokenName: string;
  workspaceId: string;
  /** null = token may reach every scope in the workspace */
  scopeId: string | null;
  scopeName: string | null;
  canRead: boolean;
  canWrite: boolean;
};

export function generateToken(): string {
  return "wam_" + randomBytes(24).toString("hex");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Pull a bearer token out of an Authorization header. */
export function bearerFrom(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  // Fallback for clients that cannot set headers (query param).
  const url = new URL(req.url);
  const qp = url.searchParams.get("token");
  return qp ? qp.trim() : null;
}

export async function createToken(input: {
  name: string;
  scope?: string | null;
  canRead?: boolean;
  canWrite?: boolean;
}) {
  const db = sql();
  const workspaceId = await getWorkspaceId();

  let scopeId: string | null = null;
  if (input.scope) {
    const rows = await db`SELECT id FROM scopes WHERE workspace_id = ${workspaceId} AND name = ${input.scope} LIMIT 1`;
    if (rows.length === 0) throw new Error(`Scope '${input.scope}' not found.`);
    scopeId = rows[0].id as string;
  }

  const raw = generateToken();
  const rows = await db`INSERT INTO api_tokens (workspace_id, name, token_hash, token_prefix, scope_id, can_read, can_write)
    VALUES (${workspaceId}, ${input.name}, ${hashToken(raw)}, ${raw.slice(0, 12)}, ${scopeId}, ${input.canRead ?? true}, ${input.canWrite ?? true})
    RETURNING id, name, token_prefix, created_at`;

  // The raw token is returned exactly once, here.
  return { ...(rows[0] as Record<string, unknown>), token: raw } as {
    id: string; name: string; token_prefix: string; created_at: string; token: string;
  };
}

export async function listTokens() {
  const db = sql();
  const workspaceId = await getWorkspaceId();
  return db`SELECT t.id, t.name, t.token_prefix, t.can_read, t.can_write, t.last_used_at, t.revoked_at, t.created_at,
      s.name AS scope
    FROM api_tokens t LEFT JOIN scopes s ON s.id = t.scope_id
    WHERE t.workspace_id = ${workspaceId}
    ORDER BY t.created_at DESC`;
}

export async function revokeToken(id: string, purge = false) {
  const db = sql();
  if (purge) {
    // Hard delete: removes the row entirely, for test tokens and rotated keys.
    const rows = await db`DELETE FROM api_tokens WHERE id = ${id} RETURNING id`;
    if (rows.length === 0) throw new Error("Token not found.");
    return { id, purged: true };
  }
  const rows = await db`UPDATE api_tokens SET revoked_at = now() WHERE id = ${id} AND revoked_at IS NULL RETURNING id`;
  if (rows.length === 0) throw new Error("Token not found or already revoked.");
  return { id, revoked: true };
}

/** Resolve a raw bearer token to its permission context, or null. */
export async function resolveToken(raw: string): Promise<TokenContext | null> {
  if (!raw || raw.length < 20) return null;
  const db = sql();
  const rows = await db`SELECT t.id, t.name, t.workspace_id, t.scope_id, t.can_read, t.can_write, s.name AS scope_name
    FROM api_tokens t LEFT JOIN scopes s ON s.id = t.scope_id
    WHERE t.token_hash = ${hashToken(raw)} AND t.revoked_at IS NULL
    LIMIT 1`;
  if (rows.length === 0) return null;
  const r = rows[0] as Record<string, string | boolean | null>;
  return {
    tokenId: r.id as string,
    tokenName: r.name as string,
    workspaceId: r.workspace_id as string,
    scopeId: (r.scope_id as string) ?? null,
    scopeName: (r.scope_name as string) ?? null,
    canRead: r.can_read as boolean,
    canWrite: r.can_write as boolean,
  };
}

export async function touchToken(id: string) {
  const db = sql();
  await db`UPDATE api_tokens SET last_used_at = now() WHERE id = ${id}`;
}

/**
 * Find or create the `actors` row that represents this token's agent, so
 * history says which agent wrote what instead of one generic "agent".
 * Relies on uq_actors_workspace_kind_name (migrations/002_actor_identity.sql).
 */
export async function actorForToken(ctx: TokenContext): Promise<string> {
  const db = sql();
  const name = ctx.tokenName.slice(0, 64);
  const existing = await db`SELECT id FROM actors WHERE workspace_id = ${ctx.workspaceId} AND kind = 'agent' AND display_name = ${name} LIMIT 1`;
  if (existing.length > 0) return existing[0].id as string;

  const inserted = await db`INSERT INTO actors (workspace_id, kind, display_name)
    VALUES (${ctx.workspaceId}, 'agent', ${name})
    ON CONFLICT (workspace_id, kind, display_name) DO NOTHING
    RETURNING id`;
  if (inserted.length > 0) return inserted[0].id as string;

  // Lost a race with a concurrent create.
  const again = await db`SELECT id FROM actors WHERE workspace_id = ${ctx.workspaceId} AND kind = 'agent' AND display_name = ${name} LIMIT 1`;
  if (again.length === 0) throw new Error(`Could not resolve an actor for token '${ctx.tokenName}'.`);
  return again[0].id as string;
}

/** Constant-time compare helper for any future shared-secret checks. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
