/**
 * Shown the moment a money page is asked for, while its data is still being
 * read. Without it, clicking a tab left the old page frozen with no sign that
 * anything was happening — which is most of what "a little delay" felt like.
 *
 * The tabs above stay put; only the page underneath is a placeholder.
 */
export default function MoneyLoading() {
  return (
    <div className="animate-pulse space-y-5" aria-hidden>
      <div className="space-y-2.5">
        <div className="h-2.5 w-14 rounded-full bg-white/[0.06]" />
        <div className="h-5 w-44 rounded-lg bg-white/[0.07]" />
        <div className="h-2.5 w-2/3 max-w-[460px] rounded-full bg-white/[0.05]" />
      </div>

      <div className="panel space-y-3 px-4 py-4">
        <div className="h-3 w-32 rounded-full bg-white/[0.06]" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="panel-flat h-16" />
          ))}
        </div>
      </div>

      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <div className="h-3 w-36 rounded-full bg-white/[0.06]" />
        </div>
        <div className="divide-y divide-white/[0.04]">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3.5">
              <div className="h-2.5 w-11 rounded-full bg-white/[0.05]" />
              <div className="h-2.5 min-w-[120px] flex-1 rounded-full bg-white/[0.05]" />
              <div className="h-2.5 w-20 rounded-full bg-white/[0.06]" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
