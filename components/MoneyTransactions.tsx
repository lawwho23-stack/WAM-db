"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import {
  CURRENCIES,
  fmt,
  shortDate,
  todayISO,
  type AccountRow,
  type CategoryRow,
  type Currency,
  type RateRow,
  type TxRow,
} from "@/lib/money-types";

/**
 * Where money is written.
 *
 * Everything the page needs to be usable for data entry: a form that opens
 * above the list, filters that survive editing, and rows that can be corrected
 * in place. The direction toggle ("money in" / "money out") is there because
 * typing a minus sign is the kind of small friction that stops people from
 * recording things at all.
 *
 * The first month and its rows arrive with the page, fetched on the server in
 * parallel while the HTML is built. After that the list only asks again when a
 * filter changes, and a write puts the row it just saved straight into the
 * list — no refetch of things that cannot have changed.
 */

type Filters = { month: string; accountId: string; categoryId: string; kind: string };

type Draft = {
  accountId: string;
  categoryId: string;
  occurredOn: string;
  direction: "in" | "out";
  amount: string;
  currency: Currency;
  rate: string;
  payee: string;
  note: string;
  tags: string;
};

const emptyDraft = (accountId: string, currency: Currency): Draft => ({
  accountId,
  categoryId: "",
  occurredOn: todayISO(),
  direction: "out",
  amount: "",
  currency,
  rate: "",
  payee: "",
  note: "",
  tags: "",
});

