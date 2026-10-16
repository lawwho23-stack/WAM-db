import { createHash } from "crypto";
import { sql, getScope, getActorByKind } from "./db";
import { embedTexts, embedModel, toPgVector } from "./embeddings";
import { sessionGet } from "./redis";

export function contentHash(content: string) {
  return createHash("sha256").update(content).digest("hex").slice(0, 32);
}

export type WriteInput = {
  scope: string;
  type: string;
  content: string;
  fact_key?: string | null;
  trust?: string;
  importance?: number;
  labels?: string[];
  actorKind?: string; // 'owner' | 'agent'
};

// write_memory: save fact. Direct to active. Same fact_key = old row becomes superseded.
export async function writeMemory(input: WriteInput) {
  const db = sql();
  const scope = await getScope(input.scope);
  const actorId = await getActorByKind(scope.workspace_id, input.actorKind ?? "agent");
  const hash = contentHash(input.content);

  const dup = await db`SELECT id FROM memories WHERE scope_id = ${scope.id} AND type = ${input.type} AND content_hash = ${hash} AND state = 'active' LIMIT 1`;
  if (dup.length > 0) return { id: dup[0].id as string, deduped: true };

  if (input.fact_key) {
    const old = await db`SELECT id FROM memories WHERE scope_id = ${scope.id} AND type = ${input.type} AND fact_key = ${input.fact_key} AND state = 'active' LIMIT 1`;
    if (old.length > 0) {
      const oldId = old[0].id as string;
      await db`UPDATE memories SET state = 'superseded', updated_at = now() WHERE id = ${oldId}`;
      await db`INSERT INTO memory_versions (memory_id, version, content, state, actor_id, reason) SELECT id, version, content, 'superseded', ${actorId}, 'replaced by fact_key' FROM memories WHERE id = ${oldId}`;
      await db`INSERT INTO knowledge_jobs (workspace_id, scope_id, kind, status, ref_type, ref_id) VALUES (${scope.workspace_id}, ${scope.id}, 'supersede', 'done', 'memory', ${oldId})`;
    }
  }

  const rows = await db`INSERT INTO memories (workspace_id, scope_id, type, content, content_hash, fact_key, labels, trust, importance, created_by)
    VALUES (${scope.workspace_id}, ${scope.id}, ${input.type}, ${input.content}, ${hash}, ${input.fact_key ?? null}, ${input.labels ?? []}, ${input.trust ?? "agent_reported"}, ${input.importance ?? 0.5}, ${actorId})
    RETURNING id, version`;
  const id = rows[0].id as string;
  const version = rows[0].version as number;
  await db`INSERT INTO memory_versions (memory_id, version, content, state, actor_id, reason) VALUES (${id}, ${version}, ${input.content}, 'active', ${actorId}, 'initial write')`;
  await db`INSERT INTO memory_usage (memory_id) VALUES (${id}) ON CONFLICT (memory_id) DO NOTHING`;
  await db`INSERT INTO knowledge_jobs (workspace_id, scope_id, kind, status, ref_type, ref_id) VALUES (${scope.workspace_id}, ${scope.id}, 'embed', 'queued', 'memory', ${id})`;

  // Try to embed now. If no API key, job stays queued and keyword search still works.
  try {
    const [vec] = await embedTexts([input.content]);
    await db`INSERT INTO memory_embeddings (memory_id, workspace_id, memory_version, content_hash, model, dimensions, embedding)
      VALUES (${id}, ${scope.workspace_id}, ${version}, ${hash}, ${embedModel()}, 1024, ${toPgVector(vec)}::vector)`;
    await db`UPDATE knowledge_jobs SET status = 'done', updated_at = now() WHERE ref_id = ${id} AND kind = 'embed'`;
  } catch {
    // leave queued
  }
  return { id, deduped: false };
}

// search_memory: keyword + importance + usage. Vector rerank when embeddings exist.
export async function searchMemory(scopeName: string, query: string, limit = 8) {
  const db = sql();
  const scope = await getScope(scopeName);
  const rows = await db`
    SELECT m.id, m.type, m.content, m.trust, m.importance, m.labels,
      ts_rank(m.content_tsv, plainto_tsquery('english', ${query})) AS rank,
      COALESCE(u.retrievals, 0) AS retrievals
    FROM memories m LEFT JOIN memory_usage u ON u.memory_id = m.id
    WHERE m.scope_id = ${scope.id} AND m.state = 'active'
      AND m.content_tsv @@ plainto_tsquery('english', ${query})
    ORDER BY rank DESC, m.importance DESC LIMIT ${limit}`;
  if (rows.length > 0) {
    const ids = (rows as { id: string }[]).map((r) => r.id);
    for (const id of ids) {
      await db`INSERT INTO memory_usage (memory_id, retrievals, last_used_at) VALUES (${id}, 1, now())
        ON CONFLICT (memory_id) DO UPDATE SET retrievals = memory_usage.retrievals + 1, last_used_at = now()`;
    }
  }
  return rows;
}

// get_context: pinned + recent + session notes. Small pack for the model.
export async function getContext(scopeName: string, sessionId?: string) {
  const db = sql();
  const scope = await getScope(scopeName);
  const pinned = await db`SELECT id, type, content, trust, importance FROM memories
    WHERE scope_id = ${scope.id} AND state = 'active' AND labels @> '{pinned}' ORDER BY importance DESC LIMIT 10`;
  const recent = await db`SELECT id, type, content, trust, importance, updated_at FROM memories
    WHERE scope_id = ${scope.id} AND state = 'active' ORDER BY updated_at DESC LIMIT 10`;
  const session = sessionId ? await sessionGet(scopeName, sessionId) : [];
  return { scope: scope.name, pinned, recent, session, hint: "Pinned first, then recent. Session notes are short-term." };
}

export async function updateMemory(id: string, content: string, reason = "edit") {
  const db = sql();
  const cur = await db`SELECT id, workspace_id, scope_id, version FROM memories WHERE id = ${id} LIMIT 1`;
  if (cur.length === 0) throw new Error("Memory not found");
  const m = cur[0] as { workspace_id: string; scope_id: string; version: number };
  const actorId = await getActorByKind(m.workspace_id, "owner");
  const hash = contentHash(content);
  const next = (m.version as number) + 1;
  await db`UPDATE memories SET content = ${content}, content_hash = ${hash}, version = ${next}, updated_at = now() WHERE id = ${id}`;
  await db`INSERT INTO memory_versions (memory_id, version, content, state, actor_id, reason) VALUES (${id}, ${next}, ${content}, 'active', ${actorId}, ${reason})`;
  return { id, version: next };
}
