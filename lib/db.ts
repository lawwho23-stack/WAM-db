import { neon } from "@neondatabase/serverless";

// Technical term: serverless driver = DB client that works inside Vercel Functions (no always-on connection).
export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is missing. Copy .env.example to .env.local.");
  return neon(url);
}

export async function getWorkspaceId(name = "laww-main"): Promise<string> {
  const db = sql();
  const rows = await db`SELECT id FROM workspaces WHERE name = ${name} LIMIT 1`;
  if (rows.length === 0) throw new Error(`Workspace '${name}' not found. Seed the DB first.`);
  return rows[0].id as string;
}

export async function getScope(scopeName: string) {
  const db = sql();
  const rows = await db`SELECT id, workspace_id, kind, name FROM scopes WHERE name = ${scopeName} LIMIT 1`;
  if (rows.length === 0) throw new Error(`Scope '${scopeName}' not found.`);
  return rows[0] as { id: string; workspace_id: string; kind: string; name: string };
}

export async function getActorByKind(workspaceId: string, kind: string) {
  const db = sql();
  const rows = await db`SELECT id FROM actors WHERE workspace_id = ${workspaceId} AND kind = ${kind} LIMIT 1`;
  if (rows.length === 0) throw new Error(`No actor kind='${kind}' in workspace.`);
  return rows[0].id as string;
}