export default function MoneyTransactions({
  initialMonth,
  initialList,
  initialAccounts,
  initialCategories,
  initialRates,
}: {
  initialMonth: string;
  initialList: { rows: TxRow[]; total: number; sumThbMinor: number };
  initialAccounts: AccountRow[];
  initialCategories: CategoryRow[];
  initialRates: Record<string, RateRow | null>;
}) {
  const [filters, setFilters] = useState<Filters>({ month: initialMonth, accountId: "", categoryId: "", kind: "" });
  const [query, setQuery] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [rows, setRows] = useState<TxRow[]>(initialList.rows);
  const [total, setTotal] = useState(initialList.total);
  const [sumThbMinor, setSumThbMinor] = useState(initialList.sumThbMinor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // Accounts, categories and rates came in with the page and nothing on this
  // page can change them, so they are read once and never fetched again.
  const accounts = initialAccounts;
  const categories = initialCategories;
  const rates = initialRates;

  const openAccounts = useMemo(() => accounts.filter((a) => !a.archivedAt), [accounts]);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  // The list. The first month's rows came with the page, so the first run of
  // this effect has nothing to do; after that, any change of the filters — or a
  // reload after an import — asks the server.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams({ limit: "200" });
        if (filters.month) p.set("month", filters.month);
        if (filters.accountId) p.set("accountId", filters.accountId);
        if (filters.categoryId) p.set("categoryId", filters.categoryId);
        if (filters.kind) p.set("kind", filters.kind);
        if (settledQuery.trim()) p.set("q", settledQuery.trim());
        const body = await api<{ rows: TxRow[]; total: number; sumThbMinor: number }>(`/api/money/transactions?${p}`, {
          signal: controller.signal,
        });
        setRows(body.rows);
        setTotal(body.total);
        setSumThbMinor(body.sumThbMinor);
        setError(null);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load transactions.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [filters, settledQuery, reload]);

  // Typing waits for a pause. Without this, "coffee" was six searches, six
  // database reads, and a list that moved under you while you typed.
  useEffect(() => {
    if (query === settledQuery) return;
    const timer = setTimeout(() => setSettledQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query, settledQuery]);

  const currencyOf = (accountId: string): Currency => openAccounts.find((a) => a.id === accountId)?.currency ?? "THB";

  /** Would this row show up in the list as it is filtered right now? */
  function shows(row: TxRow): boolean {
    if (filters.month && row.occurredOn.slice(0, 7) !== filters.month) return false;
    if (filters.accountId && row.accountId !== filters.accountId) return false;
    if (filters.categoryId && row.categoryId !== filters.categoryId) return false;
    if (filters.kind === "income" && row.amountMinor <= 0) return false;
    if (filters.kind === "expense" && row.amountMinor >= 0) return false;
    const term = settledQuery.trim().toLowerCase();
    if (term) {
      const haystack = [row.payee, row.note, row.categoryName, row.accountName].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  }

  // A saved row goes straight into the list. The write already returned it, and
  // asking for the whole month again to be told what we were just told is what
  // made every save feel two beats slow.
  function applySaved(row: TxRow, previous: TxRow | null) {
    const shownBefore = previous !== null && rows.some((r) => r.id === previous.id);
    const wanted = shows(row);
    setRows((prev) => {
      const rest = prev.filter((r) => r.id !== row.id);
      if (!wanted) return rest;
      return [row, ...rest].sort((a, b) => (a.occurredOn === b.occurredOn ? 0 : a.occurredOn < b.occurredOn ? 1 : -1));
    });
    setTotal((n) => Math.max(0, n + (wanted ? 1 : 0) - (shownBefore ? 1 : 0)));
    setSumThbMinor((n) => n + (wanted ? row.amountThbMinor : 0) - (shownBefore && previous ? previous.amountThbMinor : 0));
  }

  function startNew() {
    const first = openAccounts[0];
    if (!first) {
      setError("Add an account first — money has to sit somewhere.");
      return;
    }
    setEditingId(null);
    setDraft(emptyDraft(first.id, first.currency));
    setReport(null);
  }

  function startEdit(row: TxRow) {
    setEditingId(row.id);
    setDraft({
      accountId: row.accountId,
      categoryId: row.categoryId ?? "",
      occurredOn: row.occurredOn,
      direction: row.amountMinor < 0 ? "out" : "in",
      amount: (Math.abs(row.amountMinor) / 100).toFixed(2),
      currency: row.currency,
      rate: row.currency === "THB" ? "" : String(row.rateToThb),
      payee: row.payee ?? "",
      note: row.note ?? "",
      tags: row.tags.join(" "),
    });
    setReport(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const value = Number(draft.amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Type an amount greater than zero.");
      return;
    }

    setSaving(true);
    setError(null);
    const body = {
      accountId: draft.accountId,
      categoryId: draft.categoryId || null,
      occurredOn: draft.occurredOn,
      amount: draft.direction === "out" ? -value : value,
      currency: draft.currency,
      rateToThb: draft.currency !== "THB" && Number(draft.rate) > 0 ? Number(draft.rate) : undefined,
      payee: draft.payee.trim() || null,
      note: draft.note.trim() || null,
      tags: draft.tags.split(/[\s,]+/).filter(Boolean),
    };

    try {
      if (editingId) {
        const previous = rows.find((r) => r.id === editingId) ?? null;
        const { transaction } = await api<{ transaction: TxRow }>(`/api/money/transactions/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        applySaved(transaction, previous);
      } else {
        const { transaction } = await api<{ transaction: TxRow }>("/api/money/transactions", { method: "POST", body: JSON.stringify(body) });
        applySaved(transaction, null);
      }
      setDraft(null);
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: TxRow) {
    setBusyId(row.id);
    try {
      await api(`/api/money/transactions/${row.id}`, { method: "DELETE" });
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setTotal((n) => Math.max(0, n - 1));
      setSumThbMinor((n) => n - row.amountThbMinor);
      setConfirmId(null);
      if (editingId === row.id) {
        setEditingId(null);
        setDraft(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
    } finally {
      setBusyId(null);
    }
  }

  async function importFile(file: File) {
    setSaving(true);
    setError(null);
    setReport(null);
    try {
      const text = await file.text();
      const out = await api<{ inserted: number; skipped: number; createdAccounts: string[]; createdCategories: string[]; errors: string[] }>(
        "/api/money/import",
        { method: "POST", headers: { "content-type": "text/csv" }, body: text },
      );
      setReport(
        `Imported ${out.inserted}, skipped ${out.skipped}` +
          (out.createdAccounts.length ? ` · new accounts: ${out.createdAccounts.join(", ")}` : "") +
          (out.createdCategories.length ? ` · new categories: ${out.createdCategories.join(", ")}` : "") +
          (out.errors.length ? ` · ${out.errors.length} row(s) had problems: ${out.errors.slice(0, 2).join("; ")}` : ""),
      );
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import failed.");
    } finally {
      setSaving(false);
    }
  }

  const exportHref = `/api/money/export?${new URLSearchParams(
    Object.entries({ month: filters.month, accountId: filters.accountId, categoryId: filters.categoryId, q: settledQuery.trim() }).filter(
      ([, v]) => v,
    ) as [string, string][],
  )}`;

  const kindForDirection = draft?.direction === "in" ? "income" : "expense";
  const categoryOptions = categories.filter((c) => c.kind === kindForDirection);

  return (
    <div className="space-y-5">
      {/* filters */}
      <div className="panel flex flex-wrap items-end gap-3 px-4 py-3.5">
        <label className="min-w-[132px] flex-1">
          <span className="label mb-1.5 block">Month</span>
          <input
            className="input"
            type="month"
            value={filters.month}
            onChange={(e) => setFilters((f) => ({ ...f, month: e.target.value }))}
          />
        </label>
        <label className="min-w-[150px] flex-1">
          <span className="label mb-1.5 block">Account</span>
          <select className="select" value={filters.accountId} onChange={(e) => setFilters((f) => ({ ...f, accountId: e.target.value }))}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[136px] flex-1">
          <span className="label mb-1.5 block">Category</span>
          <select className="select" value={filters.categoryId} onChange={(e) => setFilters((f) => ({ ...f, categoryId: e.target.value }))}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[118px]">
          <span className="label mb-1.5 block">Direction</span>
          <select className="select" value={filters.kind} onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value }))}>
            <option value="">Both</option>
            <option value="income">Money in</option>
            <option value="expense">Money out</option>
          </select>
        </label>
        <label className="min-w-[160px] flex-[1.4]">
          <span className="label mb-1.5 block">Search</span>
          <input
            className="input"
            placeholder="payee, note, category…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="flex gap-2">
          <button className="btn btn-primary" type="button" onClick={startNew}>
            Add transaction
          </button>
          <a className="btn" href={exportHref}>
            Export
          </a>
        </div>
      </div>

      {/* the form */}
      {draft ? (
        <form className="panel animate-rise px-4 py-4" onSubmit={submit}>
          <div className="mb-3.5 flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-medium tracking-wide text-ink">{editingId ? "Edit transaction" : "New transaction"}</h2>
            <button
              className="btn px-2.5 py-1 text-[11.5px]"
              type="button"
              onClick={() => {
                setDraft(null);
                setEditingId(null);
              }}
            >
              Close
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <span className="label mb-1.5 block">Direction</span>
              <div className="flex gap-2">
                {(["out", "in"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`btn flex-1 ${draft.direction === d ? "btn-primary" : ""}`}
                    onClick={() => setDraft({ ...draft, direction: d, categoryId: "" })}
                  >
                    {d === "out" ? "Money out" : "Money in"}
                  </button>
                ))}
              </div>
            </div>

            <label className="md:col-span-2">
              <span className="label mb-1.5 block">Amount</span>
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  inputMode="decimal"
                  placeholder="0.00"
                  autoFocus
                  value={draft.amount}
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                />
                <select
                  className="select w-[104px]"
                  value={draft.currency}
                  onChange={(e) => {
                    const currency = e.target.value as Currency;
                    const rate = rates[currency];
                    setDraft({ ...draft, currency, rate: currency === "THB" ? "" : rate ? String(rate.rateToThb) : "" });
                  }}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <label className="md:col-span-2">
              <span className="label mb-1.5 block">Account</span>
              <select
                className="select"
                value={draft.accountId}
                onChange={(e) => {
                  const currency = currencyOf(e.target.value);
                  setDraft({ ...draft, accountId: e.target.value, currency, rate: currency === "THB" ? "" : draft.rate });
                }}
              >
                {openAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="label mb-1.5 block">Date</span>
              <input
                className="input"
                type="date"
                value={draft.occurredOn}
                onChange={(e) => setDraft({ ...draft, occurredOn: e.target.value })}
              />
            </label>

            <label>
              <span className="label mb-1.5 block">Category</span>
              <select className="select" value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                <option value="">unsorted</option>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            {draft.currency !== "THB" ? (
              <label className="md:col-span-2">
                <span className="label mb-1.5 block">Rate — 1 {draft.currency} in baht</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={draft.rate}
                  onChange={(e) => setDraft({ ...draft, rate: e.target.value })}
                  placeholder={rates[draft.currency] ? String(rates[draft.currency]?.rateToThb) : "no rate stored"}
                />
              </label>
            ) : null}

            <label className={draft.currency !== "THB" ? "md:col-span-2" : "md:col-span-2"}>
              <span className="label mb-1.5 block">Payee</span>
              <input
                className="input"
                placeholder="who this was with"
                value={draft.payee}
                onChange={(e) => setDraft({ ...draft, payee: e.target.value })}
              />
            </label>

            <label className="md:col-span-2">
              <span className="label mb-1.5 block">Note</span>
              <input
                className="input"
                placeholder="what it was for"
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </label>

            <label className="md:col-span-2">
              <span className="label mb-1.5 block">Tags</span>
              <input
                className="input"
                placeholder="space separated"
                value={draft.tags}
                onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              />
            </label>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Record it"}
            </button>
            <span className="text-[11.5px] text-faint">
              {draft.currency === "THB"
                ? "Recorded in baht."
                : `Stored at ${draft.rate || rates[draft.currency]?.rateToThb || "the day's rate"} — this row keeps that rate forever.`}
            </span>
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-rose/30 bg-rose/[0.07] px-3.5 py-2.5 text-[12.5px] text-rose">{error}</p>
      ) : null}
      {report ? <p className="rounded-xl border border-mint/30 bg-mint/[0.06] px-3.5 py-2.5 text-[12.5px] text-mint">{report}</p> : null}

      {/* the list */}
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-[13px] font-medium tracking-wide text-ink">
              {loading && rows.length === 0 ? "Loading…" : `${total} transaction${total === 1 ? "" : "s"}`}
              {loading && rows.length > 0 ? <span className="ml-1.5 text-[11.5px] font-normal text-faint">updating…</span> : null}
            </h2>
            <p className="mt-0.5 text-[11.5px] text-faint">
              Net for this view: <span className={`num ${sumThbMinor < 0 ? "text-rose" : "text-mint"}`}>{fmt(sumThbMinor, "THB")}</span>
            </p>
          </div>
          <details className="text-[11.5px] text-muted">
            <summary className="cursor-pointer select-none">Import a CSV</summary>
            <div className="panel-flat mt-2 w-[290px] px-3 py-2.5">
              <p className="text-[11px] leading-relaxed text-faint">
                Columns: date, account, category, amount, currency, rate_to_thb, payee, note, tags. Unknown accounts and categories are
                created. Importing the same file twice changes nothing.
              </p>
              <input
                className="mt-2 text-[11px]"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importFile(file);
                }}
              />
            </div>
          </details>
        </div>

        {rows.length === 0 && !loading ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan/60 shadow-[0_0_12px_var(--color-cyan)]" />
            <p className="text-[13px] text-faint">
              {openAccounts.length === 0 ? "Add an account, then record what moves through it." : "Nothing recorded for this view yet."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {rows.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition hover:bg-white/[0.02]">
                <span className="num w-[54px] shrink-0 text-[11.5px] text-faint">{shortDate(row.occurredOn)}</span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-ink">{row.payee || row.note || "—"}</p>
                  <p className="truncate text-[11px] text-faint">
                    {row.categoryName ?? "unsorted"} · {row.accountName}
                    {row.payee && row.note ? ` · ${row.note}` : ""}
                    {row.tags.length > 0 ? ` · ${row.tags.join(" ")}` : ""}
                    {row.source !== "manual" ? ` · ${row.source}` : ""}
                  </p>
                </div>

                <span className="num hidden shrink-0 text-right text-[11.5px] text-muted md:block md:w-[110px]"
                  title={`rate ${row.rateToThb}`}>
                  {row.currency === "THB" ? "" : `${row.rateToThb.toFixed(6)} → ${fmt(row.amountThbMinor, "THB")}`}
                </span>

                <span className={`num w-[104px] shrink-0 text-right text-[13px] ${row.amountMinor > 0 ? "text-mint" : "text-ink"}`}>
                  {fmt(row.amountMinor, row.currency)}
                </span>

                <div className="flex shrink-0 gap-1">
                  <button className="btn px-2 py-1 text-[11px]" type="button" onClick={() => startEdit(row)}>
                    Edit
                  </button>
                  {confirmId === row.id ? (
                    <>
                      <button
                        className="btn btn-danger px-2 py-1 text-[11px]"
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void remove(row)}
                      >
                        {busyId === row.id ? "…" : "Delete"}
                      </button>
                      <button className="btn px-2 py-1 text-[11px]" type="button" onClick={() => setConfirmId(null)}>
                        No
                      </button>
                    </>
                  ) : (
                    <button className="btn px-2 py-1 text-[11px]" type="button" onClick={() => setConfirmId(row.id)}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
