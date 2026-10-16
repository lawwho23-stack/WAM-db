# WAM-db — Whole Agent Memory

One database that every AI agent can read and write, plus a place for my own real-life data.

The name says the goal: **W**hole **A**gent **M**emory. Not per-chat memory, not per-tool memory — one shared memory layer that my coding agents, review bots and chat agents all reach through the same door.

**Live:** https://wam-db.vercel.app — private, owner-only. Access is gated by Vercel Authentication, so only the owner account can open it.

---

## What this is

A Next.js app backed by Neon Postgres that gives AI agents a durable memory with real structure:

- **Long-term memory** — facts, preferences, decisions, experiences, procedures and run records, each with trust level, importance, labels and full version history.
- **Hybrid recall** — pgvector for meaning plus Postgres full-text for exact words, merged with Reciprocal Rank Fusion, then nudged by importance, past usage and freshness.
- **Short-term memory** — live session notes in Redis with a 7-day TTL.
- **A single MCP door** — every agent talks to memory through the same tool set, with its own scoped bearer token.
- **Visibility** — a UI to search, read, edit and delete memory instead of trusting a black box.
- **Personal data** — income and expense tracking that lives beside the memory layer (planned).

---

## Status

| Area | State |
| --- | --- |
| Memory schema (16 tables) | Done — `schema.sql` |
| Memory core library (write, hybrid search, context pack, history) | Done — `lib/memory.ts` |
| Real MCP server (JSON-RPC over streamable HTTP) | Done — `app/api/mcp` |
| Per-agent hashed tokens with scope + read/write fences | Done — `api_tokens`, `lib/auth-tokens.ts` |
| Embeddings via OpenRouter (1024-dim), kept in sync with edits | Done — plus a backfill job |
| Background jobs (embed backfill, nightly decay) | Done — `/api/cron` |
| Universe dark UI (overview, memory, agents, runs, skills) | Done |
| End-to-end smoke test (20 checks) | Done — `scripts/smoke.mjs` |
| Finance module (THB base, multi-currency) | Planned — Phase 3 |
| Owner-email login | Planned — Phase 4 |

---

## Architecture

```
agent (Claude Code, Codex, bot)      browser
        |                               |
        |  MCP tools over HTTP          |  Next.js pages
        v                               v
   +---------------------------------------------+
   |        Next.js 16 (App Router, TS)          |
   |  /api/mcp   /api/memories   /api/search     |
   |  /api/context   /api/runs   /api/skills     |
   |  /api/tokens   /api/stats   /api/cron       |
   +---------------------------------------------+
               |                        |
               v                        v
   +---------------------+   +---------------------+
   |  Neon Postgres      |   |  Upstash Redis      |
   |  pgvector + FTS     |   |  session notes      |
   |  memory, graph,     |   |  TTL 7 days         |
   |  versions, jobs     |   |                     |
   +---------------------+   +---------------------+
               ^
               |  1024-dim embeddings
         OpenRouter (pplx-embed-v1-0.6b)
```

### How a memory flows

1. An agent calls `write_memory` with a fact, decision or run record, authenticated by its own bearer token.
2. The token decides the scope it may touch and whether it may write at all. The row lands as **active** immediately, deduped by content hash.
3. If the same `fact_key` already exists in that scope, the old row flips to **superseded** and a version row keeps its text. Nothing is ever hard-deleted.
4. An `embed` job is queued; the vector is computed inline and stored. If the embedding provider is down the job stays queued and the nightly cron retries it.
5. `search_memory` runs both legs, fuses the ranks and returns why each hit matched (`meaning`, `words`, or both).
6. `get_context` returns a small context pack: pinned items first, then recent items, plus session notes.

### Getting the same answer by meaning

Because the vector leg is real, a query can match a memory with **zero words in common**:

```
query:  "verify the application is working correctly"
hit:    "Smoke test marker … the smoke script verifies the whole write path"
        matched { vector: true, keyword: false }   similarity 0.17
```

That is the difference between a keyword index and actual recall, and `scripts/smoke.mjs` asserts it on every run.

### Data model

| Table | Purpose |
| --- | --- |
| `workspaces` | Top-level owner box |
| `scopes` | Area of memory — `personal` or `project` |
| `actors` | Who wrote it — owner, member or agent |
| `memories` | Long-term items with trust, importance, labels, state |
| `memory_embeddings` | Vectors per memory version and model |
| `memory_relations` | Graph edges between memories |
| `memory_versions` | Full history, one row per change (content or state) |
| `memory_usage` | Retrieval counts, used to boost ranking |
| `skills` / `skill_versions` | Reusable commands with versioned bodies |
| `agents` / `agent_runs` / `agent_run_events` | One run record per task, with step events |
| `sessions` | Consolidated session summaries |
| `knowledge_jobs` | Background job status (embed, supersede, decay) |
| `api_tokens` | One hashed token per agent, with scope and permissions |

