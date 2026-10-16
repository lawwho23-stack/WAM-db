import Link from "next/link";
import { scopeStats, listMemories, getContext } from "@/lib/memory";
import { listTokens } from "@/lib/auth-tokens";
import { PageHeader, Panel, PanelHeader, Stat, Chip, Empty, relTime } from "@/components/ui";

// Overview. Server-rendered because it only reads — the database is one hop
// away instead of a browser round trip, so the first paint already has data.

export const dynamic = "force-dynamic";

const DEFAULT_SCOPE = "laww-personal";

export default async function Overview() {
  const [stats, context, recent, tokens] = await Promise.all([
    scopeStats(DEFAULT_SCOPE),
    getContext(DEFAULT_SCOPE),
    listMemories({ scope: DEFAULT_SCOPE, limit: 6 }),
    listTokens().catch(() => []),
  ]);

  const activeTokens = (tokens as { revoked_at: string | null }[]).filter((t) => !t.revoked_at).length;
  const coverage =
    stats.activeCount > 0 ? Math.round((stats.embeddedCount / stats.activeCount) * 100) : 100;

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="One memory, every agent."
        subtitle={
          <>
            Everything you and your agents learn is stored here, searchable by meaning and by exact words.
            Scope <span className="num text-cyan">{stats.scope}</span> holds {stats.activeCount} live{" "}
            {stats.activeCount === 1 ? "memory" : "memories"}.
          </>
        }
        actions={
          <>
            <form action="/memories" method="get" className="flex items-center gap-2">
              <input className="input w-56" name="q" placeholder="Search memory…" aria-label="Search memory" />
              <button className="btn btn-primary" type="submit">
                Search
              </button>
            </form>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Live memories" value={stats.activeCount} tone="cyan" hint={`${stats.byType.length} types in use`} />
        <Stat
          label="Embedded"
          value={`${coverage}%`}
          tone={coverage === 100 ? "mint" : "amber"}
          hint={stats.missingEmbeddings > 0 ? `${stats.missingEmbeddings} waiting for a vector` : "every memory is searchable by meaning"}
        />
        <Stat label="Queued jobs" value={stats.queuedJobs} tone={stats.queuedJobs > 0 ? "amber" : "ink"} hint="drained nightly by /api/cron" />
        <Stat label="Active agents" value={activeTokens} tone="violet" hint="bearer tokens at /api/mcp" />
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Pinned"
            hint="Always included in the context pack an agent gets on start."
            right={<Chip tone="cyan">{context.pinned.length}</Chip>}
          />
          {context.pinned.length === 0 ? (
            <Empty>Nothing pinned yet. Pin a memory to keep it in every context pack.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {context.pinned.map((m) => (
                <li key={m.id} className="px-4 py-3">
                  <Link href={`/memories/${m.id}`} className="group block">
                    <p className="text-[13.5px] leading-relaxed text-ink group-hover:text-cyan">{m.content}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Chip tone="cyan">{m.type}</Chip>
                      <Chip>{m.trust.replace(/_/g, " ")}</Chip>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader
            title="Recent activity"
            hint="Newest first, superseded rows excluded."
            right={
              <Link href="/memories" className="text-[12px] text-cyan hover:underline">
                Browse all
              </Link>
            }
          />
          {recent.results.length === 0 ? (
            <Empty>No memories yet.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {recent.results.map((m) => (
                <li key={m.id} className="px-4 py-3">
                  <Link href={`/memories/${m.id}`} className="group block">
                    <p className="line-clamp-2 text-[13px] leading-relaxed text-muted group-hover:text-ink">{m.snippet}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                      <span className="num text-[10.5px] text-violet">{m.type}</span>
                      <span>·</span>
                      <span>{relTime(m.updated_at)}</span>
                      {m.labels.includes("pinned") ? <Chip tone="cyan">pinned</Chip> : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel className="overflow-hidden">
          <PanelHeader title="Connect an agent" hint="One endpoint, one token per agent." />
          <div className="space-y-3 px-4 py-4">
            <div className="panel-flat px-3 py-2.5">
              <p className="label mb-1">MCP endpoint</p>
              <p className="num break-all text-[12.5px] text-cyan">https://wam-db.vercel.app/api/mcp</p>
            </div>
            <ol className="space-y-2 text-[13px] leading-relaxed text-muted">
              <li>
                <span className="num mr-2 text-faint">01</span>Create a token on the{" "}
                <Link href="/agents" className="text-cyan hover:underline">
                  Agents
                </Link>{" "}
                page.
              </li>
              <li>
                <span className="num mr-2 text-faint">02</span>Give it a scope and decide read-only or read-write.
              </li>
              <li>
                <span className="num mr-2 text-faint">03</span>Point the agent at the endpoint with{" "}
                <span className="num text-muted">Authorization: Bearer &lt;token&gt;</span>.
              </li>
            </ol>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="By type" hint="What this scope actually knows." />
          {stats.byType.length === 0 ? (
            <Empty>Nothing stored yet.</Empty>
          ) : (
            <ul className="px-4 py-4">
              {stats.byType.map((t) => {
                const max = Math.max(...stats.byType.map((x) => x.n), 1);
                return (
                  <li key={t.type} className="mb-3 last:mb-0">
                    <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
                      <span className="text-muted">{t.type.replace(/_/g, " ")}</span>
                      <span className="num text-faint">{t.n}</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan/70 to-violet/70"
                        style={{ width: `${Math.max((t.n / max) * 100, 4)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
