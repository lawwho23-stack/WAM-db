import { listSkills } from "@/lib/skills";
import { searchSkills } from "@/lib/skills";
import { PageHeader, Panel, PanelHeader, Chip, Empty } from "@/components/ui";

// Skills library. Only descriptions are listed; each body is loaded on demand,
// exactly how the MCP tools hand them to an agent — so the pattern on this page
// is the pattern in the protocol.

export const dynamic = "force-dynamic";
export const metadata = { title: "Skills · WAM-db" };

type Skill = { command: string; title: string; description: string; version: number; body?: string };

export default async function SkillsPage({ searchParams }: { searchParams: Promise<{ q?: string; scope?: string }> }) {
  const { q = "", scope = "laww-personal" } = await searchParams;

  let skills: Skill[] = [];
  let error: string | null = null;
  try {
    skills = (await (q.trim() ? searchSkills(scope, q) : listSkills(scope))) as unknown as Skill[];
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not read skills";
  }

  return (
    <div>
      <PageHeader
        eyebrow="Skills"
        title="Reusable procedures"
        subtitle="Search matches the title and description only. The body loads when an agent asks for one skill by name — keeping the context window clear until it matters."
        actions={
          <form action="/skills" method="get" className="flex items-center gap-2">
            <input className="input w-56" name="q" defaultValue={q} placeholder="Find a procedure…" aria-label="Search skills" />
            <button className="btn btn-primary" type="submit">
              Find
            </button>
          </form>
        }
      />

      {error ? (
        <Panel className="border-rose/40 px-4 py-3 text-[13px] text-rose">{error}</Panel>
      ) : skills.length === 0 ? (
        <Panel>
          <Empty>{q ? <>Nothing matched “{q}”.</> : <>No skills published yet.</>}</Empty>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <PanelHeader title={q ? `Matches for “${q}”` : "All skills"} hint={`scope ${scope}`} right={<Chip tone="mint">{skills.length}</Chip>} />
          <ul className="divide-y divide-[var(--color-line)]">
            {skills.map((s) => (
              <li key={s.command}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2.5 px-4 py-3.5 transition-colors hover:bg-white/[0.03]">
                    <span className="num text-[12.5px] text-cyan">{s.command}</span>
                    <span className="text-[13.5px] text-ink">{s.title}</span>
                    <span className="num ml-auto text-[11px] text-faint">v{s.version}</span>
                    <span className="text-[11px] text-faint transition-transform group-open:rotate-90">›</span>
                  </summary>
                  <div className="px-4 pb-4">
                    <p className="mb-3 text-[12.5px] leading-relaxed text-muted">{s.description}</p>
                    <p className="text-[11px] text-faint">
                      Load the body with the MCP tool <span className="num">get_skill</span> — command{" "}
                      <span className="num text-muted">{s.command}</span>.
                    </p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
