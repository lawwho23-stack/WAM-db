import { sql, getScope } from "@/lib/db";
import { PageHeader, Panel, PanelHeader, Chip, Empty, relTime } from "@/components/ui";

// Process view: one row per unit of agent work (a PR + commit, a job, a batch),
// with the step count recorded in agent_run_events.

export const dynamic = "force-dynamic";
export const metadata = { title: "Runs · WAM-db" };

type Run = {
  id: string;
  agent: string;
  external_id: string;
  repository: string;
  pr_number: number | null;
  status: string;
  current_stage: string;
  findings_count: number;
  summary: string | null;
  created_at: string;
  events: number;
};

const STATUS_TONE: Record<string, string> = {
  queued: "neutral",
  running: "cyan",
  done: "mint",
  completed: "mint",
  failed: "rose",
  blocked: "amber",
};

export default async function RunsPage() {
  let rows: Run[] = [];
  let error: string | null = null;

  try {
    const db = sql();
    const scope = await getScope("pr-reviewer");
    rows = (await db`SELECT r.id, a.name as agent, r.external_id, r.repository, r.pr_number, r.status, r.current_stage,
        r.findings_count, r.summary, r.created_at,
        (SELECT count(*)::int FROM agent_run_events e WHERE e.run_id = r.id) as events
      FROM agent_runs r JOIN agents a ON a.id = r.agent_id
      WHERE r.scope_id = ${scope.id}
      ORDER BY r.created_at DESC LIMIT 40`) as unknown as Run[];
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not read runs";
  }

  return (
    <div>
      <PageHeader
        eyebrow="Runs"
        title="What the agents actually did"
        subtitle="One row per unit of work — a PR plus commit, a job, a batch. Steps come from the event log."
      />

      {error ? (
        <Panel className="border-rose/40 px-4 py-3 text-[13px] text-rose">{error}</Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <Empty>No runs recorded in the pr-reviewer scope yet.</Empty>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <PanelHeader title="Run log" hint="Newest first." right={<Chip tone="violet">{rows.length}</Chip>} />
          <ul className="divide-y divide-[var(--color-line)]">
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[13.5px] text-ink">{r.repository}</span>
                  {r.pr_number ? <span className="num text-[12px] text-cyan">#{r.pr_number}</span> : null}
                  <span className="num text-[11.5px] text-faint">{r.external_id.slice(0, 16)}</span>
                  <Chip tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Chip>
                  <Chip>{r.current_stage}</Chip>
                  <span className="num ml-auto text-[11px] text-faint">
                    {r.events} steps · findings {r.findings_count} · {relTime(r.created_at)}
                  </span>
                </div>
                {r.summary ? <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{r.summary}</p> : null}
                <p className="mt-1.5 text-[11px] text-faint">agent {r.agent}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
