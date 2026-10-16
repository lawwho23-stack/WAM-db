import { createHash } from "crypto";
import { sql, getScope, getActorByKind } from "./db";
import { embedTexts, embedModel, toPgVector } from "./embeddings";
import { sessionGet } from "./redis";

// Memory core: write, hybrid search, context packs, history, jobs.
//
// Retrieval is two-legged: pgvector for meaning, Postgres full-text for exact
// words. The two ranked lists are merged with Reciprocal Rank Fusion (RRF),
// then nudged by importance, past usage and freshness. If the embedding
// provider is unavailable the keyword leg still answers on its own.

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
  source?: string; // what wrote it, e.g. 'mcp:claude-code'
};

const RRF_K = 60;
const LEG_SIZE = 25;

// ---------------------------------------------------------------- embeddings

/** Embed one memory version and store the vector. Returns true on success. */
async function embedMemoryVersion(db: ReturnType<typeof sql>, args: {
  memoryId: string;
  workspaceId: string;
  version: number;
  hash: string;
  content: string;
}) {
  const [vec] = await embedTexts([args.content]);
  await db`INSERT INTO memory_embeddings (memory_id, workspace_id, memory_version, content_hash, model, dimensions, embedding)
    VALUES (${args.memoryId}, ${args.workspaceId}, ${args.version}, ${args.hash}, ${embedModel()}, 1024, ${toPgVector(vec)}::vector)
    ON CONFLICT (memory_id, memory_version, model, dimensions) DO UPDATE SET embedding = EXCLUDED.embedding, created_at = now()`;
  return true;
}

async function queueJob(db: ReturnType<typeof sql>, args: {
  workspaceId: string; scopeId: string; kind: string; refType: string; refId: string; status?: string;
}) {
  await db`INSERT INTO knowledge_jobs (workspace_id, scope_id, kind, status, ref_type, ref_id)
    VALUES (${args.workspaceId}, ${args.scopeId}, ${args.kind}, ${args.status ?? "queued"}, ${args.refType}, ${args.refId})`;
}

async function markJob(db: ReturnType<typeof sql>, refId: string, kind: string, status: string, error?: string) {
  await db`UPDATE knowledge_jobs SET status = ${status}, error = ${error ?? null}, updated_at = now(), attempts = attempts + 1
    WHERE ref_id = ${refId} AND kind = ${kind} AND status IN ('queued','running')`;
}

// -------------------------------------------------------------------- writes

// write_memory: save a fact. Goes straight to active; same fact_key supersedes
// the older row so history is kept as explicit versions.
export async function writeMemory(input: WriteInput) {
  const db = sql();
  const scope = await getScope(input.scope);
  const actorId = await getActorByKind(scope.workspace_id, input.actorKind ?? "agent");
  const hash = contentHash(input.content);

  const dup = await db`SELECT id FROM memories WHERE scope_id = ${scope.id} AND type = ${input.type} AND content_hash = ${hash} AND state = 'active' LIMIT 1`;
  if (dup.length > 0) return { id: dup[0].id as string, deduped: true };

  if (input.fact_key) {
    const old = await db`SELECT id, version, content FROM memories WHERE scope_id = ${scope.id} AND type = ${input.type} AND fact_key = ${input.fact_key} AND state = 'active' LIMIT 1`;
    if (old.length > 0) {
      const oldId = old[0].id as string;
      const oldVersion = old[0].version as number;
      const oldContent = old[0].content as string;
      // Every change — content or state — adds a version row, so the history
      // is complete and (memory_id, version) stays unique.
      const oldNext = oldVersion + 1;
      await db`UPDATE memories SET state = 'superseded', version = ${oldNext}, updated_at = now() WHERE id = ${oldId}`;
      await db`INSERT INTO memory_versions (memory_id, version, content, state, actor_id, reason)
        VALUES (${oldId}, ${oldNext}, ${oldContent}, 'superseded', ${actorId}, 'replaced by fact_key')`;
      await queueJob(db, { workspaceId: scope.workspace_id, scopeId: scope.id, kind: "supersede", refType: "memory", refId: oldId, status: "done" });
    }
  }

  const rows = await db`INSERT INTO memories (workspace_id, scope_id, type, content, content_hash, fact_key, labels, trust, importance, created_by)
    VALUES (${scope.workspace_id}, ${scope.id}, ${input.type}, ${input.content}, ${hash}, ${input.fact_key ?? null}, ${input.labels ?? []}, ${input.trust ?? "agent_reported"}, ${input.importance ?? 0.5}, ${actorId})
    RETURNING id, version`;
  const id = rows[0].id as string;
  const version = rows[0].version as number;

  await db`INSERT INTO memory_versions (memory_id, version, content, state, actor_id, reason) VALUES (${id}, ${version}, ${input.content}, 'active', ${actorId}, 'initial write')`;
  await db`INSERT INTO memory_usage (memory_id) VALUES (${id}) ON CONFLICT (memory_id) DO NOTHING`;
  await queueJob(db, { workspaceId: scope.workspace_id, scopeId: scope.id, kind: "embed", refType: "memory", refId: id });

  // Try to embed right now; if the provider is down the job stays queued for
  // the cron runner and keyword search keeps working in the meantime.
  try {
    await embedMemoryVersion(db, { memoryId: id, workspaceId: scope.workspace_id, version, hash, content: input.content });
    await markJob(db, id, "embed", "done");
  } catch (e) {
    await markJob(db, id, "embed", "queued", e instanceof Error ? e.message.slice(0, 300) : "embed failed");
  }

  return { id, deduped: false };
}

