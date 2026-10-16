import Link from "next/link";
import { PageHeader, Panel, PanelHeader, Stat, Empty } from "@/components/ui";
import RatesPanel from "@/components/RatesPanel";
import { fmt, fmtCompact, moneySummary, monthOf, shiftMonth, shortDate, type TxRow } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money · WAM-db" };

// Bar heights and widths are the one thing Tailwind cannot express, because the
// value only exists at render time.
const height = (value: number, max: number) => `${Math.max(2, Math.round((Math.abs(value) / (max || 1)) * 100))}%`;
const width = (value: number, max: number) => `${Math.max(2, Math.round((Math.abs(value) / (max || 1)) * 100))}%`;

function TxLine({ row }: { row: TxRow }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5 transition hover:bg-white/[0.02]">
      <span className="num w-[52px] shrink-0 text-[11.5px] text-faint">{shortDate(row.occurredOn)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] text-ink">{row.payee || row.note || "—"}</p>
        <p className="truncate text-[10.5px] text-faint">
          {row.categoryName ?? "unsorted"} · {row.accountName}
        </p>
      </div>
      {row.currency !== "THB" ? (
        <span className="num hidden shrink-0 text-[10.5px] text-faint sm:block">{fmt(row.amountThbMinor, "THB")}</span>
      ) : null}
      <span className={`num shrink-0 text-right text-[12.5px] ${row.amountMinor > 0 ? "text-mint" : "text-ink"}`}>
        {fmt(row.amountMinor, row.currency)}
      </span>
    </div>
  );
}

