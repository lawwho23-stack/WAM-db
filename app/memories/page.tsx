import { Suspense } from "react";
import MemoryBrowser from "@/components/MemoryBrowser";
import { PageHeader, Panel, Spinner } from "@/components/ui";
import { scopeStats } from "@/lib/memory";

export const dynamic = "force-dynamic";

export const metadata = { title: "Memory · WAM-db" };

export default async function MemoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; scope?: string }>;
}) {
  const { q = "", scope = "laww-personal" } = await searchParams;

  let subtitle = "Search by meaning or by exact words — both legs run and the results are merged.";
  try {
    const stats = await scopeStats(scope);
    subtitle = `${stats.activeCount} live memories in ${stats.scope}, ${stats.embeddedCount} of them embedded for meaning search.`;
  } catch {
    /* the browser below will surface any real error */
  }

  return (
    <div>
      <PageHeader eyebrow="Memory" title="Everything you and your agents know" subtitle={subtitle} />

      <Suspense
        fallback={
          <Panel className="px-4 py-10 text-center">
            <Spinner label="starting…" />
          </Panel>
        }
      >
        <MemoryBrowser initialQuery={q} initialScope={scope} />
      </Suspense>
    </div>
  );
}
