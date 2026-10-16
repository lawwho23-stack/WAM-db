-- Agent Memory DB v2 — fresh rebuild
-- Project: agent-memory (curly-leaf-12363866)
-- Branch: dev/memory-v2, Database: agent_memory_v2
-- Choices: direct to long-term, Redis for live sessions, 1024-dim embeddings
-- Primary embedding: perplexity/pplx-embed-v1-0.6b (1024 dims)
-- Fallback: openai/text-embedding-3-small with dimensions=1024 (same size, no schema change)

-- Technical term: extension = extra feature you turn on inside Postgres.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Workspace = top owner box. One row for you to start.
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Scope = area for one agent or project. Used for permission.
-- kind: personal (your private facts) or project (shared, like pr-reviewer).
CREATE TABLE scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL CHECK (kind IN ('personal','project')),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

-- 3. Actor = who wrote it. Owner = you. Agent = AI worker.
CREATE TABLE actors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL CHECK (kind IN ('owner','member','agent')),
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id)
);

-- 4. Memories = long-term facts. Direct to long-term, so state starts as active.
-- type: what kind of fact. run_record = one PR review result.
-- trust: how sure we are. owner_asserted = you said it. agent_reported = AI said it.
-- state: active = in use. superseded = replaced by newer. expired/deleted = hidden, never hard-deleted.
CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  scope_id UUID NOT NULL REFERENCES scopes(id),
  type TEXT NOT NULL CHECK (type IN ('fact','preference','decision','experience','procedure','run_record','skill_ref')),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL, -- sha256 of content, for dedupe. App computes this.
  fact_key TEXT, -- stable key like "pr-policy:diff-limit". Same key + scope = conflict -> supersede.
  labels TEXT[] NOT NULL DEFAULT '{}', -- e.g. '{pinned,security}'. pinned = always in context.
  trust TEXT NOT NULL CHECK (trust IN ('owner_asserted','source_extracted','agent_reported','inferred')),
  importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','superseded','expired','deleted')),
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by UUID NOT NULL REFERENCES actors(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Technical term: tsvector = full-text search form of content. GIN index makes keyword search fast.
  content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX ix_memories_scope_state_updated ON memories (scope_id, state, updated_at DESC);
CREATE INDEX ix_memories_labels ON memories USING GIN (labels);
CREATE INDEX ix_memories_content_fts ON memories USING GIN (content_tsv);
CREATE INDEX ix_memories_scope_type_hash ON memories (scope_id, type, content_hash);
-- Only one active row per fact_key. History stays as superseded rows.
CREATE UNIQUE INDEX uq_memories_active_fact_key ON memories (scope_id, type, fact_key)
  WHERE state = 'active' AND fact_key IS NOT NULL;

-- 5. Embeddings = vector form of memory, for meaning search.
-- One row per memory version + model. Model change = new rows, no rebuild.
CREATE TABLE memory_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  memory_version INT NOT NULL,
  content_hash TEXT NOT NULL,
  model TEXT NOT NULL, -- e.g. 'perplexity/pplx-embed-v1-0.6b'
  dimensions INT NOT NULL, -- e.g. 1024
  embedding VECTOR(1024) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (memory_id, memory_version, model, dimensions)
);
-- Technical term: HNSW = fast approximate search index for vectors. Cosine = angle search, good for text meaning.
CREATE INDEX ix_embeddings_hnsw ON memory_embeddings USING hnsw (embedding vector_cosine_ops);

-- 6. Relations = graph links between memories.
CREATE TABLE memory_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  from_id UUID NOT NULL REFERENCES memories(id),
  to_id UUID NOT NULL REFERENCES memories(id),
  type TEXT NOT NULL CHECK (type IN ('supersedes','related_to','conflicts_with')),
  origin TEXT NOT NULL CHECK (origin IN ('asserted','system','suggested')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  created_by UUID NOT NULL REFERENCES actors(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_id <> to_id),
  UNIQUE (from_id, to_id, type)
);

-- 7. Versions = full history. Every update_memory adds one row here.
CREATE TABLE memory_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  version INT NOT NULL,
  content TEXT NOT NULL,
  state TEXT NOT NULL,
  actor_id UUID NOT NULL REFERENCES actors(id),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (memory_id, version)
);

-- 8. Usage = counts which memories get used. Boosts ranking in search.
CREATE TABLE memory_usage (
  memory_id UUID PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  retrievals BIGINT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. Skills = reusable commands like /review. Body lives in versions.
CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  scope_id UUID NOT NULL REFERENCES scopes(id),
  command TEXT NOT NULL CHECK (command ~ '^/[a-z][a-z0-9_]{0,63}$'),
  revision BIGINT NOT NULL DEFAULT 1,
  active_version INT,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope_id, command)
);
CREATE TABLE skill_versions (
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  version INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL, -- this text gets embedded for search_skills
  body TEXT NOT NULL, -- full skill text, loaded only by get_skill
  description_embedding VECTOR(1024),
  created_by UUID NOT NULL REFERENCES actors(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (skill_id, version)
);
CREATE INDEX ix_skill_desc_hnsw ON skill_versions USING hnsw (description_embedding vector_cosine_ops);

-- 10. Agents + runs = one run record per PR + commit. Feeds process view.
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  scope_id UUID NOT NULL REFERENCES scopes(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  scope_id UUID NOT NULL REFERENCES scopes(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  external_id TEXT NOT NULL, -- PR# + commit SHA, e.g. 'owner/repo#123@abc123'
  idempotency_key TEXT, -- webhook dedupe key: PR + SHA
  repository TEXT NOT NULL,
  pr_number INT,
  commit_sha TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','partial','failed','stale','duplicate')),
  current_stage TEXT NOT NULL DEFAULT 'queued',
  model TEXT,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  estimated_cost_microusd BIGINT NOT NULL DEFAULT 0,
  findings_count INT NOT NULL DEFAULT 0,
  summary TEXT,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, external_id),
  UNIQUE (agent_id, idempotency_key)
);
CREATE INDEX ix_runs_scope_created ON agent_runs (scope_id, created_at DESC);
CREATE TABLE agent_run_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  message TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('debug','info','warn','error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_run_events_run_created ON agent_run_events (run_id, created_at);

-- 11. Sessions = consolidated summaries only. Live notes stay in Redis (TTL 7 days).
-- Redis keys: sess:{scope}:{session_id} (list), ctxcache:{hash} (10 min), lock:run:{...} (10 min)
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  scope_id UUID NOT NULL REFERENCES scopes(id),
  actor_id UUID NOT NULL REFERENCES actors(id),
  external_id TEXT NOT NULL, -- chat or task id from client
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','summarized')),
  summary TEXT, -- filled by consolidate job at session end
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope_id, external_id)
);

-- 12. Jobs = background work status. Shown next to run in process view.
CREATE TABLE knowledge_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  scope_id UUID NOT NULL REFERENCES scopes(id),
  kind TEXT NOT NULL
    CHECK (kind IN ('embed','link','consolidate','supersede','decay','skill_index','usage','export')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','failed')),
  ref_type TEXT NOT NULL, -- 'memory' or 'run' or 'session'
  ref_id UUID NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_jobs_ref ON knowledge_jobs (ref_type, ref_id);
CREATE INDEX ix_jobs_status ON knowledge_jobs (status, created_at);

-- 13. API tokens = one per agent, for the MCP door. Raw token shown once,
-- only the sha256 hash is stored. scope_id NULL = every scope in the workspace.
CREATE TABLE api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scope_id UUID REFERENCES scopes(id),
  can_read BOOLEAN NOT NULL DEFAULT true,
  can_write BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
