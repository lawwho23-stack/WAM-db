"use client";

import { useState } from "react";
import { api } from "@/lib/client-api";
import { fmt, type Currency, type RateRow } from "@/lib/money-types";

/**
 * The two rates everything else depends on: what a kyat and a dollar are worth
 * in baht. They can be pulled from the feed or typed in by hand — the hand-typed
 * one wins, because sometimes you know the rate you actually got.
 */
export default function RatesPanel({
  compact = false,
  initialRates,
}: {
  compact?: boolean;
  /** The rates the page already read to draw its own numbers. Required, so no
   *  caller can leave the panel fetching what the server just sent. */
  initialRates: Record<string, RateRow | null> | null;
}) {
  const [rates, setRates] = useState<Record<string, RateRow | null> | null>(initialRates);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /** Fold rows we just wrote into what is on screen — no read-back needed. */
  function remember(written: RateRow[]) {
    if (written.length === 0) return;
    setRates((prev) => {
      const next = { ...(prev ?? {}) };
      for (const row of written) next[row.currency] = row;
      return next;
    });
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const body = await api<{ updated: RateRow[] }>("/api/money/rates", { method: "POST", body: JSON.stringify({ refresh: true }) });
      const written = body.updated.map((r) => `${r.currency} ${r.rateToThb.toFixed(8)}`).join(" · ");
      setNote(written ? `Updated ${written}` : "The feed had nothing new.");
      remember(body.updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The feed could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  async function setManual(currency: Currency, value: string) {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api<{ rate: RateRow }>("/api/money/rates", { method: "POST", body: JSON.stringify({ currency, rate }) });
      remember([saved.rate]);
      setNote(`${currency} set by hand.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the rate.");
    } finally {
      setBusy(false);
    }
  }

  const rows: { currency: Currency; label: string; hint: string }[] = [
    { currency: "USD", label: "US dollar", hint: "$1 in baht" },
    { currency: "MMK", label: "Myanmar kyat", hint: "K1 in baht" },
  ];

  return (
    <div className={compact ? "" : "panel"}>
      <div className={`flex flex-wrap items-center gap-3 ${compact ? "" : "border-b border-line px-4 py-3"}`}>
        <div className="min-w-0">
          {compact ? null : <h2 className="text-[13px] font-medium tracking-wide text-ink">Rates into baht</h2>}
          <p className="text-[11.5px] text-faint">
            Every amount is stored with the rate it was converted at, so old months never move.
          </p>
        </div>
        <button className="btn ml-auto px-2.5 py-1 text-[11.5px]" type="button" onClick={refresh} disabled={busy}>
          {busy ? "…" : "Pull today's rates"}
        </button>
      </div>

      <div className="grid gap-3 px-1 py-3 sm:grid-cols-2 sm:px-4">
        {rows.map(({ currency, label, hint }) => {
          const rate = rates?.[currency];
          return (
            <div key={currency} className="panel-flat px-3.5 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] text-muted">{label}</span>
                <span className="num text-[15px] text-ink" title={rate ? `${rate.rateToThb}` : "no rate yet"}>
                  {rate ? rate.rateToThb.toFixed(6) : "—"}
                </span>
              </div>
              <p className="mt-1 text-[10.5px] text-faint">
                {hint}
                {rate ? ` · as of ${rate.asOf} · ${rate.source}` : " · no rate stored"}
              </p>
              <form
                className="mt-2 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const input = event.currentTarget.elements.namedItem("rate") as HTMLInputElement | null;
                  if (input) void setManual(currency, input.value);
                }}
              >
                <input className="input py-1.5 text-[12px]" name="rate" inputMode="decimal" placeholder={`set 1 ${currency} in baht`} />
                <button className="btn px-2.5 py-1 text-[11.5px]" type="submit" disabled={busy}>
                  Set
                </button>
              </form>
            </div>
          );
        })}
      </div>

      {note ? <p className="px-4 pb-3 text-[11.5px] text-mint">{note}</p> : null}
      {error ? <p className="px-4 pb-3 text-[11.5px] text-rose">{error}</p> : null}
      <p className="px-4 pb-4 text-[11px] text-faint">
        Example: 1 THB ≈ {rates?.MMK ? (1 / rates.MMK.rateToThb).toFixed(2) : "—"} MMK · 1 USD ≈{" "}
        {rates?.USD ? fmt(Math.round(rates.USD.rateToThb * 100), "THB") : "—"}
      </p>
    </div>
  );
}