export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: asked } = await searchParams;
  const month = asked && /^\d{4}-\d{2}$/.test(asked) ? asked : monthOf();
  const s = await moneySummary(month);
  const thisMonth = monthOf();

  const trendMax = Math.max(...s.trend.map((t) => Math.max(t.incomeThbMinor, Math.abs(t.expenseThbMinor))), 1);
  const categoryMax = Math.max(...s.byCategory.map((c) => Math.abs(c.totalThbMinor)), 1);
  const hasAccounts = s.accounts.length > 0;

  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Where it stands"
        subtitle={
          <>
            One person, three currencies, one yardstick: everything is reported in baht. Each row keeps the rate it was recorded at, so
            closing October stays closed even after the kyat moves.
          </>
        }
        actions={
          <>
            <div className="flex items-center gap-1 rounded-xl border border-line px-1 py-1">
              <Link className="btn px-2 py-1 text-[11.5px]" href={`/money?month=${shiftMonth(month, -1)}`} aria-label="Previous month">
                ←
              </Link>
              <span className="num px-2 text-[12px] text-ink">{s.label}</span>
              <Link className="btn px-2 py-1 text-[11.5px]" href={`/money?month=${shiftMonth(month, 1)}`} aria-label="Next month">
                →
              </Link>
            </div>
            {month === thisMonth ? null : (
              <Link className="btn" href="/money">
                This month
              </Link>
            )}
            <Link className="btn btn-primary" href="/money/transactions">
              Record something
            </Link>
          </>
        }
      />

      {!hasAccounts ? (
        <Panel>
          <Empty>
            No accounts yet. Money has to sit somewhere before it can be tracked — add a wallet, a bank account or a card, and this page
            fills itself in.
          </Empty>
          <div className="flex justify-center pb-8">
            <Link className="btn btn-primary" href="/money/accounts">
              Add the first account
            </Link>
          </div>
        </Panel>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Net worth, in baht"
              value={fmtCompact(s.netWorthThbMinor)}
              hint="all accounts at today's rates"
              tone="cyan"
            />
            <Stat
              label={`In · ${s.label}`}
              value={fmtCompact(s.incomeThbMinor)}
              hint={`${s.byCategory.filter((c) => c.kind === "income").length} income categories`}
              tone="mint"
            />
            <Stat
              label={`Out · ${s.label}`}
              value={fmtCompact(Math.abs(s.expenseThbMinor))}
              hint={`${s.txCount} transaction${s.txCount === 1 ? "" : "s"} this month`}
              tone="rose"
            />
            <Stat
              label="Kept this month"
              value={fmtCompact(s.netThbMinor)}
              hint={s.netThbMinor >= 0 ? "you spent less than came in" : "you spent more than came in"}
              tone={s.netThbMinor >= 0 ? "violet" : "amber"}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <Panel className="overflow-hidden">
              <PanelHeader
                title="Accounts"
                hint={`${s.accounts.length} active`}
                right={
                  <Link className="btn px-2.5 py-1 text-[11.5px]" href="/money/accounts">
                    Manage
                  </Link>
                }
              />
              <div className="divide-y divide-white/[0.04]">
                {s.accounts.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] text-ink">{a.name}</p>
                      <p className="text-[10.5px] text-faint">
                        {a.kind} · {a.currency} · {a.txCount} transaction{a.txCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    {a.currency !== "THB" ? (
                      <span className="num hidden shrink-0 text-[10.5px] text-faint sm:block">≈ {fmt(a.balanceThbMinor, "THB")}</span>
                    ) : null}
                    <span className={`num shrink-0 text-[12.5px] ${a.balanceMinor < 0 ? "text-rose" : "text-ink"}`}>
                      {fmt(a.balanceMinor, a.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>

            <div className="space-y-3">
              <Panel className="px-4 py-3.5">
                <p className="label">Held in each currency</p>
                <div className="mt-2.5 space-y-2">
                  {s.byCurrency.map((c) => (
                    <div key={c.currency} className="flex items-baseline justify-between gap-3">
                      <span className="text-[12px] text-muted">{c.currency}</span>
                      <span className="num text-[12px] text-ink">{fmt(c.balanceMinor, c.currency)}</span>
                      {c.currency === "THB" ? (
                        <span className="num w-[92px] text-right text-[10.5px] text-faint">base</span>
                      ) : (
                        <span className="num w-[92px] text-right text-[10.5px] text-faint">≈ {fmt(c.balanceThbMinor, "THB")}</span>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel className="overflow-hidden">
                <div className="border-b border-line px-4 py-3">
                  <h2 className="text-[13px] font-medium tracking-wide text-ink">Exchange rates</h2>
                </div>
                <RatesPanel initialRates={s.rates} />
              </Panel>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel className="overflow-hidden">
              <PanelHeader title="Six months" hint="money in against money out, in baht" right={
                <span className="flex items-center gap-3 text-[10.5px] text-faint">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-mint/70" /> in
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-rose/70" /> out
                  </span>
                </span>
              } />
              <div className="flex items-end gap-2 px-4 py-4">
                {s.trend.map((t) => (
                  <div key={t.month} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                    <div className="flex h-28 w-full items-end justify-center gap-1.5">
                      <div
                        className="w-4 rounded-t bg-mint/60 transition hover:bg-mint/80"
                        style={{ height: height(t.incomeThbMinor, trendMax) }}
                        title={`in ${fmt(t.incomeThbMinor, "THB")}`}
                      />
                      <div
                        className="w-4 rounded-t bg-rose/60 transition hover:bg-rose/80"
                        style={{ height: height(t.expenseThbMinor, trendMax) }}
                        title={`out ${fmt(t.expenseThbMinor, "THB")}`}
                      />
                    </div>
                    <span className={`num text-[10.5px] ${t.month === month ? "text-cyan" : "text-faint"}`}>
                      {new Date(`${t.month}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" })}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel className="overflow-hidden">
              <PanelHeader title="Where it went" hint={`${s.byCategory.length} categories · ${s.label}`} />
              {s.byCategory.length === 0 ? (
                <Empty>Nothing recorded in {s.label} yet.</Empty>
              ) : (
                <div className="space-y-3 px-4 py-4">
                  {s.byCategory.map((c) => (
                    <div key={c.id ?? c.name}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[12.5px] text-ink">{c.name}</span>
                        <span className={`num shrink-0 text-[12px] ${c.totalThbMinor > 0 ? "text-mint" : "text-ink"}`}>
                          {fmt(Math.abs(c.totalThbMinor), "THB")}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: width(c.totalThbMinor, categoryMax),
                            background: c.color ?? (c.kind === "income" ? "#63f2c0" : "#5ee7ff"),
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel className="overflow-hidden">
              <PanelHeader
                title="Latest"
                hint="the last eight rows recorded"
                right={
                  <Link className="btn px-2.5 py-1 text-[11.5px]" href="/money/transactions">
                    All transactions
                  </Link>
                }
              />
              {s.recent.length === 0 ? (
                <Empty>Nothing recorded yet.</Empty>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {s.recent.map((row) => (
                    <TxLine key={row.id} row={row} />
                  ))}
                </div>
              )}
            </Panel>

            <Panel className="overflow-hidden">
              <PanelHeader title="Biggest this month" hint={s.label} />
              {s.biggest.length === 0 ? (
                <Empty>Nothing recorded in {s.label}.</Empty>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {s.biggest.map((row) => (
                    <TxLine key={row.id} row={row} />
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