/** Edit a memory: new version row, re-embed, keep the old text in history. */
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
  await queueJob(db, { workspaceId: m.workspace_id, scopeId: m.scope_id, kind: "embed", refType: "memory", refId: id });

  try {
    await embedMemoryVersion(db, { memoryId: id, workspaceId: m.workspace_id, version: next, hash, content });
    await markJob(db, id, "embed", "done");
  } catch (e) {
    await markJob(db, id, "embed", "queued", e instanceof Error ? e.message.slice(0, 300) : "embed failed");
  }

  return { id, version: next };
}

/** Pin or unpin: pinned items always ride along in get_context. */
export async function setMemoryPin(id: string, pinned: boolean) {
  const db = sql();
  const rows = await db`UPDATE memories SET labels = (
      SELECT ARRAY(SELECT DISTINCT unnest(
        CASE WHEN ${pinned} THEN labels || 'pinned'::text ELSE array_remove(labels, 'pinned') END))
    ), updated_at = now()
    WHERE id = ${id} RETURNING id, labels`;
  if (rows.length === 0) throw new Error("Memory not found");
  return rows[0];
}

/** Soft delete. Rows are never hard-deleted, so a mistake stays recoverable. */
export async function setMemoryState(id: string, state: "active" | "deleted" | "expired") {
  const db = sql();
  const cur = await db`SELECT workspace_id, version, content FROM memories WHERE id = ${id} LIMIT 1`;
  if (cur.length === 0) throw new Error("Memory not found");
  const m = cur[0] as { workspace_id: string; version: number; content: string };
  const actorId = await getActorByKind(m.workspace_id, "owner");
  const next = m.version + 1;
  const rows = await db`UPDATE memories SET state = ${state}, version = ${next}, updated_at = now() WHERE id = ${id} RETURNING id, state, version`;
  await db`INSERT INTO memory_versions (memory_id, version, content, state, actor_id, reason)
    VALUES (${id}, ${next}, ${m.content}, ${state}, ${actorId}, ${"state -> " + state})`;
  return rows[0];
}

// -------------------------------------------------------------------- search

export type SearchHit = {
  id: string;
  type: string;
  content: string;
  trust: string;
  importance: number;
  labels: string[];
  updated_at: string;
  retrievals: number;
  score: number;
  similarity: number | null;
  matched: { vector: boolean; keyword: boolean };
};

/**
 * Hybrid search. Vector leg finds meaning, keyword leg finds exact words,
 * RRF merges them, then importance / usage / freshness adjust the order.
 */
