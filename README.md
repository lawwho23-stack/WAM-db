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
- **Money** — income and expense tracking in THB, MMK and USD, all reported in baht, living beside the memory layer in the same database.

---

## Status

| Area | State |
| --- | --- |
| Memory schema (16 tables) | Done — `schema.sql` |
| Memory core library (write, hybrid search, context pack, history) | Done — `lib/memory.ts` |
| Real MCP server (JSON-RPC over streamable HTTP) | Done — `app/api/mcp` |
| Per-agent hashed tokens with scope + read/write fences | Done — `api_tokens`, `lib/auth-tokens.ts` |
| Embeddings via OpenRouter (1024-dim), kept in sync with edits | Done — plus a backfill job |
| Background jobs (embed backfill, nightly decay, daily rates) | Done — `/api/cron` |
| Universe dark UI (overview, money, memory, agents, runs, skills) | Done |
| End-to-end smoke test (33 checks) | Done — `scripts/smoke.mjs` |
| Owner-email login with a signed session cookie | Done |
| Finance: accounts, categories, transactions in minor units | Done — `migrations/003_finance.sql`, `lib/money.ts` |
| Finance: dashboard, transactions UI, CSV import/export | Done — `/money` |
| Finance for agents, read-only | Done — `money_summary`, `list_transactions`, `list_accounts` |
| Hardening: smoke tests in CI, deploy checks | Next — Phase 5 |

---

## Architecture

