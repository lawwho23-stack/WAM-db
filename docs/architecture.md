# Agent Factory: E2E Architecture

Oct 15, 2026 · @Laww

One event-driven system reviews every pull request for security and code quality, remembers what it learns in a shared memory db, and shows its work in a chat UI and a process view.

## At a glance

&#91;embedded content: architecture · 4 zones, 1 MCP door\]

The Decision Maker reads context and writes one run record per PR through MCP; the Monitor and Claude Code use the same door, and the chat UI's process view reads those run records.

## Components

On the review path only the Decision Maker and the two reviewers are LLM calls; everything else is plain code or a managed service.

| Part | Kind | Tech | Job |
| --- | --- | --- | --- |
| Webhook endpoint | Code | Vercel function | Verify the GitHub signature, dedupe on PR + commit SHA, return 202 |
| Run queue | Managed | Upstash QStash Workflow | Run the review in the background with retries |
| PR analyser | Code | TypeScript | Fetch the diff, compute size and risk signals |
| db reader | Code | MCP client | Pull a context pack from the memory db |
| Decision Maker | LLM | GLM 5.3 Flash via OpenRouter | Pick lanes, merge findings, set the verdict |
| Security reviewer | LLM | DeepSeek V4 Flash via OpenRouter | Return structured security findings |
| Code reviewer | LLM | DeepSeek V4 Flash via OpenRouter | Return structured code-quality findings |
| Reporter | Code | GitHub API | Post the PR comment, write the run record |
| Monitor | Code | Scheduled job | Watch run failures, cost and the dismissed-finding rate |
| Memory MCP server | Code | mcp-handler on Vercel | Expose memory tools to every agent |
| Memory core library | Code | TypeScript | Write, search, build context packs, enforce permissions |
| Storage | Managed | Neon Postgres, Upstash Redis | Long-term memory and graph; short-term memory and cache |
| Chat UI and process view | Code | Next.js | Talk to agents and watch each run step by step |

## One PR review run

&#91;embedded content: one PR run · 8 steps, then a feedback loop\]

GitHub gets its 202 within seconds and everything after the queue runs in the background. If a lane fails, the run is marked for a human, so the verdict never implies a clean review.

## Memory db and MCP

Every agent and coding tool reaches memory through eight MCP tools; cache and queues stay internal, so tool descriptions cost little context.

| Tool | Used for | Reads | Writes |
| --- | --- | --- | --- |
| `get_context` | Start of a task or run | Pinned items, relevant long-term items, session state | Nothing |
| `search_memory` | Look up facts and past findings | Postgres items (vector + full-text) | Nothing |
| `write_memory` | Save a fact, episode or run record | Existing items (dedupe check) | A new item, as a candidate |
| `update_memory` | Edit or supersede an item | The item | A new version |
| `session_append` | Short-term notes during a task | Nothing | Redis session list |
| `session_get` | Resume a task | Redis session list | Nothing |
| `search_skills` | Find a skill by task | Skill items | Nothing |
| `get_skill` | Load one skill in full | One skill item | Nothing |

Each agent gets its own token with scopes. The PR reviewer calls `get_context` at the start of a run and `write_memory` once at the end, with the run keyed by PR number + commit SHA.

## Background jobs

Writes return fast and QStash runs the heavy work afterwards; every job is idempotent, so a retry never duplicates anything.

| Job | Trigger | What it does |
| --- | --- | --- |
| Embed | After a write | Compute and store the item's vector |
| Link | After a write | Extract entities and relations, write graph edges |
| Consolidate | Session end | Summarize the session, keep durable facts as long-term candidates |
| Supersede | New fact conflicts with an old one | Mark the old item superseded, keep its history |
| Decay and archive | Nightly | Lower importance of unused items, archive stale ones, never hard-delete |
| Skill index | Skill added or changed | Embed the description, bump the version |
| Usage stats | Each retrieval | Count which items get used, boost them in ranking |
| Export | Scheduled | Dump memory to Markdown or JSON so the data stays portable |

The process view shows each job's status next to the agent run that triggered it.

## Trust and security

Untrusted text enters at two points, the PR diff and agent-written memory, and each has its own gate.

- **Webhook:** verify `X-Hub-Signature-256` on every request and reject anything else.
- **PR content:** wrap the diff in clear delimiters and tell the models it is data, not instructions.
- **Reviewers:** no tools with side effects. They read input and return JSON; only the Reporter posts to GitHub or writes to memory.
- **Findings:** drop any finding whose evidence is not in the diff before the Decision Maker sees it.
- **Memory poisoning:** agent writes land as `candidate` items with `created_by` and a trust level; pinned context and skills need a human to promote them.
- **Access:** one scoped token per agent, so the PR reviewer cannot edit another agent's skills.
- **Secrets:** environment variables only, never in prompts or logs.

## Deployment

Everything runs on managed services, so there is no server of your own to keep alive.

| Piece | Runs on | Note |
| --- | --- | --- |
| Webhook, workflow steps, MCP server, HTTP API | Vercel Functions | Fluid compute: 300s max on Hobby; Pro can be set up to 800s |
| Background runs and schedules | Upstash QStash | Retries and cron without a worker process |
| Long-term memory, graph, skills | Neon Postgres | pgvector for similarity search |
| Short-term memory, cache, locks | Upstash Redis | TTL on sessions and cache keys |
| Models | OpenRouter | Swap a model by changing a slug |
| UI | Vercel (Next.js) | Chat, process view, table and graph view |

Configuration lives in environment variables:

```
OPENROUTER_API_KEY=
DECISION_MODEL=z-ai/glm-5.3-flash
REVIEWER_MODEL=deepseek/deepseek-v4-flash-0731
GITHUB_WEBHOOK_SECRET=
GITHUB_TOKEN=
DATABASE_URL=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
QSTASH_TOKEN=
MAX_DIFF_LINES=
CONFIDENCE_FLOOR=0.5
```

Pin dated model slugs so behavior does not drift, and confirm the exact slugs on OpenRouter before launch.

## Build order

Build the thinnest loop first, a PR in and a comment out, then add memory depth and visibility around it.

1. **Memory core:** schema, core library, HTTP API, then the MCP server with `get_context`, `search_memory` and `write_memory`. Connect Claude Code to it.
2. **Review loop, comment-only:** webhook, queue, PR analyser, both reviewers, evidence filters, Reporter, one run record per PR + commit.
3. **Chat UI and process view:** a chat to talk to the agents and a live view of each run's steps.
4. **Background jobs:** embed, consolidate, supersede, decay.
5. **Monitor and feedback loop:** record whether humans accept or dismiss each finding, and let the db reader feed that back to the Decision Maker.
6. **Table and graph view, skills library:** the full memory UI, then skill indexing and export.
7. **Optional:** a blocking status check for critical findings, only after accuracy is proven.

## Open questions

- Should agent-written memories go straight to long-term, or land in a candidate inbox that you or the consolidation job approve?
- Comment-only or a blocking status check on critical findings, and when to switch?
- TypeScript or Python for the review workflow, given that the MCP server and UI are TypeScript?
- Which repos and branches are in scope, and what is the policy for fork PRs and draft PRs?
- What is the per-PR cost cap and the diff-size limit?
