import { NextResponse } from "next/server";
import { sql, getScope, getActorByKind } from "@/lib/db";

// GET /api/skills?scope=laww-personal&q=review — search_skills
// POST /api/skills — add new skill version
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const scopeName = searchParams.get("scope") || "laww-personal";
  const q = searchParams.get("q") || "";
  try {
    const db = sql();
    const scope = await getScope(scopeName);
    if (!q) {
      const rows = await db`SELECT s.command, sv.title, sv.version, s.revoked FROM skills s
        JOIN skill_versions sv ON sv.skill_id = s.id AND sv.version = s.active_version
        WHERE s.scope_id = ${scope.id} AND s.revoked = false LIMIT 50`;
      return NextResponse.json({ count: rows.length, results: rows });
    }
    const rows = await db`SELECT s.command, sv.title, sv.description FROM skills s
      JOIN skill_versions sv ON sv.skill_id = s.id
      WHERE s.scope_id = ${scope.id} AND s.revoked = false
      AND (sv.title ILIKE ${"%" + q + "%"} OR sv.description ILIKE ${"%" + q + "%"})
      LIMIT 10`;
    return NextResponse.json({ count: rows.length, results: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const b = await req.json();
  if (!b.command || !b.title || !b.description || !b.body)
    return NextResponse.json({ error: "command, title, description, body required" }, { status: 400 });
  try {
    const db = sql();
    const scope = await getScope(b.scope || "laww-personal");
    const actorId = await getActorByKind(scope.workspace_id, "owner");
    const found = await db`SELECT id FROM skills WHERE scope_id = ${scope.id} AND command = ${b.command} LIMIT 1`;
    let skillId: string;
    let version = 1;
    if (found.length === 0) {
      const r = await db`INSERT INTO skills (workspace_id, scope_id, command, revision, active_version)
        VALUES (${scope.workspace_id}, ${scope.id}, ${b.command}, 1, 1) RETURNING id`;
      skillId = r[0].id as string;
    } else {
      skillId = found[0].id as string;
      const mx = await db`SELECT COALESCE(MAX(version),0)+1 as v FROM skill_versions WHERE skill_id = ${skillId}`;
      version = mx[0].v as number;
      await db`UPDATE skills SET revision = revision + 1, active_version = ${version} WHERE id = ${skillId}`;
    }
    await db`INSERT INTO skill_versions (skill_id, workspace_id, version, title, description, body, created_by)
      VALUES (${skillId}, ${scope.workspace_id}, ${version}, ${b.title}, ${b.description}, ${b.body}, ${actorId})`;
    if (version === 1 && found.length > 0) {
      await db`UPDATE skills SET active_version = ${version} WHERE id = ${skillId}`;
    }
    return NextResponse.json({ skill_id: skillId, version });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