export async function searchMemory(scopeName: string, query: string, limit = 8): Promise<SearchHit[]> {
  const db = sql();
  const scope = await getScope(scopeName);
  const model = embedModel();

  const keywordPromise = (async () => {
    const rows = await db`
      SELECT m.id, ts_rank(m.content_tsv, plainto_tsquery('english', ${query})) AS rank
      FROM memories m
      WHERE m.scope_id = ${scope.id} AND m.state = 'active'
        AND m.content_tsv @@ plainto_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${LEG_SIZE}`;
    return rows as unknown as { id: string; rank: string }[];
  })();

  const vectorPromise = (async () => {
    const [vec] = await embedTexts([query]);
    return (await db`
      SELECT id, distance FROM (
        SELECT DISTINCT ON (m.id) m.id, (e.embedding <=> ${toPgVector(vec)}::vector) AS distance
        FROM memory_embeddings e
        JOIN memories m ON m.id = e.memory_id
        WHERE m.scope_id = ${scope.id} AND m.state = 'active' AND e.model = ${model}
        ORDER BY m.id, e.created_at DESC
      ) t
      ORDER BY distance ASC
      LIMIT ${LEG_SIZE}`) as { id: string; distance: string }[];
  })();

  const [keywordRes, vectorRes] = await Promise.allSettled([keywordPromise, vectorPromise]);
  const keyword = keywordRes.status === "fulfilled" ? keywordRes.value : [];
  const vector = vectorRes.status === "fulfilled" ? vectorRes.value : [];
  const degraded = vectorRes.status === "rejected";

  if (keyword.length === 0 && vector.length === 0) return [];

  // Reciprocal Rank Fusion: each list contributes 1/(K + rank).
  type Fused = { rrf: number; vectorRank?: number; keywordRank?: number; similarity?: number };
  const fused = new Map<string, Fused>();
  const bump = (id: string, patch: Partial<Fused>, rank: number) => {
    const cur = fused.get(id) ?? { rrf: 0 };
    cur.rrf += 1 / (RRF_K + rank);
    fused.set(id, { ...cur, ...patch, rrf: cur.rrf });
  };
  keyword.forEach((r, i) => bump(r.id, { keywordRank: i + 1 }, i + 1));
  vector.forEach((r, i) => bump(r.id, { vectorRank: i + 1, similarity: 1 - Number(r.distance) }, i + 1));

  const ids = [...fused.keys()];
  const rows = await db`
    SELECT m.id, m.type, m.content, m.trust, m.importance, m.labels, m.updated_at,
      COALESCE(u.retrievals, 0) AS retrievals
    FROM memories m
    LEFT JOIN memory_usage u ON u.memory_id = m.id
    WHERE m.id = ANY(${ids}::uuid[]) AND m.state = 'active'`;

  const now = Date.now();
  const hits: SearchHit[] = (rows as Record<string, never>[]).map((r) => {
    const f = fused.get(r.id as unknown as string)!;
    const importance = Number(r.importance);
    const retrievals = Number(r.retrievals);
    const ageDays = (now - new Date(r.updated_at as unknown as string).getTime()) / 86_400_000;

    const importanceBoost = 1 + 0.6 * importance;
    const usageBoost = 1 + Math.min(retrievals, 20) * 0.015;
    const freshness = 1 + 0.25 * Math.exp(-ageDays / 21);

    return {
      id: r.id as unknown as string,
      type: r.type as unknown as string,
      content: r.content as unknown as string,
      trust: r.trust as unknown as string,
      importance,
      labels: (r.labels as unknown as string[]) ?? [],
      updated_at: r.updated_at as unknown as string,
      retrievals,
      score: Number((f.rrf * importanceBoost * usageBoost * freshness).toFixed(6)),
      similarity: f.similarity !== undefined ? Number(f.similarity.toFixed(4)) : null,
      matched: { vector: f.vectorRank !== undefined, keyword: f.keywordRank !== undefined },
    };
  });

  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, limit);

  if (top.length > 0) {
    const usedIds = top.map((h) => h.id);
    await db`INSERT INTO memory_usage (memory_id, retrievals, last_used_at)
      SELECT id, 1, now() FROM unnest(${usedIds}::uuid[]) AS id
      ON CONFLICT (memory_id) DO UPDATE SET retrievals = memory_usage.retrievals + 1, last_used_at = now()`;
  }

  if (degraded) console.warn("search_memory: vector leg unavailable, keyword only");
  return top;
}

// ------------------------------------------------------------- context packs

