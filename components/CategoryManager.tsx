"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { CategoryKind, CategoryRow } from "@/lib/money-types";

/**
 * What money was for. Two kinds — income and expense — and a colour so the
 * overview can draw a category without needing a legend.
 */

const SWATCHES = ["#5ee7ff", "#63f2c0", "#9b8cff", "#ffc46b", "#ff7b9c", "#8a94ac"];

export default function CategoryManager() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "expense" as CategoryKind, color: SWATCHES[0] });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const body = await api<{ categories: CategoryRow[] }>("/api/money/categories?all=1");
        setCategories(body.categories);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load categories.");
      } finally {
        setLoading(false);
      }
    })();
  }, [reload]);

  const visible = categories.filter((c) => (showArchived ? true : !c.archivedAt));
  const income = visible.filter((c) => c.kind === "income");
  const expense = visible.filter((c) => c.kind === "expense");

  function startEdit(category: CategoryRow) {
    setEditingId(category.id);
    setForm({ name: category.name, kind: category.kind, color: category.color ?? SWATCHES[0] });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const body = { name: form.name.trim(), kind: form.kind, color: form.color };
    try {
      if (editingId) await api("/api/money/categories", { method: "PATCH", body: JSON.stringify({ id: editingId, ...body }) });
      else await api("/api/money/categories", { method: "POST", body: JSON.stringify(body) });
      setForm({ name: "", kind: form.kind, color: SWATCHES[0] });
      setEditingId(null);
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the category.");
    } finally {
      setSaving(false);
    }
  }

  async function setArchived(category: CategoryRow, archived: boolean) {
    try {
      await api("/api/money/categories", { method: "PATCH", body: JSON.stringify({ id: category.id, archived }) });
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the category.");
    }
  }

  const list = (title: string, rows: CategoryRow[]) => (
    <div className="panel overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[13px] font-medium tracking-wide text-ink">{title}</h2>
        <p className="mt-0.5 text-[11.5px] text-faint">{rows.length} categories</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-faint">Nothing here yet.</p>
      ) : (
        <div className="divide-y divide-white/[0.04]">
          {rows.map((category) => (
            <div key={category.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 transition hover:bg-white/[0.02]">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: category.color ?? "#8a94ac" }} />
              <div className="min-w-0 flex-1">
                <p className={`truncate text-[13px] ${category.archivedAt ? "text-faint line-through" : "text-ink"}`}>{category.name}</p>
                <p className="text-[11px] text-faint">
                  {category.txCount} transaction{category.txCount === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button className="btn px-2 py-1 text-[11px]" type="button" onClick={() => startEdit(category)}>
                  Edit
                </button>
                <button className="btn px-2 py-1 text-[11px]" type="button" onClick={() => void setArchived(category, !category.archivedAt)}>
                  {category.archivedAt ? "Restore" : "Archive"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <form className="panel px-4 py-4" onSubmit={submit}>
        <div className="mb-3.5 flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-medium tracking-wide text-ink">{editingId ? "Edit category" : "Add a category"}</h2>
          {editingId ? (
            <button className="btn px-2.5 py-1 text-[11.5px]" type="button" onClick={() => { setEditingId(null); setForm({ name: "", kind: "expense", color: SWATCHES[0] }); }}>
              Cancel
            </button>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <label className="md:col-span-2">
            <span className="label mb-1.5 block">Name</span>
            <input className="input" placeholder="Coffee, rent, client work…" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            <span className="label mb-1.5 block">Kind</span>
            <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CategoryKind })}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </label>
          <div>
            <span className="label mb-1.5 block">Colour</span>
            <div className="flex items-center gap-2 pt-1.5">
              {SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Use ${color}`}
                  className={`h-4.5 w-4.5 rounded-full border transition ${form.color === color ? "border-ink" : "border-transparent"}`}
                  style={{ background: color, height: 18, width: 18 }}
                  onClick={() => setForm({ ...form, color })}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : editingId ? "Save" : "Add category"}
          </button>
          <label className="flex items-center gap-2 text-[11.5px] text-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            show archived
          </label>
        </div>

        {error ? <p className="mt-3 text-[12.5px] text-rose">{error}</p> : null}
      </form>

      {loading ? (
        <p className="text-[12.5px] text-faint">Loading…</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {list("Money out", expense)}
          {list("Money in", income)}
        </div>
      )}
    </div>
  );
}
