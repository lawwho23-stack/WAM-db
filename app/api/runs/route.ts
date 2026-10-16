import { NextResponse } from "next/server";
import { sql, getScope } from "@/lib/db";

// GET /api/runs?scope=pr-reviewer — process view list
// POST /api/runs — create one run record per PR + SHA (dedupe by idempotency_key)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const scopeName = searchParams.get("scope") || "pr-reviewer";
  try {
    const db = sql();
    const scope = await getScope(scopeName);
    const rows = await db`SELECT r.id, a.name as agent, r.external_id, r.repository, r.pr_number, r.status, r.current_stage, r.findings_count, r.summary, r.created_at,
      (SELECT count(*)::int FROM agent_run_events e WHERE e.run_id = r.id) as events
      FROM agent_runs r JOIN agents a ON a.id = r.agent_id
      WHERE r.scope_id = ${scope.id} ORDER BY r.created_at DESC LIMIT 30`;
    return NextResponse.json({ scope: scopeName, count: rows.length, results: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const b = await req.json();
  if (!b.agent || !b.external_id || !b.repository)
    return NextResponse.json({ error: "agent, external_id, repository required" }, { status: 400 });
  try {
    const db = sql();
    const scope = await getScope(b.scope || "pr-reviewer");
    const ag = await db`SELECT id FROM agents WHERE workspace_id = ${scope.workspace_id} AND name = ${b.agent} LIMIT 1`;
    if (ag.length === 0) return NextResponse.json({ error: `Agent '${b.agent}' not found` }, { status: 400 });
    const agentId = ag[0].id as string;
    const rows = await db`INSERT INTO agent_runs (workspace_id, scope_id, agent_id, external_id, idempotency_key, repository, pr_number, commit_sha, status, current_stage, summary)
      VALUES (${scope.workspace_id}, ${scope.id}, ${agentId}, ${b.external_id}, ${b.external_id}, ${b.repository}, ${b.pr_number ?? null}, ${b.commit_sha ?? null}, ${b.status ?? "queued"}, ${b.current_stage ?? "queued"}, ${b.summary ?? null})
      ON CONFLICT (agent_id, external_id) DO NOTHING RETURNING id`;
    if (rows.length === 0) {
      const ex = await db`SELECT id, status FROM agent_runs WHERE agent_id = ${agentId} AND external_id = ${b.external_id} LIMIT 1`;
      return NextResponse.json({ id: ex[0].id, duplicate: true, status: ex[0].status });
    }
    const id = rows[0].id as string;
    await db`INSERT INTO agent_run_events (run_id, stage, message, level) VALUES (${id}, 'queued', ${"Run created " + b.external_id}, 'info')`;
    return NextResponse.json({ id, duplicate: false });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