// get_context: pinned + recent + session notes. Small pack for a model prompt.
export async function getContext(scopeName: string, sessionId?: string) {
  const db = sql();
  const scope = await getScope(scopeName);
  const pinned = await db`SELECT id, type, content, trust, importance, labels FROM memories
    WHERE scope_id = ${scope.id} AND state = 'active' AND labels @> '{pinned}' ORDER BY importance DESC LIMIT 10`;
  const recent = await db`SELECT id, type, content, trust, importance, updated_at FROM memories
    WHERE scope_id = ${scope.id} AND state = 'active' ORDER BY updated_at DESC LIMIT 10`;
  const session = sessionId ? await sessionGet(scopeName, sessionId) : [];
  const counts = await db`SELECT state, count(*)::int AS n FROM memories WHERE scope_id = ${scope.id} GROUP BY state`;
  return {
    scope: scope.name,
    pinned,
    recent,
    session,
    counts,
    hint: "Pinned first, then recent. Session notes are short-term.",
  };
}

// ---------------------------------------------------------------- browse / UI

export type ListFilters = {
  scope: string;
  type?: string;
  trust?: string;
  state?: string;
  label?: string;
  limit?: number;
  offset?: number;
};

export async function listMemories(f: ListFilters) {
  const db = sql();
  const scope = await getScope(f.scope);
  const limit = Math.min(f.limit ?? 50, 200);
  const offset = f.offset ?? 0;
  const type = f.type && f.type !== "all" ? f.type : null;
  const trust = f.trust && f.trust !== "all" ? f.trust : null;
  const state = f.state && f.state !== "all" ? f.state : "active";
  const label = f.label && f.label !== "all" ? f.label : null;

  const rows = await db`
    SELECT m.id, m.type, left(m.content, 240) AS snippet, m.trust, m.importance, m.labels, m.state,
      m.fact_key, m.version, m.updated_at, COALESCE(u.retrievals, 0) AS retrievals,
      (SELECT count(*)::int FROM memory_versions v WHERE v.memory_id = m.id) AS versions
    FROM memories m
    LEFT JOIN memory_usage u ON u.memory_id = m.id
    WHERE m.scope_id = ${scope.id}
      AND (${state}::text IS NULL OR m.state = ${state})
      AND (${type}::text IS NULL OR m.type = ${type})
      AND (${trust}::text IS NULL OR m.trust = ${trust})
      AND (${label}::text IS NULL OR m.labels @> ARRAY[${label}::text])
    ORDER BY m.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}`;

  const total = await db`
    SELECT count(*)::int AS n FROM memories m
    WHERE m.scope_id = ${scope.id}
      AND (${state}::text IS NULL OR m.state = ${state})
      AND (${type}::text IS NULL OR m.type = ${type})
      AND (${trust}::text IS NULL OR m.trust = ${trust})
      AND (${label}::text IS NULL OR m.labels @> ARRAY[${label}::text])`;

  const labelRows = await db`SELECT DISTINCT unnest(labels) AS label FROM memories WHERE scope_id = ${scope.id} ORDER BY 1`;
  return {
    scope: scope.name,
    results: rows,
    total: (total[0]?.n as number) ?? rows.length,
    labels: (labelRows as { label: string }[]).map((r) => r.label),
  };
}

export async function getMemoryDetail(id: string) {
  const db = sql();
  const rows = await db`SELECT m.*, COALESCE(u.retrievals, 0) AS retrievals, u.last_used_at,
      (SELECT count(*)::int FROM memory_embeddings e WHERE e.memory_id = m.id) AS embedding_count,
      s.name AS scope_name, a.display_name AS author
    FROM memories m
    LEFT JOIN memory_usage u ON u.memory_id = m.id
    JOIN scopes s ON s.id = m.scope_id
    JOIN actors a ON a.id = m.created_by
    WHERE m.id = ${id} LIMIT 1`;
  if (rows.length === 0) throw new Error("Memory not found");

  const versions = await db`SELECT v.version, v.content, v.state, v.reason, v.created_at, a.display_name AS actor
    FROM memory_versions v JOIN actors a ON a.id = v.actor_id
    WHERE v.memory_id = ${id} ORDER BY v.version DESC LIMIT 20`;

  const relations = await db`SELECT r.id, r.type, r.origin, r.status, r.created_at,
      (r.from_id = ${id}) AS outgoing,
      CASE WHEN r.from_id = ${id} THEN r.to_id ELSE r.from_id END AS other_id,
      m.content AS other_content
    FROM memory_relations r
    JOIN memories m ON m.id = CASE WHEN r.from_id = ${id} THEN r.to_id ELSE r.from_id END
    WHERE (r.from_id = ${id} OR r.to_id = ${id}) AND r.status = 'active'`;

  return { memory: rows[0], versions, relations };
}

