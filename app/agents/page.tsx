import { listTokens } from "@/lib/auth-tokens";
import { scopeStats } from "@/lib/memory";
import AgentTokens from "@/components/AgentTokens";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agents · WAM-db" };

export default async function AgentsPage() {
  const [tokens, stats] = await Promise.all([
    listTokens().catch(() => []),
    scopeStats("laww-personal").catch(() => ({ scopes: [] as { name: string }[] })),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Agents"
        title="Who can reach this memory"
        subtitle="Each agent gets its own token, fenced to one scope and either read-only or read-write. Revoking one never touches the others."
      />
      <AgentTokens tokens={tokens as never} scopes={stats.scopes.map((s: { name: string }) => s.name)} />
    </div>
  );
}
