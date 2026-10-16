# WAM-db — Whole Agent Memory

One database that every AI agent can read and write, plus a place for my own real-life data.

The name says the goal: **W**hole **A**gent **M**emory. Not per-chat memory, not per-tool memory — one shared memory layer that my coding agents, review bots and chat agents all reach through the same door.

**Live:** https://wam-db.vercel.app — private, owner-only. Access is gated by Vercel Authentication, so only the owner account can open it.

---

## What this is

A Next.js app backed by Neon Postgres that gives AI agents a durable memory with real structure:

- **Long-term memory** — facts, preferences, decisions, experiences, procedures and run records, each with trust level, importance, labels and full version history.
- **Semantic recall** — embeddings stored in `pgvector`, so agents find memories by meaning, not just keywords.
- **Short-term memory** — live session notes in Redis with a 7-day TTL.
- **A single MCP door** — every agent talks to memory through the same tool set, with its own scoped token.
- **Visibility** — a UI to read, search and edit memory instead of trusting a black box.
- **Personal data** — income and expense tracking that lives beside the memory layer (planned).

---

## Status

| Area | State |
| --- | --- |
| Memory schema (15 tables) | Done — `schema.sql` |
| Memory core library (write, search, context pack, update) | Done — `lib/` |
| HTTP API for memory, runs, skills | Done — `app/api/` |
| Embeddings via OpenRouter (1024-dim) | Done — works end to end |
| Minimal UI (chat, memories, runs, skills) | Done — scaffold level |
| Real MCP server with per-agent tokens | Planned — Phase 1 |
| Hybrid vector + keyword search | Planned — Phase 1 |
| Universe dark UI | Planned — Phase 2 |
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
   |        Next.js 14 (App Router, TS)          |
   |  /api/mcp   /api/memories   /api/search     |
   |  /api/context   /api/runs   /api/skills     |
   +---------------------------------------------+
              |                        |
              v                        v
   +---------------------+   +---------------------+
   |  Neon Postgres      |   |  Upstash Redis      |
   |  pgvector + pg_trgm |   |  session notes      |
   |  memory, graph,     |   |  cache, locks       |
   |  versions, jobs     |   |  TTL 7 days         |
   +---------------------+   +---------------------+
              ^
              |  1024-dim embeddings
        OpenRouter (pplx-embed-v1-0.6b)
```

### How a memory flows

1. An agent calls `write_memory` with a fact, decision or run record.
2. The row lands as **active** immediately (direct-to-long-term), deduped by content hash.
3. If the same `fact_key` already exists in that scope, the old row flips to **superseded** and a version row keeps its history. Nothing is ever hard-deleted.
4. An `embed` job is queued; the vector is computed and stored in `memory_embeddings`.
5. Later, `search_memory` ranks by meaning plus importance, usage count and recency.
6. `get_context` returns a small context pack: pinned items first, then recent items, plus session notes.

### Data model

| Table | Purpose |
| --- | --- |
| `workspaces` | Top-level owner box |
| `scopes` | Area of memory — `personal` or `project` |
| `actors` | Who wrote it — owner, member or agent |
| `memories` | Long-term items with trust, importance, labels, state |
| `memory_embeddings` | Vectors per memory version and model |
| `memory_relations` | Graph edges between memories |
| `memory_versions` | Full edit history, one row per change |
| `memory_usage` | Retrieval counts, used to boost ranking |
| `skills` / `skill_versions` | Reusable commands with versioned bodies |
| `agents` / `agent_runs` / `agent_run_events` | One run record per task, with step events |
| `sessions` | Consolidated session summaries |
| `knowledge_jobs` | Background job status (embed, consolidate, decay) |

---

## API

| Route | Method | Does |
| --- | --- | --- |
| `/api/health` | GET | Database reachability |
| `/api/context?scope=` | GET | Context pack for one scope |
| `/api/search?scope=&q=` | GET, POST | Search memory |
| `/api/memories?scope=` | GET, POST | List or write memories |
| `/api/memories/[id]` | PATCH | Edit a memory (creates a version) |
| `/api/skills?scope=&q=` | GET, POST | Find or publish a skill |
| `/api/runs?scope=` | GET, POST | List or create agent runs |
| `/api/mcp` | POST | MCP-style tool door |

### MCP tools

`get_context` · `search_memory` · `write_memory` · `update_memory` · `session_append` · `session_get` · `search_skills` · `get_skill`

---

## Local setup

```bash
npm install
cp .env.example .env.local     # then fill in the values
psql "$DATABASE_URL" -f schema.sql   # first time only
npm run dev
```

Open http://localhost:3000.

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
| `GITHUB_TOKEN` | GitHub review loop (planned) |
| `GITHUB_WEBHOOK_SECRET` | Same |

---

## Design decisions

- **Direct to long-term.** No candidate inbox for now — memories land active, with `created_by` and a trust level so bad writes are traceable.
- **Supersede, never delete.** A changed fact keeps its old row as `superseded` history.
- **One embedding size everywhere.** 1024 dims, so switching embedding models needs no schema change.
- **Scopes as the permission line.** One agent token is bound to one scope, so a review bot cannot rewrite personal facts.
- **Keyword search always works.** If the embedding provider is down, full-text search still answers.

## Roadmap

1. **Phase 1 — Memory e2e:** real MCP server (JSON-RPC, streamable HTTP), per-agent hashed tokens, hybrid vector + keyword search with rank fusion, full memory UI with history, cron job runner.
2. **Phase 2 — Universe dark UI:** the design system and shell for every page.
3. **Phase 3 — Finance:** accounts, categories, transactions in minor units, THB base with THB/MMK/USD support, dashboard and CSV import/export.
4. **Phase 4 — Auth and hardening:** owner-email login, deploy checks, smoke tests.

See `docs/architecture.md` for the fuller design write-up.
