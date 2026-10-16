"use client";

import { useState } from "react";
import { api } from "@/lib/client-api";
import {
  ACCOUNT_KINDS,
  ACCOUNT_KIND_LABEL,
  CURRENCIES,
  fmt,
  type AccountKind,
  type AccountRow,
  type Currency,
} from "@/lib/money-types";

/**
 * The places money sits. A wallet in baht, a bank account in kyat, a card in
 * dollars — each keeps its own currency and its own opening balance, and the
 * page shows what all of them add up to in baht.
 */

const blank = { name: "", kind: "bank" as AccountKind, currency: "THB" as Currency, openingBalance: "", note: "" };

export default function AccountManager({ initialAccounts }: { initialAccounts: AccountRow[] }) {
  const [accounts, setAccounts] = useState<AccountRow[]>(initialAccounts);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(blank);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Balances are computed from the transactions, so a change to an account's
  // name, kind, currency or opening balance is answered by re-reading the list.
  // Archiving and deleting change nothing else, so those are applied straight
  // to what is already on screen.
  async function load() {
    try {
      const body = await api<{ accounts: AccountRow[] }>("/api/money/accounts?all=1");
      setAccounts(body.accounts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load accounts.");
    }
  }

  const visible = accounts.filter((a) => (showArchived ? true : !a.archivedAt));
  const netThb = accounts.filter((a) => !a.archivedAt).reduce((sum, a) => sum + a.balanceThbMinor, 0);

  function startEdit(account: AccountRow) {
    setEditingId(account.id);
    setForm({
      name: account.name,
      kind: account.kind,
      currency: account.currency,
      openingBalance: (account.openingBalanceMinor / 100).toFixed(2),
      note: account.note ?? "",
    });
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      kind: form.kind,
      currency: form.currency,
      openingBalance: Number(form.openingBalance) || 0,
      note: form.note.trim() || null,
    };
    try {
      if (editingId) await api("/api/money/accounts", { method: "PATCH", body: JSON.stringify({ id: editingId, ...body }) });
      else await api("/api/money/accounts", { method: "POST", body: JSON.stringify(body) });
      setForm(blank);
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the account.");
    } finally {
      setSaving(false);
    }
  }

  async function setArchived(account: AccountRow, archived: boolean) {
    try {
      await api("/api/money/accounts", { method: "PATCH", body: JSON.stringify({ id: account.id, archived }) });
      // Only the flag moved, and the page can draw that itself.
      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? { ...a, archivedAt: archived ? new Date().toISOString() : null } : a)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the account.");
    }
  }

  /** Only offered for accounts with nothing in them; the rest get archived. */
  async function purge(id: string) {
    try {
      await api("/api/money/accounts", { method: "DELETE", body: JSON.stringify({ id }) });
      setConfirmId(null);
      if (editingId === id) {
        setEditingId(null);
        setForm(blank);
      }
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the account.");
    }
  }

  return (
    <div className="space-y-5">
      <form className="panel px-4 py-4" onSubmit={submit}>
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-medium tracking-wide text-ink">{editingId ? "Edit account" : "Add an account"}</h2>
          {editingId ? (
            <button
              className="btn px-2.5 py-1 text-[11.5px]"
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(blank);
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-5">
          <label className="md:col-span-2">
            <span className="label mb-1.5 block">Name</span>
            <input
              className="input"
              placeholder="KBZ bank, Bangkok Bank, cash…"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label>
            <span className="label mb-1.5 block">Kind</span>
            <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AccountKind })}>
              {ACCOUNT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ACCOUNT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label mb-1.5 block">Currency</span>
            <select
              className="select disabled:opacity-60"
              value={form.currency}
              disabled={editingId !== null}
              title={
                editingId
                  ? "An account's currency cannot change once it exists — every transaction keeps the rate it was recorded at. Delete a fresh one and add it again instead."
                  : undefined
              }
              onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label mb-1.5 block">Opening balance</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder="0.00"
              value={form.openingBalance}
              onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
            />
          </label>
          <label className="md:col-span-4">
            <span className="label mb-1.5 block">Note</span>
            <input
              className="input"
              placeholder="optional"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          <div className="flex items-end">
            <button className="btn btn-primary w-full" type="submit" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save" : "Add account"}
            </button>
          </div>
        </div>

        {error ? <p className="mt-3 text-[12.5px] text-rose">{error}</p> : null}
      </form>

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-[13px] font-medium tracking-wide text-ink">
              {visible.length} account{visible.length === 1 ? "" : "s"}
            </h2>
            <p className="mt-0.5 text-[11.5px] text-faint">
              Everything, in baht: <span className="num text-ink">{fmt(netThb, "THB")}</span>
            </p>
          </div>
          <label className="flex items-center gap-2 text-[11.5px] text-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            show archived
          </label>
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan/60 shadow-[0_0_12px_var(--color-cyan)]" />
            <p className="text-[13px] text-faint">No accounts yet. Add where your money actually sits.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {visible.map((account) => (
              <div key={account.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition hover:bg-white/[0.02]">
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-[13px] ${account.archivedAt ? "text-faint line-through" : "text-ink"}`}>{account.name}</p>
                  <p className="truncate text-[11px] text-faint">
                    {ACCOUNT_KIND_LABEL[account.kind]} · {account.currency}
                    {account.txCount > 0 ? ` · ${account.txCount} transaction${account.txCount === 1 ? "" : "s"}` : ""}
                    {account.note ? ` · ${account.note}` : ""}
                  </p>
                </div>

                <span className="num hidden shrink-0 text-right text-[11.5px] text-muted sm:block sm:w-[110px]">
                  {account.currency === "THB" ? "" : `≈ ${fmt(account.balanceThbMinor, "THB")}`}
                </span>

                <span className={`num shrink-0 text-right text-[13px] ${account.balanceMinor < 0 ? "text-rose" : "text-ink"}`}>
                  {fmt(account.balanceMinor, account.currency)}
                </span>

                <div className="flex shrink-0 gap-1">
                  <button className="btn px-2 py-1 text-[11px]" type="button" onClick={() => startEdit(account)}>
                    Edit
                  </button>
                  <button className="btn px-2 py-1 text-[11px]" type="button" onClick={() => void setArchived(account, !account.archivedAt)}>
                    {account.archivedAt ? "Restore" : "Archive"}
                  </button>
                  {account.txCount === 0 ? (
                    confirmId === account.id ? (
                      <>
                        <button className="btn btn-danger px-2 py-1 text-[11px]" type="button" onClick={() => void purge(account.id)}>
                          Delete
                        </button>
                        <button className="btn px-2 py-1 text-[11px]" type="button" onClick={() => setConfirmId(null)}>
                          No
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn px-2 py-1 text-[11px]"
                        type="button"
                        title="Delete for good — only possible while it has no transactions"
                        onClick={() => setConfirmId(account.id)}
                      >
                        ✕
                      </button>
                    )
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
