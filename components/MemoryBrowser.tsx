"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MemoryRow } from "@/lib/memory";
import { Chip, Empty, Panel, Spinner, relTime } from "@/components/ui";

// The memory browser. One search box drives hybrid retrieval; with the box
// empty the same panel lists everything newest-first. Filters narrow the list.

type Hit = MemoryRow & {
  score?: number;
  similarity?: number | null;
  matched?: { vector: boolean; keyword: boolean };
};

const TYPES = ["all", "fact", "preference", "decision", "experience", "procedure", "run_record", "skill_ref"];
const TRUSTS = ["all", "owner_asserted", "source_extracted", "agent_reported", "inferred"];
const STATES = ["active", "superseded", "expired", "deleted", "all"];

function trustTone(trust: string) {
  return trust === "owner_asserted" ? "mint" : trust === "source_extracted" ? "cyan" : trust === "inferred" ? "amber" : "neutral";
}

function typeTone(type: string) {
  return type === "decision" ? "violet" : type === "preference" ? "cyan" : type === "procedure" ? "mint" : "neutral";
}

export default function MemoryBrowser({ initialQuery = "", initialScope = "laww-personal" }: { initialQuery?: string; initialScope?: string }) {
  const [scope, setScope] = useState(initialScope);
  const [scopes, setScopes] = useState<string[]>([initialScope]);
  const [q, setQ] = useState(initialQuery);
  const [type, setType] = useState("all");
  const [trust, setTrust] = useState("all");
  const [state, setState] = useState("active");
  const [label, setLabel] = useState("all");

  const [rows, setRows] = useState<Hit[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [took, setTook] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Scope list for the picker.
  useEffect(() => {
    fetch("/api/stats?scope=" + encodeURIComponent(initialScope))
      .then((r) => r.json())
      .then((d) => setScopes((d.scopes ?? []).map((s: { name: string }) => s.name)))
      .catch(() => {});
  }, [initialScope]);

  const load = useCallback(async () => {
    const query = q.trim();
    const started = performance.now();
    if (query) setSearching(true);
    else setLoading(true);
    setError(null);
    try {
      if (query) {
        // Hybrid: meaning + exact words.
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&scope=${encodeURIComponent(scope)}&limit=30`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setRows((data.results ?? []) as Hit[]);
        setTotal((data.results ?? []).length);
        setLabels([]);
      } else {
        const params = new URLSearchParams({ scope, type, trust, state, label, limit: "60" });
        const res = await fetch(`/api/memories?${params}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setRows((data.results ?? []) as Hit[]);
        setTotal(data.total ?? 0);
        setLabels(data.labels ?? []);
      }
      setTook(Math.round(performance.now() - started));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load memories");
      setRows([]);
    } finally {
      setLoading(false);
      setSearching(false);
    }
  }, [q, scope, type, trust, state, label]);

  // Debounce typing; refetch immediately when a filter or scope changes.
  useEffect(() => {
    const t = setTimeout(load, q.trim() ? 260 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const activeFilters = useMemo(() => [type, trust, state, label].filter((v) => v !== "all" && v !== "").length, [type, trust, state, label]);
  const isSearch = q.trim().length > 0;

  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
          <div className="relative min-w-[240px] flex-1">
            <input
              ref={inputRef}
              className="input pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by meaning or exact words…"
              aria-label="Search memory"
            />
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
            </span>
            {searching ? (
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                <span className="orbit" />
              </span>
            ) : null}
          </div>
          <select className="select w-auto" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Scope">
            {scopes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {q ? (
            <button className="btn" onClick={() => setQ("")} type="button">
              Clear
            </button>
          ) : null}
        </div>

        <div className="hairline" />

        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="label mr-1">Filters</span>
          <select className="select w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "any type" : t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <select className="select w-auto" value={trust} onChange={(e) => setTrust(e.target.value)} aria-label="Trust">
            {TRUSTS.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "any trust" : t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <select className="select w-auto" value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "any state" : s}
              </option>
            ))}
          </select>
          {labels.length > 0 ? (
            <select className="select w-auto" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Label">
              <option value="all">any label</option>
              {labels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          ) : null}
          {activeFilters > 0 && !isSearch ? (
            <button
              className="btn"
              type="button"
              onClick={() => {
                setType("all");
                setTrust("all");
                setState("active");
                setLabel("all");
              }}
            >
              Reset
            </button>
          ) : null}
          <span className="ml-auto num text-[11.5px] text-faint">
            {loading ? "loading…" : `${rows.length}${isSearch ? "" : ` / ${total}`} shown`}
            {took !== null && !loading ? ` · ${took}ms` : ""}
          </span>
        </div>
      </Panel>

      {error ? (
        <Panel className="border-rose/40 px-4 py-3 text-[13px] text-rose">Could not load: {error}</Panel>
      ) : loading ? (
        <Panel className="px-4 py-10 text-center">
          <Spinner label="reading memory…" />
        </Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <Empty>
            {isSearch ? (
              <>Nothing matched “{q}”. Try different words, or clear the box to browse.</>
            ) : (
              <>No memories match these filters.</>
            )}
          </Empty>
        </Panel>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((m) => (
            <li key={m.id} className="animate-rise">
              <Link href={`/memories/${m.id}`} className="panel block px-4 py-3.5 transition-colors hover:border-[var(--color-line-strong)] hover:bg-white/[0.055]">
                <p className="text-[13.5px] leading-relaxed text-ink">{m.content ?? m.snippet}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Chip tone={typeTone(m.type)}>{m.type.replace(/_/g, " ")}</Chip>
                  <Chip tone={trustTone(m.trust)}>{m.trust.replace(/_/g, " ")}</Chip>
                  {m.labels?.filter((l) => l !== "pinned").map((l) => (
                    <Chip key={l}>{l}</Chip>
                  ))}
                  {m.matched?.vector ? <Chip tone="cyan">meaning match</Chip> : null}
                  {m.matched?.keyword ? <Chip tone="violet">word match</Chip> : null}
                  {m.state !== "active" ? <Chip tone="amber">{m.state}</Chip> : null}
                  <span className="num ml-auto flex items-center gap-3 text-[11px] text-faint">
                    {m.similarity !== null && m.similarity !== undefined ? <span>sim {m.similarity}</span> : null}
                    {m.score ? <span>score {m.score}</span> : null}
                    <span>{relTime(m.updated_at)}</span>
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