---

## API

| Route | Method | Does |
| --- | --- | --- |
| `/api/health` | GET | Database reachability |
| `/api/mcp` | POST, GET, DELETE | MCP server — needs a bearer token |
| `/api/tokens` | GET, POST | List or issue agent tokens |
| `/api/tokens/[id]` | DELETE | Revoke a token |
| `/api/stats?scope=` | GET | Counts, embedding coverage, queued jobs |
| `/api/context?scope=` | GET | Context pack for one scope |
| `/api/search?scope=&q=` | GET | Hybrid search (meaning + words) |
| `/api/memories?scope=` | GET, POST | List with filters, or write |
| `/api/memories/[id]` | GET, PATCH, DELETE | Detail, edit/pin/restore, soft delete |
| `/api/skills?scope=&q=` | GET, POST, PATCH, DELETE | Find, publish, load or revoke a skill |
| `/api/runs?scope=` | GET, POST | List or create agent runs |
| `/api/cron` | GET, POST | Drain queued jobs — needs `CRON_SECRET` |

### MCP tools

`get_context` · `search_memory` · `write_memory` · `update_memory` · `list_memories` · `memory_stats` · `session_append` · `session_get` · `search_skills` · `get_skill`

Connect any MCP client:

```json
{
  "mcpServers": {
    "wam-db": {
      "type": "http",
      "url": "https://wam-db.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer wam_…" }
    }
  }
}
```

---

## Local setup

```bash
npm install
cp .env.example .env.local          # then fill in the values
psql "$DATABASE_URL" -f schema.sql   # first time only
psql "$DATABASE_URL" -f migrations/001_api_tokens.sql
npm run dev
```

Open http://localhost:3000.

### Verification

```bash
npm run build                        # compile + type check
node scripts/smoke.mjs               # 20 end-to-end checks against localhost:3000
node scripts/smoke.mjs https://wam-db.vercel.app   # or against a deployment
```

`smoke.mjs` covers health, token issue/revoke, the MCP handshake, every read and write path, hybrid search in both directions, the scope and read-only fences, session notes, history, soft delete and the cron runner. It cleans up the memories it creates and revokes the tokens it issues. Pass `MCP_TOKEN` to reuse an existing token and `VERCEL_BYPASS` when testing a protected deployment.

### Environment variables

| Variable | Needed for |
| --- | --- |
| `DATABASE_URL` | Neon Postgres connection (pooled host) |
| `OPENROUTER_API_KEY` | Embeddings and model calls |
| `EMBED_MODEL` | Embedding model slug, 1024 dims |
| `DECISION_MODEL` | Reviewer decision model (planned loop) |
| `REVIEWER_MODEL` | Reviewer model (planned loop) |
| `UPSTASH_REDIS_REST_URL` | Session notes; falls back to in-memory without it |
| `UPSTASH_REDIS_REST_TOKEN` | Same |
| `CRON_SECRET` | Guards `/api/cron`. Vercel Cron sends it automatically |
| `GITHUB_TOKEN` | GitHub review loop (planned) |
| `GITHUB_WEBHOOK_SECRET` | Same |

---

## Design decisions

- **Direct to long-term.** No candidate inbox for now — memories land active, with `created_by` and a trust level so bad writes are traceable.
- **Supersede, never delete.** A changed fact keeps its old row as `superseded` history. Deletes are soft, so a mistake stays recoverable.
- **One embedding size everywhere.** 1024 dims, so switching embedding models needs no schema change.
- **Scopes as the permission line.** One agent token is bound to one scope, so a review bot cannot rewrite personal facts.
- **Tokens are stored hashed.** Only a SHA-256 hash and a display prefix live in the database; the raw token is shown once at creation.
- **Keyword search always works.** If the embedding provider is down, full-text search still answers on its own.
- **Every change is a version.** Content edits and state changes both advance the version, so history is complete and `(memory_id, version)` stays unique.
- **Writes return fast, jobs run later.** An embed failure never fails a write; the job stays queued for the cron runner.

## Roadmap

1. **Phase 1 — Memory e2e:** ✅ real MCP server, per-agent hashed tokens, hybrid retrieval, full memory UI, cron job runner.
2. **Phase 2 — Universe dark UI:** ✅ design tokens, starfield shell, and every page rebuilt on it.
3. **Phase 3 — Finance:** accounts, categories, transactions in minor units, THB base with THB/MMK/USD support, dashboard and CSV import/export.
4. **Phase 4 — Auth and hardening:** owner-email login, deploy checks, smoke tests in CI.

See `docs/architecture.md` for the fuller design write-up.