export async function scopeStats(scopeName: string) {
  const db = sql();
  const scope = await getScope(scopeName);
  const byState = await db`SELECT state, count(*)::int AS n FROM memories WHERE scope_id = ${scope.id} GROUP BY state`;
  const byType = await db`SELECT type, count(*)::int AS n FROM memories WHERE scope_id = ${scope.id} AND state = 'active' GROUP BY type ORDER BY n DESC`;
  const embedded = await db`SELECT count(DISTINCT e.memory_id)::int AS n FROM memory_embeddings e
    JOIN memories m ON m.id = e.memory_id WHERE m.scope_id = ${scope.id} AND m.state = 'active' AND e.model = ${embedModel()}`;
  const queued = await db`SELECT count(*)::int AS n FROM knowledge_jobs WHERE scope_id = ${scope.id} AND status IN ('queued','running')`;
  const scopes = await db`SELECT name, kind FROM scopes WHERE workspace_id = ${scope.workspace_id} ORDER BY name`;
  const activeCount = (byState as { state: string; n: number }[]).find((r) => r.state === "active")?.n ?? 0;
  return {
    scope: scope.name,
    byState,
    byType,
    activeCount,
    embeddedCount: (embedded[0]?.n as number) ?? 0,
    missingEmbeddings: Math.max(activeCount - ((embedded[0]?.n as number) ?? 0), 0),
    queuedJobs: (queued[0]?.n as number) ?? 0,
    scopes,
  };
}

// ---------------------------------------------------------------------- jobs

/** Embed every active memory that has no vector for the current model. */
export async function backfillEmbeddings(limit = 25) {
  const db = sql();
  const model = embedModel();
  const rows = (await db`
    SELECT m.id, m.workspace_id, m.version, m.content, m.content_hash
    FROM memories m
    WHERE m.state = 'active'
      AND NOT EXISTS (SELECT 1 FROM memory_embeddings e WHERE e.memory_id = m.id AND e.model = ${model})
    ORDER BY m.updated_at DESC
    LIMIT ${limit}`) as { id: string; workspace_id: string; version: number; content: string; content_hash: string }[];

  if (rows.length === 0) return { embedded: 0, failed: 0 };

  let embedded = 0;
  let failed = 0;
  const vectors = await embedTexts(rows.map((r) => r.content));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      await db`INSERT INTO memory_embeddings (memory_id, workspace_id, memory_version, content_hash, model, dimensions, embedding)
        VALUES (${r.id}, ${r.workspace_id}, ${r.version}, ${r.content_hash}, ${model}, 1024, ${toPgVector(vectors[i])}::vector)
        ON CONFLICT (memory_id, memory_version, model, dimensions) DO NOTHING`;
      await markJob(db, r.id, "embed", "done");
      embedded++;
    } catch {
      failed++;
    }
  }
  return { embedded, failed };
}

/**
 * Nightly decay: memories nobody retrieved in 90 days lose a little
 * importance, which pushes them down in ranking without deleting them.
 */
export async function decayImportance(floor = 0.05) {
  const db = sql();
  const rows = await db`UPDATE memories m SET importance = GREATEST(m.importance - 0.05, ${floor}), updated_at = m.updated_at
    FROM memory_usage u
    WHERE u.memory_id = m.id AND m.state = 'active'
      AND m.labels <> '{pinned}'
      AND (u.last_used_at IS NULL OR u.last_used_at < now() - interval '90 days')
      AND m.updated_at < now() - interval '90 days'
      AND m.importance > ${floor}
    RETURNING m.id`;
  return { decayed: rows.length };
}

/** Drain queued embed jobs (used by the cron route). */
export async function runQueuedJobs(limit = 25) {
  const backfill = await backfillEmbeddings(limit);
  const decay = await decayImportance();
  return { ...backfill, ...decay };
}