```
agent (Claude Code, Codex, bot)      browser (owner)
        |                                    |
        |  bearer token                      |  signed session cookie
        v                                    v
   +--------------------------------------------------------+
   |  proxy.ts — the front door                             |
   |  closed unless it is /login, /api/auth/login,          |
   |  /api/mcp, /api/cron or /api/health                    |
   +--------------------------------------------------------+
   |            Next.js 16 (App Router, TS)                 |
   |  /api/auth/*    /api/mcp        /api/memories          |
   |  /api/search    /api/context    /api/runs              |
   |  /api/skills    /api/tokens     /api/stats  /api/cron  |
   |  /api/money/*   (owner writes; agents read via MCP)    |
   +--------------------------------------------------------+
               |                        |
               v                        v
   +---------------------+   +---------------------+
   |  Neon Postgres      |   |  Upstash Redis      |
   |  pgvector + FTS     |   |  session notes      |
   |  memory, graph,     |   |  TTL 7 days         |
   |  versions, jobs,    |   |                     |
   |  money, fx rates    |   |                     |
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
| `finance_accounts` | Where money sits, one currency each |
| `finance_categories` | What money was for, income or expense |
| `finance_transactions` | What moved, in minor units, with its own FX rate |
| `finance_fx_rates` | Currency → THB per day, from the feed or by hand |

---

## API

| Route | Method | Does |
| --- | --- | --- |
| `/api/auth/login` | POST | Owner sign-in — the only way to mint a session |
| `/api/auth/logout` | POST | Clear the session cookie |
| `/api/health` | GET | Database reachability |
| `/api/mcp` | POST, GET, DELETE | MCP server — needs a bearer token |
| `/api/tokens` | GET, POST | List or issue agent tokens |
| `/api/tokens/[id]` | DELETE | Revoke a token, or `?purge=1` to remove the row |
| `/api/stats?scope=` | GET | Counts, embedding coverage, queued jobs |
| `/api/context?scope=` | GET | Context pack for one scope |
| `/api/search?scope=&q=` | GET | Hybrid search (meaning + words) |
| `/api/memories?scope=` | GET, POST | List with filters, or write |
| `/api/memories/[id]` | GET, PATCH, DELETE | Detail, edit/pin/restore, soft delete |
| `/api/skills?scope=&q=` | GET, POST, PATCH, DELETE | Find, publish, load or revoke a skill |
| `/api/runs?scope=` | GET, POST | List or create agent runs |
| `/api/money/accounts` | GET, POST, PATCH, DELETE | Accounts with balances — DELETE purges one that nothing references |
| `/api/money/categories` | GET, POST, PATCH | Income and expense categories |
| `/api/money/transactions` | GET, POST | Filtered list, or record one |
| `/api/money/transactions/[id]` | GET, PATCH, DELETE | One row — edit or soft delete |
| `/api/money/summary?month=` | GET | Everything the dashboard shows, in one call |
| `/api/money/rates` | GET, POST | The rate in force, or set/pull one |
| `/api/money/export` | GET | CSV out, same shape the importer takes |
| `/api/money/import` | POST | CSV in, duplicates skipped |
| `/api/cron` | GET, POST | Drain queued jobs — needs `CRON_SECRET` |

Everything except the four public entries is owner-only. See [How access works](#how-access-works).

### MCP tools

`get_context` · `search_memory` · `write_memory` · `update_memory` · `list_memories` · `memory_stats` · `session_append` · `session_get` · `search_skills` · `get_skill` · `money_summary` · `list_transactions` · `list_accounts`

Ten of those work on memory; the last three read money and are read-only on purpose. An agent can see that rent was paid and what it left in the account — only the owner, signed in, can change a figure.

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

## How access works

Three doors, three keys.

| Who | Key | Reaches |
| --- | --- | --- |
| The owner, in a browser | Signed session cookie | Every page and every `/api/*` route except MCP and cron |
| An agent | A bearer token (`wam_…`) | `/api/mcp` only, fenced to one scope and read or read-write |
| Vercel Cron | `CRON_SECRET` | `/api/cron` only |

**Only one email may sign in.** `OWNER_EMAIL` is the allowlist and the passphrase is checked against a scrypt hash, so the real passphrase never sits in an environment variable. A wrong email and a wrong passphrase return the same sentence, which means the response never confirms which half was right. Six failures from one address in ten minutes and that address waits.

**The session is a signed cookie, not a database row.** It carries the owner email and an expiry, signed with `SESSION_SECRET`. There is no sessions table to leak, and the cookie is verified again on every request — so rotating `SESSION_SECRET` signs everyone out everywhere at once.

**`proxy.ts` is the front door, and every route locks itself too.** Next renamed `middleware.ts` to `proxy.ts` in 16. Anonymous requests are turned away before they reach a handler: pages redirect to `/login` carrying a `next`, APIs get a 401. Because a matcher edit can silently remove that coverage, every private route handler also calls `requireOwner()`.

**Agents cannot use the REST API at all.** Their tokens work at `/api/mcp` and nowhere else, so a leaked token cannot list tokens or write memories through a side door.

**Money is read-only for agents.** The MCP server exposes `money_summary`, `list_transactions` and `list_accounts` and no way to write a transaction, so an agent can reason about the numbers but not invent one. Every money write goes through the UI, which needs the owner's session.

**Deployment protection is a second wall, not the only one.** The Vercel project is set to Vercel Authentication for all deployments. That is why an outside agent needs the *Protection Bypass for Automation* secret as well as its token — without it the request never reaches the app.

---

## Money

Three currencies, one yardstick. `/money` is where the numbers live.

- **Every amount is a whole number of minor units.** THB, MMK and USD all have two decimals, so amounts are stored as `bigint` counts of 1/100 — satang, pyas, cents. Floating point never touches money: `0.1 + 0.2 = 0.30000000000000004` is a curiosity in a demo and a reconciliation failure in a ledger.
- **The sign says which way it went.** Negative is money out, positive is money in; a category says what it was for.
- **Each row keeps the rate it was converted at.** `rate_to_thb` and `amount_thb_minor` are written when the transaction is created, so October's total stays October's total after the kyat moves. The rate is picked by date — the newest one at or before that day.
- **Rates come from a free feed, or from your hand.** `/api/cron` refreshes USD and MMK against THB every day, *Pull today's rates* does it on demand, and a rate typed in by hand wins, because sometimes you know the rate you actually got.
- **The headline reads in dollars too.** Each card on the overview shows what its baht figure is worth in the day's dollar — `฿6,000` on the income card sits above `≈ $178.97` — and a line underneath names the rate, its date and whether it came from the feed or was typed by hand. It is the rate the page already converted with, so the dollar line and the baht figure above it can never tell two different stories. A zero gets no line at all.
- **Accounts and categories are archived, never deleted.** Archiving hides the row and leaves the months it belongs to intact. An account with nothing in it — one created by mistake — can be purged outright.
- **CSV both ways.** Export writes `date, account, category, amount, currency, rate_to_thb, payee, note, tags`. Import takes the same shape, creates accounts and categories it has not seen before, and skips rows it has already seen, so importing the same file twice changes nothing.

The screenshots in this repo came from a demo month. To look at the app with data in it:

```bash
node scripts/demo-seed.mjs       # four accounts and a month of transactions
node scripts/demo-cleanup.mjs    # take it all back out again
```

---

## Local setup

```bash
npm install
cp .env.example .env.local          # then fill in the values
psql "$DATABASE_URL" -f schema.sql   # first time only
psql "$DATABASE_URL" -f migrations/001_api_tokens.sql
psql "$DATABASE_URL" -f migrations/002_actor_identity.sql
psql "$DATABASE_URL" -f migrations/003_finance.sql
npm run dev
```

Open http://localhost:3000.

### Verification

```bash
npm run build                        # compile + type check
node scripts/smoke.mjs               # 33 end-to-end checks against localhost:3000
node scripts/smoke.mjs https://wam-db.vercel.app   # or against a deployment
```

`smoke.mjs` covers health, the owner gate, token issue and purge, the MCP handshake, every read and write path, hybrid search in both directions, the scope and read-only fences, session notes, history, soft delete, the cron runner, and the money round trip — an account in each currency, a conversion checked against the rate stored on its own row, the THB summary, the agent's read-only view of it, and a CSV export re-imported to prove it cannot duplicate. It cleans up the memories, accounts and tokens it creates.

It reads `.env.local` by itself, except for `OWNER_PASSWORD` — a hash cannot sign in, so pass the passphrase for that one run:

```bash
OWNER_PASSWORD='your passphrase' node scripts/smoke.mjs
```

`VERCEL_BYPASS` is needed when testing a deployment that still has Vercel Authentication on.

### Environment variables

| Variable | Needed for |
| --- | --- |
| `DATABASE_URL` | Neon Postgres connection (pooled host) |
| `OWNER_EMAIL` | The only email allowed to sign in |
| `OWNER_PASSWORD_HASH` | scrypt hash of the passphrase — `node scripts/owner-password.mjs` |
| `OWNER_PASSWORD` | Fallback if you would rather keep the plaintext |
| `SESSION_SECRET` | Signs the session cookie, 32+ characters |
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
- **One owner, no user table.** The only account is the owner, so an allowlist and a scrypt hash do the job that a users table would otherwise do badly.
- **Two credential types, two doors.** A session cookie opens the interface, a bearer token opens the protocol. Neither works at the other's door.
- **Supersede, never delete.** A changed fact keeps its old row as `superseded` history. Deletes are soft, so a mistake stays recoverable.
- **One embedding size everywhere.** 1024 dims, so switching embedding models needs no schema change.
- **Scopes as the permission line.** One agent token is bound to one scope, so a review bot cannot rewrite personal facts.
- **Tokens are stored hashed.** Only a SHA-256 hash and a display prefix live in the database; the raw token is shown once at creation.
- **Keyword search always works.** If the embedding provider is down, full-text search still answers on its own.
- **Every change is a version.** Content edits and state changes both advance the version, so history is complete and `(memory_id, version)` stays unique.
- **Writes return fast, jobs run later.** An embed failure never fails a write; the job stays queued for the cron runner.
- **Money in minor units, never floats.** Whole numbers of 1/100 in a `bigint`, converted once at write time. See the Money section for the rest.
- **Finance writes are owner-only.** Agents get read tools and nothing else, so "the AI moved my money" is not a failure mode this app has.
- **A page arrives with its data.** Money pages render on the server with their rows and dropdowns in parallel, and a save puts the row the write returned straight into the list. Every Neon query is a network round trip, so the number of round trips per click is the number to watch.

## Roadmap

1. **Phase 1 — Memory e2e:** ✅ real MCP server, per-agent hashed tokens, hybrid retrieval, full memory UI, cron job runner.
2. **Phase 2 — Universe dark UI:** ✅ design tokens, starfield shell, and every page rebuilt on it.
3. **Phase 3 — Owner login:** ✅ owner-email allowlist, scrypt passphrase, signed session cookie, `proxy.ts` gate plus a check inside every route.
4. **Phase 4 — Finance:** ✅ accounts, categories and transactions in minor units, THB base with THB/MMK/USD, dashboard, CSV both ways, read-only money tools for agents.
5. **Phase 5 — Hardening:** smoke tests in CI, agent-side MCP verification, deploy checks. Next.

See `docs/architecture.md` for the fuller design write-up.
